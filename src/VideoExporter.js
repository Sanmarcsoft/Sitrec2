import {MediabunnyExporter} from "./MediabunnyExporter";

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
