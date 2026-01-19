import {CNodeVideoView} from "./CNodeVideoView";
import {par} from "../par";
import {FileManager, Globals} from "../Globals";

import {SITREC_APP} from "../configUtils";
import {CVideoMp4Data} from "../CVideoMp4Data";
import {CVideoH264Data} from "../CVideoH264Data";
import {CVideoAudioOnly} from "../CVideoAudioOnly";
import {isAudioOnlyFormat} from "../AudioFormats";
import {VideoLoadingManager} from "../CVideoLoadingManager";

export class CNodeVideoWebCodecView extends CNodeVideoView {
    constructor(v) {
        super(v);


    }

    toSerializeCNodeVideoCodecView = ["fileName"]

    modSerialize() {
        return {
            ...super.modSerialize(),
            ...this.simpleSerialize(this.toSerializeCNodeVideoCodecView)

        }
    }

    modDeserialize(v) {
        super.modDeserialize(v)
        this.simpleDeserialize(v, this.toSerializeCNodeVideoCodecView)
        this.positioned = true;
    }



    addDownloadButton() {
        this.removeDownloadButton()
        // make a URL from the name, adding


        // url is either absolute or relative
        // if absolte, then we just return it
        // if it's a relative URL, then we need to add the domain
        // and account for ../
        // a relative path would be something like
        // ../sitrec-videos/private/Area6-1x-speed-08-05-2023 0644UTC.mp4
        // and the root would be something like
        // https://www.metabunk.org/sitrec/
        function getAbsolutePath(url, root) {
            if (url.startsWith("http")) {
                return url;
            }
            if (url.startsWith("../")) {
                // trim the root to the second to last /
                let lastSlash = root.lastIndexOf("/", root.length - 2);
                root = root.slice(0, lastSlash + 1);
                return root + url.slice(3);
            }
            return root + url;
        }

        this.url = getAbsolutePath(this.fileName, SITREC_APP);


        // add a gui link to the file manager gui
        // this will allow the user to download the file
        // or delete it.
        // this will be removed when the node is disposed
        // so we don't need to worry about it.

        // Define an object to hold button functions
        const obj = {
            openURL: () => {
             //   window.open(this.url, '_blank');
                // we have a url to the video file and want to let the user download it
                // so we create a link and click it.
                // this will download the file.
                
                // Temporarily set flag to allow unload without dialog
                Globals.allowUnload = true;
                
                const link = document.createElement('a');

                // Don't encode the URL if it's already encoded (e.g., from S3)
                // Only encode if it contains unencoded spaces or special characters
                // Check if URL is already encoded by looking for % followed by hex digits
                const isAlreadyEncoded = /%[0-9A-Fa-f]{2}/.test(this.url);
                link.href = isAlreadyEncoded ? this.url : encodeURI(this.url);

                link.download = this.fileName;

                console.log("Downloading: " + link.href + " as " + link.download)

                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                
                // Restore the beforeunload protection after a short delay
                setTimeout(() => {
                    Globals.allowUnload = false;
                }, 100);

            }
        };

        // Add a button to the GUI
        this.button = FileManager.guiFolder.add(obj, 'openURL').name('Download Video');
    }

    removeDownloadButton() {
        if (this.button) {
            this.button.destroy();
            this.button = undefined;
        }
    }




    async uploadFile(file, autoAdd = false) {
        const hasExistingVideo = this.videoData !== null && this.videoData !== undefined;
        
        if (hasExistingVideo && !autoAdd) {
            const action = await this.promptAddOrReplace();
            if (action === "replace") {
                this.disposeAllVideos();
            } else {
                this.updateCurrentVideoEntry();
                this.videoData?.stopStreaming?.();
            }
        } else if (hasExistingVideo && autoAdd) {
            this.updateCurrentVideoEntry();
            this.videoData?.stopStreaming?.();
        }

        this._doUploadFile(file);
    }

    _doUploadFile(file) {
        this.fileName = file.name;
        this.staticURL = undefined;

        this.addLoadingMessage()
        
        Globals.pendingActions++;
        this.videoLoadPending = true;
        
        const fileName = file.name.toLowerCase();
        
        if (isAudioOnlyFormat(fileName) || 
            (fileName.endsWith('.mp4') && file.type && file.type.startsWith('audio/'))) {
            console.log("Using audio-only handler for: " + file.name);
            this.videoData = new CVideoAudioOnly({id: this.id + "_data_" + this.videos.length, dropFile: file},
                this.loadedCallback.bind(this), this.errorCallback.bind(this));
        }
        else if (fileName.endsWith('.h264') || file.type === 'video/h264') {
            console.log("Using H.264 specialized handler for: " + file.name);
            this.videoData = new CVideoH264Data({id: this.id + "_data_" + this.videos.length, dropFile: file},
                this.loadedCallback.bind(this), this.errorCallback.bind(this));
        } else {
            this.videoData = new CVideoMp4Data({id: this.id + "_data_" + this.videos.length, dropFile: file},
                this.loadedCallback.bind(this), this.errorCallback.bind(this));
        }
        
        const videoDataId = this.videoData.id;
        VideoLoadingManager.registerLoading(videoDataId, file.name);
        this.videoData._loadingId = videoDataId;
        
        // Add to videos array immediately so menu is populated during loading
        this.addVideoEntry(file.name, undefined, false);
        
        par.frame = 0;
        par.paused = false;
    }



    requestAndLoadFile() {
        par.paused = true;
        var input = document.createElement('input');
        input.type = 'file';

        input.onchange = e => {
            var file = e.target.files[0];
            this.uploadFile(file)
            input.remove();
        }

        input.click();
    }


    dispose() {
        super.dispose()
        this.removeDownloadButton();
    }


}