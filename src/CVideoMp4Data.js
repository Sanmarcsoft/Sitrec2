import {FileManager, Sit} from "./Globals";
import {assert} from "./assert";
import {MP4Demuxer, MP4Source} from "./js/mp4-decode/mp4_demuxer";
import {CVideoWebCodecBase} from "./CVideoWebCodecBase";
import {updateSitFrames} from "./UpdateSitFrames";
import {EventManager} from "./CEventManager";
import {showError} from "./showError";
import {CAudioMp4Data} from "./CAudioMp4Data";

// MP4 video data handler using WebCodec API
// Handles MP4/MOV files with demuxing and frame caching
export class CVideoMp4Data extends CVideoWebCodecBase {


    constructor(v, loadedCallback, errorCallback) {
        super(v, loadedCallback, errorCallback);

        if (this.incompatible) {
            return;
        }

        this.audioHandler = null;

        let source = new MP4Source()

        // here v.file, if defined is a file name
        // either a URL or a local file
        // check for local file (i.e. file on the user's computer loaded with a file picker)
        // if it's got no forward slashes, then it's a local file


        // QUESTION: why do we need to use the file manager here?
        // why not load the file directly?
        // ANSWER The file manager does some parsing of the path???

        if (v.file !== undefined ) {
            FileManager.loadAsset(v.file, "video").then(result => {
                // the file.appendBuffer expects an ArrayBuffer with a fileStart value (a byte offset) and
                // and byteLength (total byte length)
                result.parsed.fileStart = 0;        // patch in the fileStart of 0, as this is the whole thing
                this.videoDroppedData = result.parsed;
                source.file.appendBuffer(result.parsed)
                source.file.flush();

                // Remove it from the file manager
                // as we only need it for the initial load
                FileManager.disposeRemove("video");
            })
        } else {

            // Handle drag and drop files
            // v.dropFile is a File object, which comes from DragDropHandler
            if (v.dropFile !== undefined) {
                let reader = new FileReader()
                reader.readAsArrayBuffer(v.dropFile)
                // could maybe do partial loads, but this is local, so it's loading fast
                // however would be a faster start.
                reader.onloadend = () => {
                    // reader.result will be an ArrayBuffer
                    // the file.appendBuffer expects an ArrayBuffer with a fileStart value (a byte offset) and
                    // and byteLength (total byte length)
                    this.videoDroppedData = reader.result;
                    this.videoDroppedURL = null;
                    reader.result.fileStart = 0;        // patch in the fileStart of 0, as this is the whole thing
                    source.file.appendBuffer(reader.result)
                    source.file.flush();
                }
            }
        }

        this.demuxer = new MP4Demuxer(source);
        this.startWithDemuxer(this.demuxer)

    }

    /**
     * Override decoder callbacks for MP4-specific logic
     */
    createDecoderCallbacks() {
        return {
            output: videoFrame => {
                this.format = videoFrame.format;
                this.lastDecodeInfo = "last frame.timestamp = " + videoFrame.timestamp + "<br>";

                var groupNumber = 0;
                // find the group this frame is in
                while (groupNumber + 1 < this.groups.length && videoFrame.timestamp >= this.groups[groupNumber + 1].timestamp)
                    groupNumber++;
                var group = this.groups[groupNumber];

                // calculate the frame number we are decoding from how many are left
                const frameNumber = group.frame + group.length - group.pending;
                
                this.processDecodedFrame(frameNumber, videoFrame, group);
            },
            error: e => showError(e),
        };
    }

    /**
     * Override group completion handling for MP4-specific nextRequest logic
     */
    handleGroupComplete() {
        if (this.groupsPending === 0 && this.nextRequest >= 0) {
            console.log("FULFILLING deferred request as no groups pending, frame = " + this.nextRequest);
            this.requestGroup(this.nextRequest);
            this.nextRequest = -1;
        }
    }

    /**
     * Override busy decoder handling for MP4-specific nextRequest logic
     */
    handleBusyDecoder(group) {
        this.nextRequest = group;
    }

    startWithDemuxer(demuxer) {
        // Reset common variables (base class handles initialization)
        this.initializeCommonVariables();
        this.nextRequest = -1; // MP4 specific: uses -1 instead of null

        this.decoder = this.createDecoder();

        this.demuxFrame = 0;

        demuxer.getConfig().then((config) => {
//            offscreen.height = config.codedHeight;
//            offscreen.width = config.codedWidth;

            // video width and height are needed for things like the video tracking overlay
            // it's set for the Image objects created below, but at the start we use the config
            this.videoWidth = config.codedWidth;
            this.videoHeight = config.codedHeight;

            console.log("🍿Setting Video width and height to ", config.codedWidth, "x", config.codedHeight )

            this.config = config;
            this.decoder.configure(config);

            // NOT HANDLED YET - get the rotation angle from the video matrix
            this.angle = getRotationAngleFromVideoMatrix(demuxer.videoTrack.matrix);

            // Initialize audio handler
            console.log("Creating audio handler");
            this.audioHandler = new CAudioMp4Data(this);
            
            const completeExtraction = () => {
                const waitForAudioDecoding = () => {
                    // Check if audio decoding is complete
                    if (this.audioHandler && this.audioHandler.checkDecodingComplete()) {
                        console.log("Audio decoding confirmed complete, proceeding with video load");
                        finishLoading();
                    } else if (this.audioHandler && this.audioHandler.expectedAudioSamples > 0) {
                        // Still waiting for audio decoding, check again in 50ms
                        console.log("Waiting for audio decoding... received", this.audioHandler.receivedEncodedSamples, "/", this.audioHandler.expectedAudioSamples, "encoded, decoded", this.audioHandler.decodedAudioData.length);
                        setTimeout(waitForAudioDecoding, 50);
                    } else {
                        // No audio, proceed immediately
                        console.log("No audio or audio not initialized, proceeding with video load");
                        finishLoading();
                    }
                };
                
                const finishLoading = () => {
                    // at this point demuxing should be done, so we should have an accurate frame count
                    // note, that's only true if we are not loading the video async
                    // (i.e. the entire video is loaded before we start decoding)
                    console.log("Demuxing done (assuming not async loading), frames = " + this.frames + ", Sit.videoFrames = " + Sit.videoFrames)
                    console.log("Demuxer calculated frames as " + demuxer.source.totalFrames)
                    //assert(this.frames === demuxer.source.totalFrames, "Frames mismatch between demuxer and decoder"+this.frames+"!="+demuxer.source.totalFrames)

                    // use the demuxer frame count, as it's more accurate
                    Sit.videoFrames = demuxer.source.totalFrames * this.videoSpeed;

                    // also update the fps
                    Sit.fps = demuxer.source.fps;

                    updateSitFrames()

                    this.loadedCallback();

                    // console.log("🍿🍿🍿Dispatching videoLoaded event")
                    EventManager.dispatchEvent("videoLoaded", {videoData: this, width: config.codedWidth, height: config.codedHeight});
                };
                
                waitForAudioDecoding();
            };
            
            this.audioHandler.initializeAudio(demuxer).then(() => {
                console.log("Audio handler initialized, starting extraction with both video and audio");
                
                // Set expected audio sample count for the audio handler
                if (demuxer.audioTrack) {
                    this.audioHandler.setExpectedAudioSamples(demuxer.audioTrack.nb_samples);
                }
                
                // Now start extraction with both video and audio callbacks
                demuxer.start(
                    (chunk) => {
                        // The demuxer will call this for each chunk it demuxes
                        // essentiall it's iterating through the frames
                        // each chunk is either a key frame or a delta frame
                        chunk.frameNumber = this.demuxFrame++
                        this.chunks.push(chunk)

                        if (chunk.type === "key") {
                            this.groups.push({
                                    frame: this.chunks.length - 1,  // first frame of this group
                                    length: 1,                      // for now, increase with each delta demuxed
                                    pending: 0,                     // how many frames requested and pending
                                    loaded: false,                  // set when all the frames in the group are loaded
                                    timestamp: chunk.timestamp,
                                }
                            )
                        } else {
                            const lastGroup = this.groups[this.groups.length - 1]
                            assert(chunk.timestamp >= lastGroup.timestamp, "out of group chunk timestamp")
                            lastGroup.length++;
                        }

                        // console.log(this.chunks.length - 1 + ": Demuxer got a " + chunk.type + " chunk, timestamp=" + chunk.timestamp +
                        //      ", duration = " + chunk.duration + ", byteLength = " + chunk.byteLength)

                        this.frames++;
                        Sit.videoFrames = this.frames * this.videoSpeed;
                        // Sit.aFrame = 0;
                        // Sit.bFrame = Sit.videoFrames-1;

                        // decoding is now deferred
                        //            decoder.decode(chunk);
                    },
                    (track_id, samples) => {
                        // Audio samples callback
                        console.log("Audio samples callback received with", samples.length, "samples");
                        if (this.audioHandler) {
                            this.audioHandler.decodeAudioSamples(samples, demuxer);
                        }
                    },
                    completeExtraction
                );
            }).catch(e => {
                console.warn("Audio initialization failed:", e);
                // Still start video extraction if audio fails
                demuxer.start((chunk) => {
                    chunk.frameNumber = this.demuxFrame++
                    this.chunks.push(chunk)

                    if (chunk.type === "key") {
                        this.groups.push({
                                frame: this.chunks.length - 1,
                                length: 1,
                                pending: 0,
                                loaded: false,
                                timestamp: chunk.timestamp,
                            }
                        )
                    } else {
                        const lastGroup = this.groups[this.groups.length - 1]
                        assert(chunk.timestamp >= lastGroup.timestamp, "out of group chunk timestamp")
                        lastGroup.length++;
                    }
                    this.frames++;
                    Sit.videoFrames = this.frames * this.videoSpeed;
                }, null, completeExtraction);
            });

        });

    }



    /**
     * Override config info to show MP4-specific properties
     */
    getDebugConfigInfo() {
        const fps = Sit.fps ? ` @ ${Sit.fps}fps` : '';
        return "Config: Codec: " + this.config.codec + "  format:" + this.format + " " + this.config.codedWidth + "x" + this.config.codedHeight + fps;
    }

    /**
     * Override group info to show MP4-specific format with timestamps
     */
    getDebugGroupInfo(groupIndex, group, images, imageDatas, framesCaches, currentGroup) {
        return "Group " + groupIndex + " f = " + group.frame + " l = " + group.length + " ts = " + group.timestamp
            + " i = " + images + " id = " + imageDatas + " fc = "
            + framesCaches
            + (group.loaded ? " Loaded " : "")
            + (currentGroup === group ? "*" : " ")
            + (group.pending ? "pending = " + group.pending : "");
    }

    dispose() {
        if (this.audioHandler) {
            this.audioHandler.dispose();
            this.audioHandler = null;
        }
        super.dispose();
    }

}


function getRotationAngleFromVideoMatrix(matrix) {
    // Extract matrix elements and normalize by dividing by 65536
    const a = matrix[0] / 65536;
    const b = matrix[1] / 65536;
    const c = matrix[3] / 65536;
    const d = matrix[4] / 65536;

    if (a === 0 && b === 1 && c === -1 && d === 0) {
        return 90;
    } else if (a === -1 && b === 0 && c === 0 && d === -1) {
        return 180;
    } else if (a === 0 && b === -1 && c === 1 && d === 0) {
        return 270;
    } else {
        return 0;
    }
}

