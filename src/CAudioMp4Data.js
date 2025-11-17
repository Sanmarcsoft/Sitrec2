/**
 * Audio handler for MP4 video files using WebCodec AudioDecoder
 * Manages audio extraction, decoding, and synchronized playback
 * 
 * Key responsibilities:
 * - Decodes audio samples from MP4 demuxer using AudioDecoder
 * - Creates and manages Web Audio API context and nodes
 * - Synchronizes audio playback with video frame position
 * - Handles volume control and muting
 * - Manages audio buffer creation and playback timing
 * 
 * Synchronization approach:
 * - Waits for all audio samples to be decoded before playback
 * - Creates single AudioBuffer from all decoded chunks
 * - Uses AudioBufferSourceNode for precise timing control
 * - Restarts playback when frame position jumps
 * 
 * Disposal strategy:
 * - Immediately stops audio playback with stop(0)
 * - Disconnects audio nodes from graph
 * - Suspends AudioContext before closing
 * - Clears all timeouts and resources
 */
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
        this.playbackStartTime = 0;
        this.playbackStartFrame = 0;

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

            // Check if the codec is supported
            if (!audioConfig.codec) {
                console.warn("No codec specified in audio config");
                return;
            }

            // Check codec support before trying to configure
            try {
                const support = await AudioDecoder.isConfigSupported(audioConfig);
                if (!support.supported) {
                    console.warn("Audio codec not supported:", audioConfig.codec);
                    console.warn("Config details:", audioConfig);
                    return;
                }
            } catch (e) {
                console.warn("Error checking audio codec support:", e);
                return;
            }

            this.audioDecoder = new AudioDecoder({
                output: audioData => {
                    console.log("Audio frame decoded, numberOfFrames:", audioData.numberOfFrames);
                    this.handleDecodedAudio(audioData);
                },
                error: e => {
                    console.error("Audio decoder error:", e);
                    // Don't show error dialog for audio issues, just log them
                    // This allows video to continue playing even if audio fails
                }
            });

            this.audioDecoder.configure(audioConfig);
            console.log("Audio decoder configured successfully with codec:", audioConfig.codec);

            this.setupAudioNodes();

            this.isInitialized = true;
            console.log("Audio initialized successfully");
        } catch (e) {
            console.error("Error initializing audio:", e);
            // Don't show error dialog, allow video to continue without audio
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
    
    /**
     * Check if all audio samples have been decoded and are ready for playback
     * Uses multiple conditions to ensure decoding is truly complete:
     * - All expected samples received
     * - Decoder queue is empty
     * - Small time buffer to handle async operations
     * @returns {boolean} True when audio is fully decoded and ready
     */
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

    /**
     * Start or resume audio playback synchronized with video frame
     * @param {number} startFrame - Current video frame number
     * @param {number} fps - Video frame rate for timing calculations
     */
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
                this.playbackStartTime = this.audioContext.currentTime;
                this.playbackStartFrame = startFrame;
                this.playAudioBuffer(startFrame, fps);
            }

            this.startFrame = startFrame;
        } catch (e) {
            console.warn("Error playing audio:", e);
        }
    }

    /**
     * Immediately stop audio playback and disconnect from audio graph
     * Critical for instant audio stopping when switching videos
     */
    stopAudioSource() {
        if (this._playbackRetryTimeout) {
            clearTimeout(this._playbackRetryTimeout);
            this._playbackRetryTimeout = null;
        }
        if (this.audioBufferSource) {
            try {
                // Immediately stop the audio source
                this.audioBufferSource.stop(0);
                // Disconnect it from the audio graph to ensure no more audio is processed
                this.audioBufferSource.disconnect();
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
        
        // Ensure audio context is running during wait
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
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

            // Calculate offset time using original fps, then set playback rate based on fps ratio
            const originalFps = this.originalFps || fps;
            
            // Account for time elapsed while waiting for audio decoding
            const timeElapsed = this.audioContext.currentTime - (this.playbackStartTime || this.audioContext.currentTime);
            const currentFrame = this.playbackStartFrame + (timeElapsed * fps);
            
            // Use current frame to calculate offset, ensuring sync
            const offsetTime = Math.max(0, currentFrame / originalFps);
            const playbackRate = fps / originalFps;
            
            this.audioBufferSource.playbackRate.value = playbackRate;
            
            console.log("Starting audio playback: currentFrame=", currentFrame, "offsetTime=", offsetTime.toFixed(3), "seconds, timeElapsed=", timeElapsed.toFixed(3), "originalFps=", originalFps, "playbackRate=", playbackRate);
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

    /**
     * Complete cleanup of all audio resources
     * Ensures immediate audio stopping and proper resource release
     * Key steps:
     * 1. Stop playback immediately with stop(0)
     * 2. Disconnect all audio nodes
     * 3. Suspend AudioContext to halt processing
     * 4. Close AudioContext and decoder
     * 5. Clear all data and state
     */
    dispose() {
        if (this._playbackRetryTimeout) {
            clearTimeout(this._playbackRetryTimeout);
            this._playbackRetryTimeout = null;
        }
        
        // Immediately stop any playing audio source
        this.stopAudioSource();
        
        // Disconnect the gain node from the audio graph
        if (this.gainNode) {
            try {
                this.gainNode.disconnect();
            } catch (e) {
                // Ignore errors if already disconnected
            }
            this.gainNode = null;
        }
        
        // Suspend and close the audio context immediately to stop all audio processing
        if (this.audioContext) {
            try {
                // Set the state to closed immediately by suspending first
                if (this.audioContext.state !== 'closed') {
                    // Suspend immediately stops all audio processing
                    this.audioContext.suspend();
                }
                // Then close the context to release resources
                this.audioContext.close();
            } catch (e) {
                console.warn("Error closing audio context:", e);
            }
            this.audioContext = null;
        }
        
        if (this.audioDecoder) {
            try {
                this.audioDecoder.close();
            } catch (e) {
                console.warn("Error closing decoder:", e);
            }
            this.audioDecoder = null;
        }
        
        // Clear all audio data
        this.audioBuffer = null;
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
