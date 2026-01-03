import {MediabunnyExporter} from "./MediabunnyExporter";

const isFirefox = typeof navigator !== 'undefined' && navigator.userAgent.includes('Firefox');
const defaultAccelerationOrder = isFirefox 
    ? ['prefer-software', 'no-preference'] 
    : ['prefer-hardware', 'prefer-software', 'no-preference'];

export const VideoFormats = {
    'mp4-h264': {
        name: 'MP4 (H.264)',
        extension: 'mp4',
        format: 'mp4',
        codec: 'avc',
    },
    'webm-vp8': {
        name: 'WebM (VP8)',
        extension: 'webm',
        format: 'webm',
        codec: 'vp8',
    },
};

export const DefaultVideoFormat = 'mp4-h264';

export async function createVideoExporter(formatId, options) {
    const format = VideoFormats[formatId];
    if (!format) {
        throw new Error(`Unknown video format: ${formatId}`);
    }

    return new MediabunnyExporter({
        ...options,
        format: format.format,
        codec: format.codec,
        hardwareAcceleration: options.hardwareAcceleration,
    });
}

export function getVideoExtension(formatId) {
    const format = VideoFormats[formatId];
    return format ? format.extension : 'mp4';
}

export function getVideoFormatOptions() {
    return Object.entries(VideoFormats).reduce((acc, [key, value]) => {
        acc[value.name] = key;
        return acc;
    }, {});
}

async function checkH264Support(width, height) {
    const config = {
        width,
        height,
        framerate: 30,
        bitrate: 1_000_000,
        codec: 'avc1.640029',
        avc: { format: 'avc' },
    };
    
    for (const accel of defaultAccelerationOrder) {
        config.hardwareAcceleration = accel;
        try {
            if ((await VideoEncoder.isConfigSupported(config)).supported) {
                return { supported: true, hardwareAcceleration: accel };
            }
        } catch (e) {}
    }
    return { supported: false };
}

export async function checkVideoEncodingSupport() {
    if (typeof VideoEncoder === 'undefined') {
        return { supported: false, h264: false, vp8: false, reason: 'VideoEncoder API not available' };
    }
    
    let mp4MuxerAvailable = false;
    let webmMuxerAvailable = false;
    try {
        const { Mp4OutputFormat, WebMOutputFormat } = await import('mediabunny');
        mp4MuxerAvailable = typeof Mp4OutputFormat === 'function';
        webmMuxerAvailable = typeof WebMOutputFormat === 'function';
    } catch (e) {
        return { supported: false, h264: false, vp8: false, reason: 'Media muxer library not available' };
    }
    
    const h264Result = mp4MuxerAvailable ? await checkH264Support(640, 480) : { supported: false };
    
    let vp8 = false;
    if (webmMuxerAvailable) {
        const vp8Config = { width: 640, height: 480, framerate: 30, bitrate: 1_000_000, codec: 'vp8' };
        try {
            vp8 = (await VideoEncoder.isConfigSupported(vp8Config)).supported;
        } catch (e) {}
    }
    
    if (h264Result.supported || vp8) {
        return { 
            supported: true, 
            h264: h264Result.supported, 
            h264Acceleration: h264Result.hardwareAcceleration,
            vp8 
        };
    }
    return { supported: false, h264: false, vp8: false, reason: 'No video codecs available' };
}

export function getFilteredVideoFormatOptions(encodingSupport) {
    const options = {};
    if (encodingSupport.h264) {
        options[VideoFormats['mp4-h264'].name] = 'mp4-h264';
    }
    if (encodingSupport.vp8) {
        options[VideoFormats['webm-vp8'].name] = 'webm-vp8';
    }
    return options;
}

export function getDefaultVideoFormat(encodingSupport) {
    if (isFirefox && encodingSupport.vp8) return 'webm-vp8';
    if (encodingSupport.h264) return 'mp4-h264';
    if (encodingSupport.vp8) return 'webm-vp8';
    return null;
}

export async function checkCodecAtResolution(formatId, width, height) {
    if (typeof VideoEncoder === 'undefined') {
        return { supported: false, reason: 'VideoEncoder API not available' };
    }
    
    const encodedWidth = Math.ceil(width / 2) * 2;
    const encodedHeight = Math.ceil(height / 2) * 2;
    
    const format = VideoFormats[formatId];
    if (!format) {
        return { supported: false, reason: `Unknown format: ${formatId}` };
    }
    
    try {
        const { Mp4OutputFormat, WebMOutputFormat } = await import('mediabunny');
        if (format.format === 'mp4' && typeof Mp4OutputFormat !== 'function') {
            return { supported: false, reason: 'MP4 muxer not available' };
        }
        if (format.format === 'webm' && typeof WebMOutputFormat !== 'function') {
            return { supported: false, reason: 'WebM muxer not available' };
        }
    } catch (e) {
        return { supported: false, reason: 'Media muxer library not available' };
    }
    
    const config = {
        width: encodedWidth,
        height: encodedHeight,
        framerate: 30,
        bitrate: 5_000_000,
    };
    
    if (format.codec === 'avc') {
        config.avc = { format: 'avc' };
        const levels = ['avc1.640029', 'avc1.640032', 'avc1.640033', 'avc1.640034'];
        for (const accel of defaultAccelerationOrder) {
            config.hardwareAcceleration = accel;
            for (const level of levels) {
                config.codec = level;
                try {
                    if ((await VideoEncoder.isConfigSupported(config)).supported) {
                        return { supported: true, hardwareAcceleration: accel };
                    }
                } catch (e) {}
            }
        }
        return { supported: false, reason: `H.264 not supported at ${encodedWidth}x${encodedHeight}` };
    } else {
        config.codec = format.codec;
        try {
            if ((await VideoEncoder.isConfigSupported(config)).supported) {
                return { supported: true };
            }
        } catch (e) {}
        return { supported: false, reason: `${format.codec} not supported at ${encodedWidth}x${encodedHeight}` };
    }
}

export async function getBestFormatForResolution(preferredFormat, width, height) {
    const preferred = await checkCodecAtResolution(preferredFormat, width, height);
    if (preferred.supported) {
        return { 
            formatId: preferredFormat, 
            fallback: false,
            hardwareAcceleration: preferred.hardwareAcceleration,
        };
    }
    
    const fallbackId = preferredFormat === 'mp4-h264' ? 'webm-vp8' : 'mp4-h264';
    const fallback = await checkCodecAtResolution(fallbackId, width, height);
    if (fallback.supported) {
        return { 
            formatId: fallbackId, 
            fallback: true, 
            reason: preferred.reason,
            hardwareAcceleration: fallback.hardwareAcceleration,
        };
    }
    
    return { formatId: null, fallback: false, reason: `No codec supports ${width}x${height}` };
}
