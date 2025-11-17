export const WEBAUDIO_SUPPORTED_EXTENSIONS = ['mp3', 'wav', 'ogg', 'flac', 'webm', 'aac', 'aif', 'aiff', 'caf'];

export const MP4_DEMUXER_EXTENSIONS = ['m4a'];

export function isWebAudioFormat(filename) {
    const ext = filename.toLowerCase().split('.').pop();
    return WEBAUDIO_SUPPORTED_EXTENSIONS.includes(ext);
}

export function isMP4DemuxerFormat(filename) {
    const ext = filename.toLowerCase().split('.').pop();
    return MP4_DEMUXER_EXTENSIONS.includes(ext);
}

export function isAudioOnlyFormat(filename) {
    return isWebAudioFormat(filename) || isMP4DemuxerFormat(filename);
}
