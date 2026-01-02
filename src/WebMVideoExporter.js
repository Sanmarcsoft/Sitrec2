export class WebMVideoExporter {
    constructor(options = {}) {
        this.width = options.width || 640;
        this.height = options.height || 480;
        this.fps = options.fps || 30;
        this.bitrate = options.bitrate || 5_000_000;
        this.keyFrameInterval = options.keyFrameInterval || 30;
        this.videoStartDate = options.videoStartDate || null;
        
        this.chunks = [];
        this.encoder = null;
        this.encoderError = null;
        this.frameCount = 0;
        
        this.timestampAccumulatorMicros = 0;
        this.errorAccumulator = 0;
        
        const fpsRounded = Math.round(this.fps * 1000);
        const is23976 = Math.abs(fpsRounded - 23976) < 10;
        const is29970 = Math.abs(fpsRounded - 29970) < 10;
        
        if (is23976) {
            this.baseFrameDurationMicros = 41708;
            this.errorStep = 1;
            this.errorThreshold = 3;
            this.errorAdjustment = 1;
        } else if (is29970) {
            this.baseFrameDurationMicros = 33367;
            this.errorStep = 1;
            this.errorThreshold = 3;
            this.errorAdjustment = -1;
        } else {
            this.baseFrameDurationMicros = Math.round(1_000_000 / this.fps);
            this.errorStep = 0;
            this.errorThreshold = 1;
            this.errorAdjustment = 0;
        }
    }

    async initialize() {
        if (typeof VideoEncoder === 'undefined') {
            throw new Error('VideoEncoder API not supported');
        }

        this.chunks = [];
        this.encoderError = null;
        this.frameCount = 0;

        this.encoder = new VideoEncoder({
            output: (chunk, meta) => {
                const buffer = new ArrayBuffer(chunk.byteLength);
                chunk.copyTo(buffer);
                this.chunks.push({ 
                    buffer, 
                    meta, 
                    timestamp: chunk.timestamp, 
                    type: chunk.type,
                    duration: chunk.duration
                });
            },
            error: (e) => {
                console.error('VideoEncoder error:', e);
                this.encoderError = e;
            }
        });

        const config = {
            codec: 'vp8',
            width: this.width,
            height: this.height,
            framerate: this.fps,
            bitrate: this.bitrate,
        };

        const support = await VideoEncoder.isConfigSupported(config);
        if (!support.supported) {
            throw new Error('VP8 codec not supported');
        }

        this.encoder.configure(config);
    }

    async addFrame(canvas, frameIndex) {
        if (this.encoderError) throw this.encoderError;

        const timestampMicros = this.timestampAccumulatorMicros;
        
        let frameDurationMicros = this.baseFrameDurationMicros;
        this.errorAccumulator += this.errorStep;
        if (this.errorAccumulator >= this.errorThreshold) {
            frameDurationMicros += this.errorAdjustment;
            this.errorAccumulator -= this.errorThreshold;
        }
        
        const videoFrame = new VideoFrame(canvas, {
            timestamp: timestampMicros,
            duration: frameDurationMicros,
        });

        const isKeyFrame = frameIndex % this.keyFrameInterval === 0;
        this.encoder.encode(videoFrame, { keyFrame: isKeyFrame });
        videoFrame.close();
        
        this.timestampAccumulatorMicros += frameDurationMicros;
        this.frameCount++;
    }

    async finalize(onProgress = null) {
        if (onProgress) {
            onProgress(0, this.chunks.length);
            await new Promise(r => setTimeout(r, 0));
        }
        await this.encoder.flush();
        this.encoder.close();
        
        return this.createWebMBlob(onProgress);
    }

    async createWebMBlob(onProgress = null) {
        const chunks = this.chunks;
        const width = this.width;
        const height = this.height;

        const writeUint = (size, value) => {
            if (size > 4) throw new Error('writeUint: size > 4 not supported, use writeUint64');
            const bytes = new Uint8Array(size);
            for (let i = 0; i < size; i++) {
                bytes[size - 1 - i] = (value >> (8 * i)) & 0xff;
            }
            return bytes;
        };

        const writeUint64 = (value) => {
            const buffer = new ArrayBuffer(8);
            new DataView(buffer).setBigUint64(0, BigInt(value), false);
            return new Uint8Array(buffer);
        };

        const writeInt64 = (value) => {
            const buffer = new ArrayBuffer(8);
            new DataView(buffer).setBigInt64(0, BigInt(value), false);
            return new Uint8Array(buffer);
        };

        const writeVint = (value) => {
            if (value < 0x7f) return new Uint8Array([0x80 | value]);
            if (value < 0x3fff) return new Uint8Array([0x40 | (value >> 8), value & 0xff]);
            if (value < 0x1fffff) return new Uint8Array([0x20 | (value >> 16), (value >> 8) & 0xff, value & 0xff]);
            if (value < 0x0fffffff) return new Uint8Array([0x10 | (value >> 24), (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]);
            return new Uint8Array([0x08, (value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]);
        };

        const writeFloat64 = (value) => {
            const buffer = new ArrayBuffer(8);
            new DataView(buffer).setFloat64(0, value, false);
            return new Uint8Array(buffer);
        };

        const writeString = (str) => new Uint8Array([...str].map(c => c.charCodeAt(0)));

        const concat = (...arrays) => {
            const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
            const result = new Uint8Array(totalLength);
            let offset = 0;
            for (const arr of arrays) {
                result.set(arr, offset);
                offset += arr.length;
            }
            return result;
        };

        const element = (id, data) => {
            const idBytes = new Uint8Array(id);
            const sizeBytes = writeVint(data.length);
            return concat(idBytes, sizeBytes, data);
        };

        const ebmlHeader = element([0x1a, 0x45, 0xdf, 0xa3], concat(
            element([0x42, 0x86], new Uint8Array([0x01])),
            element([0x42, 0xf7], new Uint8Array([0x01])),
            element([0x42, 0xf2], new Uint8Array([0x04])),
            element([0x42, 0xf3], new Uint8Array([0x08])),
            element([0x42, 0x82], writeString('webm')),
            element([0x42, 0x87], new Uint8Array([0x04])),
            element([0x42, 0x85], new Uint8Array([0x02])),
        ));

        const timestampScale = 1000000;
        const firstTimestamp = chunks[0].timestamp;
        const lastChunk = chunks[chunks.length - 1];
        const durationMs = (lastChunk.timestamp + lastChunk.duration - firstTimestamp) / 1000;
        
        // DateUTC: nanoseconds since 2001-01-01T00:00:00 UTC (Matroska epoch)
        const matroskaEpoch = new Date('2001-01-01T00:00:00Z').getTime();
        const dateUTC_ms = (this.videoStartDate ? this.videoStartDate.getTime() : Date.now()) - matroskaEpoch;
        const dateUTC_ns = BigInt(dateUTC_ms) * 1_000_000n;

        const info = element([0x15, 0x49, 0xa9, 0x66], concat(
            element([0x2a, 0xd7, 0xb1], writeUint(4, timestampScale)),
            element([0x4d, 0x80], writeString('Sitrec')),
            element([0x57, 0x41], writeString('Sitrec')),
            element([0x44, 0x89], writeFloat64(durationMs)),
            element([0x44, 0x61], writeInt64(dateUTC_ns)),
        ));

        const fpsRounded = Math.round(this.fps * 1000);
        const is23976 = Math.abs(fpsRounded - 23976) < 10;
        const is29970 = Math.abs(fpsRounded - 29970) < 10;
        
        let defaultDuration;
        if (is23976) {
            defaultDuration = 41708333;
        } else if (is29970) {
            defaultDuration = 33366667;
        } else {
            defaultDuration = Math.floor(1_000_000_000 / this.fps);
        }
        
        const trackEntry = element([0xae], concat(
            element([0xd7], new Uint8Array([0x01])),
            element([0x73, 0xc5], writeUint64(1n)),
            element([0x9c], new Uint8Array([0x00])),
            element([0x23, 0xe3, 0x83], writeUint64(BigInt(defaultDuration))),
            element([0x22, 0xb5, 0x9c], writeString('und')),
            element([0x83], new Uint8Array([0x01])),
            element([0x86], writeString('V_VP8')),
            element([0xe0], concat(
                element([0xb0], writeUint(2, width)),
                element([0xba], writeUint(2, height)),
            )),
        ));

        const tracks = element([0x16, 0x54, 0xae, 0x6b], trackEntry);

        const writeInt16 = (value) => {
            const buffer = new ArrayBuffer(2);
            new DataView(buffer).setInt16(0, value, false);
            return new Uint8Array(buffer);
        };

        const clusters = [];
        const maxClusterDurationMs = 3000;
        let clusterStartIdx = 0;
        let chunksProcessed = 0;

        while (clusterStartIdx < chunks.length) {
            const clusterStartTimeMicros = chunks[clusterStartIdx].timestamp;
            const clusterStartTimeMs = Math.floor(clusterStartTimeMicros / 1000);
            const clusterParts = [];
            clusterParts.push(element([0xe7], writeUint(4, clusterStartTimeMs)));

            let i = clusterStartIdx;
            while (i < chunks.length) {
                const chunk = chunks[i];
                const frameTimeMicros = chunk.timestamp;
                const frameTimeMs = Math.floor(frameTimeMicros / 1000);
                const relativeTimeMs = frameTimeMs - clusterStartTimeMs;

                if (i > clusterStartIdx && relativeTimeMs >= maxClusterDurationMs) {
                    break;
                }

                if (relativeTimeMs < -32768 || relativeTimeMs > 32767) {
                    break;
                }

                const frameData = new Uint8Array(chunk.buffer);
                const trackNum = new Uint8Array([0x81]);
                const timestamp = writeInt16(relativeTimeMs);
                const flags = new Uint8Array([chunk.type === 'key' ? 0x80 : 0x00]);

                const blockData = concat(trackNum, timestamp, flags, frameData);
                const simpleBlock = element([0xa3], blockData);
                clusterParts.push(simpleBlock);
                i++;
                chunksProcessed++;
                
                if (onProgress && chunksProcessed % 10 === 0) {
                    onProgress(chunksProcessed, chunks.length);
                    await new Promise(r => setTimeout(r, 0));
                }
            }

            let clusterDataLength = 0;
            for (const part of clusterParts) {
                clusterDataLength += part.length;
            }
            const clusterData = new Uint8Array(clusterDataLength);
            let offset = 0;
            for (const part of clusterParts) {
                clusterData.set(part, offset);
                offset += part.length;
            }

            clusters.push(element([0x1f, 0x43, 0xb6, 0x75], clusterData));
            clusterStartIdx = i;
        }

        if (onProgress) {
            onProgress(chunks.length, chunks.length);
        }

        // TODO: For better seeking support, add:
        // - SeekHead element (0x114D9B74) before Info to index other top-level elements
        // - Cues element (0x1C53BB6B) with keyframe positions for seeking
        // These are optional but recommended per WebM guidelines
        
        const segmentContent = concat(info, tracks, ...clusters);
        const segmentHeader = new Uint8Array([
            0x18, 0x53, 0x80, 0x67,
            0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff
        ]);
        const segment = concat(segmentHeader, segmentContent);

        return new Blob([ebmlHeader, segment], { type: 'video/webm' });
    }

    getChunks() {
        return this.chunks;
    }

    getFrameCount() {
        return this.frameCount;
    }
}
