export class MediabunnyExporter {
    constructor(options = {}) {
        this.width = options.width || 640;
        this.height = options.height || 480;
        this.fps = options.fps || 30;
        this.bitrate = options.bitrate || 5_000_000;
        this.keyFrameInterval = options.keyFrameInterval || 30;
        this.format = options.format || 'mp4';
        this.codec = options.codec || (this.format === 'mp4' ? 'avc' : 'vp8');
        this.videoStartDate = options.videoStartDate || null;
        this.audioBuffer = options.audioBuffer || null;
        this.audioStartTime = options.audioStartTime || 0;
        this.audioDuration = options.audioDuration || null;
        this.originalFps = options.originalFps || this.fps;

        this.output = null;
        this.videoSource = null;
        this.audioSource = null;
        this.frameCount = 0;
        this.error = null;
    }

    async initialize() {
        const {
            Output,
            Mp4OutputFormat,
            WebmOutputFormat,
            BufferTarget,
            EncodedVideoPacketSource,
            EncodedPacket,
            AudioBufferSource,
        } = await import('mediabunny');

        this.EncodedPacket = EncodedPacket;

        const encodedWidth = Math.ceil(this.width / 2) * 2;
        const encodedHeight = Math.ceil(this.height / 2) * 2;

        const formatOptions = this.format === 'mp4'
            ? new Mp4OutputFormat({ fastStart: 'in-memory' })
            : new WebmOutputFormat();

        this.target = new BufferTarget();
        this.output = new Output({
            format: formatOptions,
            target: this.target,
        });

        this.videoSource = new EncodedVideoPacketSource(this.codec);
        this.output.addVideoTrack(this.videoSource, {
            frameRate: this.fps,
        });

        if (this.audioBuffer) {
            const audioCodec = this.format === 'mp4' ? 'aac' : 'opus';
            this.audioSource = new AudioBufferSource({
                codec: audioCodec,
                bitrate: 128_000,
            });
            this.output.addAudioTrack(this.audioSource);
        }

        await this.output.start();

        this.encoder = new VideoEncoder({
            output: async (chunk, meta) => {
                try {
                    const packet = this.EncodedPacket.fromEncodedChunk(chunk);
                    await this.videoSource.add(packet, meta);
                } catch (e) {
                    console.error('Muxer error:', e);
                    this.error = e;
                }
            },
            error: (e) => {
                console.error('VideoEncoder error:', e);
                this.error = e;
            }
        });

        const codecString = this.codec === 'avc' ? 'avc1.640028' : 'vp8';
        const config = {
            codec: codecString,
            width: encodedWidth,
            height: encodedHeight,
            framerate: this.fps,
            bitrate: this.bitrate,
        };

        if (this.codec === 'avc') {
            config.avc = { format: 'avc' };
        }

        const support = await VideoEncoder.isConfigSupported(config);
        if (!support.supported) {
            if (this.codec === 'avc') {
                config.codec = 'avc1.42001f';
                const support2 = await VideoEncoder.isConfigSupported(config);
                if (!support2.supported) {
                    throw new Error('H.264 codec not supported by browser');
                }
            } else {
                throw new Error(`${this.codec} codec not supported by browser`);
            }
        }

        this.encoder.configure(config);
        this.encodedWidth = encodedWidth;
        this.encodedHeight = encodedHeight;
        this.frameCount = 0;
        this.timestampAccumulatorMicros = 0;

        this.baseFrameDurationMicros = Math.round(1_000_000 / this.fps);
    }

    async addFrame(canvas, frameIndex) {
        if (this.error) throw this.error;

        const timestampMicros = this.timestampAccumulatorMicros;
        const frameDurationMicros = this.baseFrameDurationMicros;

        let frameCanvas = canvas;
        if (canvas.width !== this.encodedWidth || canvas.height !== this.encodedHeight) {
            frameCanvas = document.createElement('canvas');
            frameCanvas.width = this.encodedWidth;
            frameCanvas.height = this.encodedHeight;
            const ctx = frameCanvas.getContext('2d');
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, this.encodedWidth, this.encodedHeight);
            ctx.drawImage(canvas, 0, 0);
        }

        const videoFrame = new VideoFrame(frameCanvas, {
            timestamp: timestampMicros,
            duration: frameDurationMicros,
        });

        const isKeyFrame = frameIndex % this.keyFrameInterval === 0;
        this.encoder.encode(videoFrame, { keyFrame: isKeyFrame });
        videoFrame.close();

        this.timestampAccumulatorMicros += frameDurationMicros;
        this.frameCount++;
    }

    async finalize(onProgress = null, onStatus = null) {
        if (onStatus) {
            onStatus('Flushing encoder...');
            await new Promise(r => setTimeout(r, 0));
        }

        await this.encoder.flush();
        this.encoder.close();
        this.videoSource.close();

        if (this.audioSource && this.audioBuffer) {
            if (onStatus) {
                onStatus('Encoding audio...');
                await new Promise(r => setTimeout(r, 0));
            }

            const sampleRate = this.audioBuffer.sampleRate;
            const startSample = Math.floor(this.audioStartTime * sampleRate);
            const totalSamples = this.audioDuration !== null 
                ? Math.floor(this.audioDuration * sampleRate)
                : this.audioBuffer.length - startSample;
            const endSample = Math.min(startSample + totalSamples, this.audioBuffer.length);
            const samplesToUse = endSample - startSample;

            if (samplesToUse > 0) {
                const numChannels = this.audioBuffer.numberOfChannels;
                const offlineCtx = new OfflineAudioContext(numChannels, samplesToUse, sampleRate);
                const trimmedBuffer = offlineCtx.createBuffer(numChannels, samplesToUse, sampleRate);
                
                for (let ch = 0; ch < numChannels; ch++) {
                    const srcData = this.audioBuffer.getChannelData(ch);
                    const dstData = trimmedBuffer.getChannelData(ch);
                    for (let i = 0; i < samplesToUse; i++) {
                        dstData[i] = srcData[startSample + i];
                    }
                }

                await this.audioSource.add(trimmedBuffer, 0);
            }
            this.audioSource.close();
        }

        if (onStatus) {
            onStatus(`Finalizing ${this.format.toUpperCase()}...`);
            await new Promise(r => setTimeout(r, 0));
        }

        await this.output.finalize();

        const buffer = this.target.buffer;
        const mimeType = this.format === 'mp4' ? 'video/mp4' : 'video/webm';

        return new Blob([buffer], { type: mimeType });
    }

    getFrameCount() {
        return this.frameCount;
    }
}
