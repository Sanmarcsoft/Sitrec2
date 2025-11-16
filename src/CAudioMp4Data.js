import {showError} from "./showError";

export class CAudioMp4Data {
    constructor(videoData) {
        this.videoData = videoData;
        this.audioContext = null;
        this.audioDecoder = null;
        this.isPlaying = false;
        this.volume = 1.0;
        this.isMuted = false;
        this.decodedAudioData = [];
        this.sourceNode = null;
        this.gainNode = null;
        this.isInitialized = false;
        this.audioStartTime = 0;
        this.startFrame = 0;
        this.fps = 30;
        this.audioBuffer = null;
        this.audioBufferSource = null;
        this.lastCombinedSamples = 0;
        this.isBufferSourceStarted = false;
        this.expectedAudioSamples = 0;
        this.receivedEncodedSamples = 0;
        this.decodingComplete = false;
        this._playbackRetryTimeout = null;
        this._lastBufferDecodedCount = 0;
        this._bufferCreationInProgress = false;
        this._bufferCreatedSuccessfully = false;

        this.checkAudioSupport();
    }

    checkAudioSupport() {
        try {
            if (AudioDecoder === undefined) {
                console.warn("AudioDecoder not supported");
                return false;
            }
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            return true;
        } catch (e) {
            console.warn("Audio not supported:", e);
            return false;
        }
    }

    async initializeAudio(demuxer) {
        if (!this.audioContext || this.isInitialized) {
            console.log("Audio already initialized or no context");
            return;
        }

        try {
            const audioConfig = await demuxer.getAudioConfig();
            if (!audioConfig) {
                console.log("No audio track found in video");
                return;
            }

            console.log("Audio config:", audioConfig);

            this.audioDecoder = new AudioDecoder({
                output: audioData => {
                    console.log("Audio frame decoded, numberOfFrames:", audioData.numberOfFrames);
                    this.handleDecodedAudio(audioData);
                },
                error: e => showError("Audio decoder error:", e)
            });

            this.audioDecoder.configure(audioConfig);
            console.log("Audio decoder configured");

            this.setupAudioNodes();

            this.isInitialized = true;
            console.log("Audio initialized successfully");
        } catch (e) {
            showError("Error initializing audio:", e);
        }
    }

    setupAudioNodes() {
        if (!this.audioContext) return;

        this.gainNode = this.audioContext.createGain();
        this.gainNode.gain.value = this.volume;
        this.gainNode.connect(this.audioContext.destination);
    }

    handleDecodedAudio(audioData) {
        this.decodedAudioData.push({
            data: audioData,
            timestamp: audioData.timestamp
        });
    }

    decodeAudioSamples(samples, demuxer) {
        if (!this.audioDecoder) {
            console.warn("Audio decoder not initialized");
            return;
        }

        if (this.audioDecoder.state !== "configured") {
            console.warn("Audio decoder state:", this.audioDecoder.state);
            return;
        }

        console.log("Decoding", samples.length, "audio samples");
        this.receivedEncodedSamples += samples.length;

        for (const sample of samples) {
            const chunk = new EncodedAudioChunk({
                type: sample.is_sync ? "key" : "delta",
                timestamp: sample.cts,
                duration: sample.duration,
                data: sample.data
            });

            try {
                this.audioDecoder.decode(chunk);
            } catch (e) {
                console.warn("Error decoding audio chunk:", e);
            }
        }
    }
    
    setExpectedAudioSamples(count) {
        this.expectedAudioSamples = count;
        console.log("Expected audio samples set to:", count);
    }
    
    checkDecodingComplete() {
        if (this.decodingComplete) return true;
        
        // Decoding is complete when we've received all encoded samples AND the AudioDecoder queue is flushed
        const allSamplesReceived = this.expectedAudioSamples > 0 && this.receivedEncodedSamples >= this.expectedAudioSamples;
        const hasDecodedData = this.decodedAudioData.length > 0;
        const decoderIdle = this.audioDecoder && this.audioDecoder.state === "configured" && this.audioDecoder.decodeQueueSize === 0;
        
        if (allSamplesReceived && hasDecodedData && decoderIdle) {
            // Add a small buffer to ensure all async decoding is done
            if (!this._decodingCompleteCheckTime) {
                this._decodingCompleteCheckTime = Date.now();
                return false;
            }
            
            // Wait 100ms to ensure all audio chunks are decoded
            if (Date.now() - this._decodingCompleteCheckTime > 100) {
                this.decodingComplete = true;
                console.log("Audio decoding complete: received", this.receivedEncodedSamples, "samples, decoded", this.decodedAudioData.length, "chunks");
                return true;
            }
        }
        return false;
    }

    play(startFrame, fps) {
        if (!this.isInitialized || !this.audioContext) {
            console.warn("Audio not initialized or no context");
            return;
        }

        try {
            if (this.audioContext.state === 'suspended') {
                this.audioContext.resume();
            }

            const wasPlaying = this.isPlaying;
            const frameJumped = Math.abs(startFrame - this.startFrame) > 1;

            console.log("Play called: wasPlaying=", wasPlaying, "frameJumped=", frameJumped, "decoded samples=", this.decodedAudioData.length);

            this.isPlaying = true;
            this.fps = fps;
            const needsRestart = !wasPlaying || frameJumped;

            if (needsRestart) {
                this.stopAudioSource();
                this.playAudioBuffer(startFrame, fps);
            }

            this.startFrame = startFrame;
        } catch (e) {
            console.warn("Error playing audio:", e);
        }
    }

    stopAudioSource() {
        if (this._playbackRetryTimeout) {
            clearTimeout(this._playbackRetryTimeout);
            this._playbackRetryTimeout = null;
        }
        if (this.audioBufferSource) {
            try {
                this.audioBufferSource.stop();
            } catch (e) {
                console.warn("Error stopping audio source:", e);
            }
            this.audioBufferSource = null;
        }
        this.isBufferSourceStarted = false;
    }

    createAudioBuffer() {
        if (this._bufferCreationInProgress) {
            console.log("Buffer creation already in progress");
            return false;
        }

        if (!this.decodedAudioData.length) {
            console.log("No decoded audio data to create buffer from");
            return false;
        }

        this._bufferCreationInProgress = true;

        try {
            let totalLength = 0;
            const audioBuffers = [];

            for (const item of this.decodedAudioData) {
                const audioData = item.data;
                totalLength += audioData.numberOfFrames;
                audioBuffers.push(audioData);
            }

            console.log("Creating audio buffer with", audioBuffers.length, "chunks, totalLength=", totalLength, "frames");

            if (audioBuffers.length === 0) {
                return false;
            }

            const firstBuffer = audioBuffers[0];
            const sampleRate = firstBuffer.sampleRate || this.audioContext.sampleRate;
            const numberOfChannels = firstBuffer.numberOfChannels;

            console.log("Audio buffer config: channels=", numberOfChannels, "sampleRate=", sampleRate, "totalFrames=", totalLength);

            this.audioBuffer = this.audioContext.createBuffer(
                numberOfChannels,
                totalLength,
                sampleRate
            );

            let offset = 0;
            for (const audioData of audioBuffers) {
                for (let ch = 0; ch < numberOfChannels; ch++) {
                    const srcBuffer = new Float32Array(audioData.numberOfFrames);
                    audioData.copyTo(srcBuffer, { planeIndex: ch });
                    const dstBuffer = this.audioBuffer.getChannelData(ch);
                    dstBuffer.set(srcBuffer, offset);
                }
                offset += audioData.numberOfFrames;
            }

            this._lastBufferDecodedCount = this.decodedAudioData.length;
            console.log("Audio buffer created successfully");
            return true;
        } catch (e) {
            console.warn("Error creating audio buffer:", e);
            return false;
        } finally {
            this._bufferCreationInProgress = false;
        }
    }

    playAudioBuffer(startFrame, fps) {
        if (!this.isPlaying) {
            console.log("Not playing");
            return;
        }

        if (!this.audioContext) {
            console.log("No audio context");
            return;
        }
        
        // Wait for decoding to complete before playing
        if (!this.checkDecodingComplete()) {
            // Audio not yet fully decoded, retry in 50ms
            if (!this._playbackRetryTimeout) {
                console.log("Waiting for audio decoding to complete. (received", this.receivedEncodedSamples, "/", this.expectedAudioSamples, ", decoded", this.decodedAudioData.length, "chunks)");
                this._playbackRetryTimeout = setTimeout(() => {
                    this._playbackRetryTimeout = null;
                    this.playAudioBuffer(startFrame, fps);
                }, 50);
            }
            return;
        }
        
        if (!this.decodedAudioData.length) {
            console.log("No decoded audio data");
            return;
        }

        try {
            // Only create the buffer once after decoding is complete
            if (!this.audioBuffer || !this._bufferCreatedSuccessfully) {
                if (!this.createAudioBuffer()) {
                    return;
                }
                this._bufferCreatedSuccessfully = true;
            }

            this.stopAudioSource();

            this.audioBufferSource = this.audioContext.createBufferSource();
            this.audioBufferSource.buffer = this.audioBuffer;
            this.audioBufferSource.connect(this.gainNode);

            const offsetTime = Math.max(0, startFrame / fps);
            console.log("Starting audio playback at offsetTime=", offsetTime, "seconds, fps=", fps);
            this.audioBufferSource.start(this.audioContext.currentTime, offsetTime);
            this.isBufferSourceStarted = true;
        } catch (e) {
            console.warn("Error playing audio buffer:", e);
            this.isPlaying = false;
        }
    }

    pause() {
        this.isPlaying = false;
        this.stopAudioSource();
    }

    stop() {
        this.pause();
        this.audioStartTime = 0;
        this.startFrame = 0;
    }

    setVolume(volume) {
        this.volume = Math.max(0, Math.min(1, volume));
        this.isMuted = this.volume === 0;
        if (this.gainNode) {
            this.gainNode.gain.value = this.volume;
        }
    }

    getVolume() {
        return this.volume;
    }

    dispose() {
        if (this._playbackRetryTimeout) {
            clearTimeout(this._playbackRetryTimeout);
            this._playbackRetryTimeout = null;
        }
        this.stopAudioSource();
        if (this.audioDecoder) {
            try {
                this.audioDecoder.close();
            } catch (e) {
                console.warn("Error closing decoder:", e);
            }
            this.audioDecoder = null;
        }
        if (this.audioContext) {
            try {
                this.audioContext.close();
            } catch (e) {
                console.warn("Error closing audio context:", e);
            }
            this.audioContext = null;
        }
        this.decodedAudioData = [];
        this.isInitialized = false;
        this.isPlaying = false;
        this._bufferCreatedSuccessfully = false;
        this.decodingComplete = false;
        this.receivedEncodedSamples = 0;
        this.expectedAudioSamples = 0;
        this._decodingCompleteCheckTime = null;
    }
}
