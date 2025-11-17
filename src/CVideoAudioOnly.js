import {CVideoAndAudio} from "./CVideoAndAudio.js";
import {MP4Demuxer, MP4Source} from "./js/mp4-decode/mp4_demuxer";
import {Sit} from "./Globals.js";
import {EventManager} from "./CEventManager.js";
import {updateSitFrames} from "./UpdateSitFrames";

/**
 * Audio-only video class that plays audio files (mp4, m4a, mp3, wav) with a black video frame
 * Extends CVideoAndAudio to provide audio playback with minimal video overhead
 * 
 * Key features:
 * - Supports MP4, M4A, MP3, and WAV audio files
 * - MP3/WAV files decoded using WebAudio API decodeAudioData for smooth playback
 * - M4A/MP4 files decoded using WebCodec AudioDecoder
 * - Returns black frames with waveform visualization
 * - Full audio playback functionality with precise synchronization
 * - Minimal memory usage (no video decoding)
 * - Compatible with existing video player controls
 */
export class CVideoAudioOnly extends CVideoAndAudio {
    constructor(v, loadedCallback, errorCallback) {
        super(v);
        
        this.loaded = false;
        this.loadedCallback = loadedCallback;
        this.errorCallback = errorCallback;
        this.demuxer = null;
        this.blackFrame = null;
        this.originalFps = 30; // Default fps for audio-only files
        
        // Store filename for debugging
        this.filename = v.dropFile ? v.dropFile.name : (v.filename || "Unknown");
        
        console.log(`[CVideoAudioOnly] Constructor: id=${this.id}, filename=${this.filename}`);
        
        // Set default video dimensions for black frame
        this.videoWidth = 640;
        this.videoHeight = 360;
        
        // Initialize based on source type
        if (v.dropFile) {
            console.log(`[CVideoAudioOnly] Loading from dropped file: ${v.dropFile.name}`);
            this.loadFromFile(v.dropFile);
        } else if (v.filename) {
            console.log(`[CVideoAudioOnly] Loading from URL: ${v.filename}`);
            this.loadFromURL(v.filename);
        } else {
            console.warn(`[CVideoAudioOnly] No file or filename provided`);
        }
    }
    
    /**
     * Load audio from a dropped file
     * @param {File} file - The audio file to load
     */
    loadFromFile(file) {
        const fileName = file.name.toLowerCase();
        console.log(`[CVideoAudioOnly.loadFromFile] Starting: ${file.name}, size=${file.size}`);
        
        // Check if it's an MP3 or WAV file
        if (fileName.endsWith('.mp3') || fileName.endsWith('.wav')) {
            console.log(`[CVideoAudioOnly.loadFromFile] MP3/WAV file detected, using WebAudio API decodeAudioData`);
            this.loadMP3File(file);
        } else {
            console.log(`[CVideoAudioOnly.loadFromFile] MP4/M4A file detected, using MP4 demuxer`);
            // Use MP4 demuxer for M4A and MP4 audio files
            const source = new MP4Source();
            
            console.log(`[CVideoAudioOnly.loadFromFile] Creating FileReader for: ${file.name}`);
            // Read the file as ArrayBuffer and append to MP4Source
            const reader = new FileReader();
            reader.readAsArrayBuffer(file);
            reader.onloadend = () => {
                const buffer = reader.result;
                console.log(`[CVideoAudioOnly.loadFromFile] FileReader onloadend: buffer size=${buffer.byteLength}`);
                buffer.fileStart = 0;
        console.log(`[CVideoAudioOnly.loadFromFile] Appending buffer to MP4Source...`);
                source.file.appendBuffer(buffer);
                console.log(`[CVideoAudioOnly.loadFromFile] Flushing MP4Source...`);
                source.file.flush();
                console.log(`[CVideoAudioOnly.loadFromFile] Flush complete, waiting for source.getInfo()...`);
                
                // Wait for MP4Source to be ready using getInfo() promise
                const infoPromise = source.getInfo();
                console.log(`[CVideoAudioOnly.loadFromFile] getInfo() returned promise:`, infoPromise);
                
                infoPromise.then((info) => {
                    console.log(`[CVideoAudioOnly.loadFromFile] source.getInfo() resolved with info:`, info ? 'YES' : 'NO', typeof info);
                    this.startAudioExtraction(source);
                }).catch((error) => {
                    console.error(`[CVideoAudioOnly.loadFromFile] source.getInfo() error:`, error);
                    if (this.errorCallback) {
                        this.errorCallback(error);
                    }
                });
                
                console.log(`[CVideoAudioOnly.loadFromFile] Promise chain set up, waiting for resolution...`);
            };
            reader.onerror = (error) => {
                console.error(`[CVideoAudioOnly.loadFromFile] FileReader error:`, error);
                if (this.errorCallback) {
                    this.errorCallback(error);
                }
            };
        }
    }
    
    /**
     * Load audio from a URL
     * @param {string} url - The URL of the audio file
     */
    loadFromURL(url) {
        const urlLower = url.toLowerCase();
        
        // Check if it's an MP3 or WAV file
        if (urlLower.endsWith('.mp3') || urlLower.endsWith('.wav')) {
            console.log("MP3/WAV URL detected, using WebAudio API decodeAudioData");
            this.loadMP3URL(url);
        } else {
            // Use MP4 demuxer for M4A and MP4 audio files
            const source = new MP4Source();
            source.onReady = (info) => {
                console.log("Audio file ready from URL:", info);
                this.startAudioExtraction(source);
            };
            source.onError = (error) => {
                console.error("Error loading audio from URL:", error);
                if (this.errorCallback) {
                    this.errorCallback(error);
                }
            };
            source.loadURL(url);
        }
    }
    
    /**
     * Load MP3/WAV file using WebAudio API
     * @param {File} file - The MP3/WAV file to load
     */
    loadMP3File(file) {
        console.log(`[CVideoAudioOnly.loadMP3File] Starting: ${file.name}, size=${file.size}`);
        const reader = new FileReader();
        reader.readAsArrayBuffer(file);
        reader.onloadend = () => {
            const arrayBuffer = reader.result;
            console.log(`[CVideoAudioOnly.loadMP3File] File read complete, buffer size=${arrayBuffer.byteLength}`);
            this.decodeMP3Audio(arrayBuffer);
        };
        reader.onerror = (error) => {
            console.error(`[CVideoAudioOnly.loadMP3File] FileReader error:`, error);
            if (this.errorCallback) {
                this.errorCallback(error);
            }
        };
    }
    
    /**
     * Load MP3/WAV from URL using WebAudio API
     * @param {string} url - The URL of the MP3/WAV file
     */
    loadMP3URL(url) {
        console.log(`[CVideoAudioOnly.loadMP3URL] Starting: url=${url}`);
        fetch(url)
            .then(response => response.arrayBuffer())
            .then(arrayBuffer => {
                console.log(`[CVideoAudioOnly.loadMP3URL] Fetch complete, buffer size=${arrayBuffer.byteLength}`);
                this.decodeMP3Audio(arrayBuffer);
            })
            .catch(error => {
                console.error(`[CVideoAudioOnly.loadMP3URL] Fetch error:`, error);
                if (this.errorCallback) {
                    this.errorCallback(error);
                }
            });
    }
    
    /**
     * Decode MP3/WAV audio data using WebAudio API
     * @param {ArrayBuffer} arrayBuffer - The MP3/WAV audio data
     */
    async decodeMP3Audio(arrayBuffer) {
        console.log(`[CVideoAudioOnly.decodeMP3Audio] Starting decode...`);
        
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            
            console.log(`[CVideoAudioOnly.decodeMP3Audio] Decode complete: duration=${audioBuffer.duration}s, sampleRate=${audioBuffer.sampleRate}, channels=${audioBuffer.numberOfChannels}`);
            
            this.frames = Math.ceil(audioBuffer.duration * this.originalFps);
            this.frames = Math.max(1, this.frames);
            
            console.log(`[CVideoAudioOnly.decodeMP3Audio] Frames calculated: ${this.frames} (fps=${this.originalFps})`);
            
            this.frames *= this.videoSpeed;
            console.log(`[CVideoAudioOnly.decodeMP3Audio] After speed multiplier (${this.videoSpeed}x): ${this.frames} frames`);
            
            Sit.videoFrames = this.frames;
            Sit.fps = this.originalFps;
            updateSitFrames();
            
            this.initializeMP3AudioHandler(audioContext, audioBuffer);
            
            EventManager.dispatchEvent("videoLoaded", {
                videoData: this, 
                width: this.videoWidth, 
                height: this.videoHeight
            });
            
            this.loaded = true;
            if (this.loadedCallback) {
                this.loadedCallback(this);
            }
            console.log(`[CVideoAudioOnly.decodeMP3Audio] Complete!`);
        } catch (error) {
            console.error(`[CVideoAudioOnly.decodeMP3Audio] Decode error:`, error);
            if (this.errorCallback) {
                this.errorCallback(error);
            }
        }
    }
    
    /**
     * Initialize WebAudio-based audio handler for MP3/WAV files
     * @param {AudioContext} audioContext - The audio context
     * @param {AudioBuffer} audioBuffer - The decoded audio buffer
     */
    initializeMP3AudioHandler(audioContext, audioBuffer) {
        console.log(`[CVideoAudioOnly.initializeMP3AudioHandler] Setting up audio handler...`);
        
        const gainNode = audioContext.createGain();
        gainNode.connect(audioContext.destination);
        
        let bufferSource = null;
        let isPlaying = false;
        let lastStartFrame = -1;
        
        this.audioHandler = {
            isPlaying: false,
            isMuted: false,
            volume: 1.0,
            audioContext: audioContext,
            audioBuffer: audioBuffer,
            gainNode: gainNode,
            _bufferCreatedSuccessfully: true,
            
            play: (startFrame, fps) => {
                if (!audioContext || !audioBuffer) return;
                
                try {
                    if (audioContext.state === 'suspended') {
                        audioContext.resume();
                    }
                    
                    const frameJumped = Math.abs(startFrame - lastStartFrame) > 1;
                    const needsRestart = !isPlaying || frameJumped;
                    
                    if (needsRestart) {
                        if (bufferSource) {
                            try {
                                bufferSource.stop(0);
                                bufferSource.disconnect();
                            } catch (e) {}
                            bufferSource = null;
                        }
                        
                        bufferSource = audioContext.createBufferSource();
                        bufferSource.buffer = audioBuffer;
                        bufferSource.connect(gainNode);
                        
                        const startTime = startFrame / fps;
                        const offset = Math.min(startTime, audioBuffer.duration);
                        bufferSource.start(0, offset);
                        
                        isPlaying = true;
                        this.audioHandler.isPlaying = true;
                    }
                    
                    lastStartFrame = startFrame;
                } catch (e) {
                    console.warn("Error playing MP3 audio:", e);
                }
            },
            
            pause: () => {
                if (bufferSource) {
                    try {
                        bufferSource.stop(0);
                        bufferSource.disconnect();
                    } catch (e) {}
                    bufferSource = null;
                }
                isPlaying = false;
                this.audioHandler.isPlaying = false;
            },
            
            stop: () => {
                if (bufferSource) {
                    try {
                        bufferSource.stop(0);
                        bufferSource.disconnect();
                    } catch (e) {}
                    bufferSource = null;
                }
                isPlaying = false;
                this.audioHandler.isPlaying = false;
                lastStartFrame = -1;
            },
            
            setVolume: (volume) => {
                gainNode.gain.value = volume;
                this.audioHandler.volume = volume;
            },
            
            setMuted: (muted) => {
                gainNode.gain.value = muted ? 0 : this.audioHandler.volume;
                this.audioHandler.isMuted = muted;
            },
            
            dispose: () => {
                if (bufferSource) {
                    try {
                        bufferSource.stop(0);
                        bufferSource.disconnect();
                    } catch (e) {}
                    bufferSource = null;
                }
                if (gainNode) {
                    gainNode.disconnect();
                }
                if (audioContext) {
                    audioContext.close();
                }
            }
        };
        
        console.log(`[CVideoAudioOnly.initializeMP3AudioHandler] Audio handler ready`);
    }
    
    /**
     * Start extracting audio from the MP4 source
     * @param {MP4Source} source - The MP4 source containing audio
     */
    startAudioExtraction(source) {
        console.log(`[CVideoAudioOnly.startAudioExtraction] Starting...`);
        this.demuxer = new MP4Demuxer(source);
        console.log(`[CVideoAudioOnly.startAudioExtraction] MP4Demuxer created`);
        
        // Get audio configuration
        console.log(`[CVideoAudioOnly.startAudioExtraction] Calling demuxer.getAudioConfig()...`);
        this.demuxer.getAudioConfig().then(audioConfig => {
            console.log(`[CVideoAudioOnly.startAudioExtraction] getAudioConfig resolved with:`, audioConfig);
            if (!audioConfig) {
                console.warn(`[CVideoAudioOnly.startAudioExtraction] No audio track found in file`);
                if (this.errorCallback) {
                    this.errorCallback("No audio track found");
                }
                return;
            }
            
            console.log(`[CVideoAudioOnly.startAudioExtraction] Audio config:`, audioConfig);
            
            // Calculate frame count based on audio duration
            const duration = this.demuxer.source.duration || 0;
            console.log(`[CVideoAudioOnly.startAudioExtraction] Duration from source: ${duration} microseconds`);
            this.frames = Math.ceil(duration * this.originalFps / 1000000); // duration is in microseconds
            this.frames = Math.max(1, this.frames); // At least 1 frame
            
            console.log(`[CVideoAudioOnly.startAudioExtraction] Frames calculated: ${this.frames} (${this.originalFps} fps)`);
            
            // Apply video speed multiplier
            this.frames *= this.videoSpeed;
            console.log(`[CVideoAudioOnly.startAudioExtraction] After speed multiplier (${this.videoSpeed}x): ${this.frames} frames`);
            
            // Update global frame count
            Sit.videoFrames = this.frames;
            Sit.fps = this.originalFps;
            updateSitFrames();
            
            // Initialize audio handler
            console.log(`[CVideoAudioOnly.startAudioExtraction] Initializing audio handler...`);
            this.initializeAudioHandler(this);
            if (this.audioHandler) {
                this.audioHandler.originalFps = this.originalFps;
            }
            
            // Dispatch videoLoaded event for view setup
            console.log(`[CVideoAudioOnly.startAudioExtraction] Dispatching videoLoaded event...`);
            EventManager.dispatchEvent("videoLoaded", {
                videoData: this, 
                width: this.videoWidth, 
                height: this.videoHeight
            });
            
            // Initialize audio and start extraction
            console.log(`[CVideoAudioOnly.startAudioExtraction] Calling audioHandler.initializeAudio()...`);
            this.audioHandler.initializeAudio(this.demuxer).then(() => {
                console.log(`[CVideoAudioOnly.startAudioExtraction] Audio handler initialized for audio-only playback`);
                
                // Set expected audio sample count
                if (this.demuxer.audioTrack) {
                    console.log(`[CVideoAudioOnly.startAudioExtraction] Setting expected audio samples: ${this.demuxer.audioTrack.nb_samples}`);
                    this.audioHandler.setExpectedAudioSamples(this.demuxer.audioTrack.nb_samples);
                }
                
                // Start extraction with audio-only callback
                console.log(`[CVideoAudioOnly.startAudioExtraction] Starting demuxer extraction...`);
                this.demuxer.start(
                    null, // No video chunks
                    (track_id, samples) => {
                        // Audio samples callback
                        console.log(`[CVideoAudioOnly.startAudioExtraction] Audio samples callback: ${samples.length} samples`);
                        if (this.audioHandler) {
                            this.audioHandler.decodeAudioSamples(samples, this.demuxer);
                        }
                    },
                    () => {
                        // Extraction complete
                        console.log(`[CVideoAudioOnly.startAudioExtraction] Extraction complete callback fired`);
                        this.waitForAudioDecoding();
                    }
                );
            }).catch(error => {
                console.error(`[CVideoAudioOnly.startAudioExtraction] Error initializing audio:`, error);
                if (this.errorCallback) {
                    this.errorCallback(error);
                }
            });
        }).catch(error => {
            console.error(`[CVideoAudioOnly.startAudioExtraction] Error getting audio config:`, error);
            if (this.errorCallback) {
                this.errorCallback(error);
            }
        });
    }
    
    /**
     * Wait for audio decoding to complete before marking as loaded
     */
    waitForAudioDecoding() {
        console.log(`[CVideoAudioOnly.waitForAudioDecoding] Checking decoding status...`);
        if (this.audioHandler && this.audioHandler.checkDecodingComplete()) {
            console.log(`[CVideoAudioOnly.waitForAudioDecoding] Audio decoding complete! Marking as loaded...`);
            this.loaded = true;
            if (this.loadedCallback) {
                console.log(`[CVideoAudioOnly.waitForAudioDecoding] Calling loadedCallback...`);
                this.loadedCallback(this);
            }
            console.log(`[CVideoAudioOnly.waitForAudioDecoding] Complete!`);
        } else if (this.audioHandler && this.audioHandler.expectedAudioSamples > 0) {
            // Audio still decoding, wait a bit
            const decoded = this.audioHandler.decodedAudioData ? this.audioHandler.decodedAudioData.length : 0;
            console.log(`[CVideoAudioOnly.waitForAudioDecoding] Still decoding... expected=${this.audioHandler.expectedAudioSamples}, decoded=${decoded}, waiting 100ms...`);
            this._audioWaitTimeout = setTimeout(() => {
                this.waitForAudioDecoding();
            }, 100);
        } else {
            // No audio or no samples expected, just mark as loaded
            console.log(`[CVideoAudioOnly.waitForAudioDecoding] No audio samples expected, marking as loaded...`);
            this.loaded = true;
            if (this.loadedCallback) {
                console.log(`[CVideoAudioOnly.waitForAudioDecoding] Calling loadedCallback...`);
                this.loadedCallback(this);
            }
            console.log(`[CVideoAudioOnly.waitForAudioDecoding] Complete!`);
        }
    }
    
    /**
     * Create a black frame canvas
     * @returns {HTMLCanvasElement} A black canvas
     */
    createBlackFrame() {
        const canvas = document.createElement('canvas');
        canvas.width = this.videoWidth;
        canvas.height = this.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, this.videoWidth, this.videoHeight);
        return canvas;
    }
    
    /**
     * Draw waveform visualization for current frame
     * @param {CanvasRenderingContext2D} ctx - Canvas context
     * @param {number} frame - Current frame number
     */
    drawWaveform(ctx, frame) {
        if (!this.audioHandler) return;
        
        const canvas = ctx.canvas;
        const waveformWidth = canvas.width * 0.25;
        const waveformHeight = canvas.height * 0.5;
        
        const fps = Sit.fps || this.originalFps || 30;
        const frameTimeSeconds = frame / fps;
        
        let windowAudio;
        const windowSamples = Math.floor(waveformWidth * 2);
        
        if (this.audioHandler.audioBuffer) {
            const audioBuffer = this.audioHandler.audioBuffer;
            const sampleRate = audioBuffer.sampleRate;
            const centerSampleIndex = Math.floor(frameTimeSeconds * sampleRate);
            const startSampleIndex = Math.max(0, centerSampleIndex - windowSamples / 2);
            const endSampleIndex = Math.min(startSampleIndex + windowSamples, audioBuffer.length);
            const actualSamples = endSampleIndex - startSampleIndex;
            
            windowAudio = new Float32Array(windowSamples);
            const channelData = audioBuffer.getChannelData(0);
            windowAudio.set(channelData.slice(startSampleIndex, endSampleIndex));
        } else {
            const decodedAudioData = this.audioHandler.decodedAudioData;
            if (!decodedAudioData || decodedAudioData.length === 0) return;
            
            const firstAudioData = decodedAudioData[0].data;
            const sampleRate = firstAudioData.sampleRate;
            const centerSampleIndex = Math.floor(frameTimeSeconds * sampleRate);
            
            const startSampleIndex = Math.max(0, centerSampleIndex - windowSamples / 2);
            const endSampleIndex = startSampleIndex + windowSamples;
            
            windowAudio = new Float32Array(windowSamples);
            
            for (const item of decodedAudioData) {
                const audioData = item.data;
                const chunkStart = Math.floor((item.timestamp / 1000000) * sampleRate);
                const chunkEnd = chunkStart + audioData.numberOfFrames;
                
                const overlapStart = Math.max(startSampleIndex, chunkStart);
                const overlapEnd = Math.min(endSampleIndex, chunkEnd);
                
                if (overlapStart >= overlapEnd) continue;
                
                const chunkOffset = overlapStart - chunkStart;
                const windowStart = Math.max(0, overlapStart - startSampleIndex);
                const sampleCount = overlapEnd - overlapStart;
                
                const chunkSamples = new Float32Array(audioData.numberOfFrames);
                audioData.copyTo(chunkSamples, { planeIndex: 0 });
                
                windowAudio.set(chunkSamples.slice(chunkOffset, chunkOffset + sampleCount), windowStart);
            }
        }
        
        const centerX = (canvas.width - waveformWidth) / 2;
        const centerY = (canvas.height - waveformHeight) / 2;
        
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 2;
        ctx.beginPath();
        
        const samplesPerPixel = Math.max(1, Math.floor(windowSamples / waveformWidth));
        let firstPoint = true;
        
        for (let px = 0; px < waveformWidth; px++) {
            const sampleIndex = Math.floor(px * samplesPerPixel);
            if (sampleIndex >= windowSamples) break;
            
            const sample = windowAudio[sampleIndex];
            const amplitude = Math.abs(sample) * waveformHeight;
            const y = centerY + waveformHeight / 2 - amplitude;
            const x = centerX + px;
            
            if (firstPoint) {
                ctx.moveTo(x, y);
                firstPoint = false;
            } else {
                ctx.lineTo(x, y);
            }
        }
        
        ctx.stroke();
    }
    
    /**
     * Get the image for a specific frame
     * Returns a black frame with waveform visualization for audio-only files
     * @param {number} frame - Frame number
     * @returns {HTMLCanvasElement} A canvas with black background and waveform
     */
    getImage(frame) {
        const canvas = this.createBlackFrame();
        const ctx = canvas.getContext('2d');
        this.drawWaveform(ctx, frame);
        return canvas;
    }
    
    /**
     * Update method - handles audio playback state
     */
    update() {
        // Audio playback is handled by the audio handler
        // No video-specific updates needed
    }
    
    /**
     * Clean up resources
     */
    dispose() {
        if (this.blackFrame) {
            this.blackFrame = null;
        }
        
        if (this.demuxer) {
            if (this.demuxer.source && this.demuxer.source.file) {
                try {
                    this.demuxer.source.file.stop();
                } catch (e) {
                }
            }
            this.demuxer = null;
        }
        
        this.loadedCallback = null;
        this.errorCallback = null;
        
        super.dispose();
    }
}