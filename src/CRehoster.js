import {assert} from "./assert.js";
import {SITREC_SERVER} from "./configUtils";
import {withTestUser} from "./Globals";
import {showError} from "./showError";
import {initUploadProgress, parseBoolean, updateUploadProgress} from "./utils";

async function computeContentHash(data) {
    let buffer;
    if (typeof data === 'string') {
        buffer = new TextEncoder().encode(data);
    } else if (data instanceof ArrayBuffer) {
        buffer = data;
    } else if (data.buffer instanceof ArrayBuffer) {
        buffer = data.buffer;
    } else {
        return null;
    }
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.slice(0, 6).map(b => b.toString(16).padStart(2, '0')).join('');
}

export class CRehoster {

    constructor() {
        // this.rehostedFiles = [];
        this.rehostPromises = [];
    }

    async initiateMultipartUpload(filename, version, totalParts, contentHash) {
        const serverURL = SITREC_SERVER + 'rehost.php?action=initiateMultipart&unique=' + Date.now();
        
        const requestData = {
            filename: filename,
            parts: totalParts
        };
        if (version !== undefined) {
            requestData.version = version;
        }
        if (contentHash) {
            requestData.contentHash = contentHash;
        }

        const response = await fetch(withTestUser(serverURL), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestData),
            cache: 'no-store'
        });

        if (!response.ok) {
            throw new Error('Failed to initiate multipart upload: ' + response.status);
        }

        return await response.json();
    }

    async completeMultipartUpload(filename, version, uploadId, parts) {
        const serverURL = SITREC_SERVER + 'rehost.php?action=completeMultipart&unique=' + Date.now();
        
        const requestData = {
            filename: filename,
            uploadId: uploadId,
            parts: parts
        };
        if (version !== undefined) {
            requestData.version = version;
        }

        const response = await fetch(withTestUser(serverURL), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestData),
            cache: 'no-store'
        });

        if (!response.ok) {
            throw new Error('Failed to complete multipart upload: ' + response.status);
        }

        return await response.json();
    }

    // Function to promise to rehostFile the file from the client to the server
    //
    async rehostFilePromise(filename, data, version, {skipHash = false} = {}) {
        assert(filename !== undefined, "rehostFile needs a filename")

        if (parseBoolean(process.env.SAVE_TO_S3) && parseBoolean(process.env.USE_S3_PRESIGNED_URLS)) {
            const MULTIPART_THRESHOLD = (parseInt(process.env.S3_MULTIPART_THRESHOLD_MB) || 100) * 1024 * 1024;
            const CHUNK_SIZE = (parseInt(process.env.S3_CHUNK_SIZE_MB) || 16) * 1024 * 1024;
            const PARALLEL_UPLOADS = parseInt(process.env.S3_PARALLEL_UPLOADS) || 8;

            if (data.byteLength > MULTIPART_THRESHOLD) {
                console.log(`[Multipart Upload] Starting upload for ${filename} (${(data.byteLength / 1024 / 1024).toFixed(2)} MB)`);
                
                initUploadProgress(filename, data.byteLength);
                
                try {
                    const contentHash = await computeContentHash(data);
                    const uploadStartTime = Date.now();
                    const totalParts = Math.ceil(data.byteLength / CHUNK_SIZE);
                    console.log(`[Multipart Upload] File will be split into ${totalParts} parts of ~${CHUNK_SIZE / 1024 / 1024}MB each, ${PARALLEL_UPLOADS} concurrent uploads`);

                    const initResult = await this.initiateMultipartUpload(filename, version, totalParts, contentHash);
                    
                    if (initResult.exists) {
                        console.log('File already exists on S3:', initResult.objectUrl);
                        return initResult.objectUrl.replace(/ /g, "%20");
                    }
                    
                    const { uploadId, uploadUrls, objectUrl } = initResult;
                    console.log(`[Multipart Upload] Initiated with uploadId: ${uploadId}`);

                    const uploadedBytesPerPart = new Array(totalParts).fill(0);
                    const updateProgress = () => {
                        const totalUploaded = uploadedBytesPerPart.reduce((sum, bytes) => sum + bytes, 0);
                        const elapsedSeconds = (Date.now() - uploadStartTime) / 1000;
                        const speedMbps = elapsedSeconds > 0 ? (totalUploaded * 8 / 1000000) / elapsedSeconds : 0;
                        updateUploadProgress(filename, totalUploaded, data.byteLength, speedMbps);
                    };

                    const uploadPart = async (i) => {
                        const start = i * CHUNK_SIZE;
                        const end = Math.min(start + CHUNK_SIZE, data.byteLength);
                        const chunk = data.slice(start, end);
                        
                        console.log(`[Multipart Upload] Starting part ${i + 1}/${totalParts} (${(chunk.byteLength / 1024 / 1024).toFixed(2)} MB)`);
                        
                        return new Promise((resolve, reject) => {
                            const xhr = new XMLHttpRequest();
                            xhr.open('PUT', uploadUrls[i]);
                            
                            let lastLoggedPercent = -1;
                            let hasLoggedAny = false;
                            
                            xhr.upload.onprogress = (evt) => {
                                if (evt.lengthComputable) {
                                    uploadedBytesPerPart[i] = evt.loaded;
                                    updateProgress();
                                    
                                    const percentComplete = Math.floor(evt.loaded / evt.total * 100);
                                    if (!hasLoggedAny || (percentComplete !== lastLoggedPercent && percentComplete % 5 === 0)) {
                                        console.log(`  Part ${i + 1}/${totalParts}: ${percentComplete}%`);
                                        lastLoggedPercent = percentComplete;
                                        hasLoggedAny = true;
                                    }
                                }
                            };
                            
                            xhr.onload = () => {
                                if (xhr.status === 200) {
                                    const etag = xhr.getResponseHeader('ETag');
                                    if (etag) {
                                        uploadedBytesPerPart[i] = chunk.byteLength;
                                        updateProgress();
                                        console.log(`[Multipart Upload] Part ${i + 1}/${totalParts} completed (ETag: ${etag.substring(1, 9)}...)`);
                                        resolve({
                                            ETag: etag.replace(/"/g, ''),
                                            PartNumber: i + 1
                                        });
                                    } else {
                                        reject(new Error('No ETag in response'));
                                    }
                                } else {
                                    reject(new Error(`Upload failed with status ${xhr.status}`));
                                }
                            };
                            
                            xhr.onerror = () => reject(new Error('Network error during upload'));
                            xhr.send(chunk);
                        });
                    };

                    const uploadQueue = [];
                    for (let i = 0; i < totalParts; i++) {
                        uploadQueue.push(i);
                    }
                    
                    const uploadedParts = [];
                    const activeUploads = new Set();
                    
                    const processQueue = async () => {
                        while (uploadQueue.length > 0 || activeUploads.size > 0) {
                            while (activeUploads.size < PARALLEL_UPLOADS && uploadQueue.length > 0) {
                                const partIndex = uploadQueue.shift();
                                const uploadPromise = uploadPart(partIndex).then(result => {
                                    activeUploads.delete(uploadPromise);
                                    uploadedParts.push(result);
                                    return result;
                                }).catch(error => {
                                    activeUploads.delete(uploadPromise);
                                    throw error;
                                });
                                activeUploads.add(uploadPromise);
                            }
                            
                            if (activeUploads.size > 0) {
                                await Promise.race(activeUploads);
                            }
                        }
                    };
                    
                    await processQueue();
                    uploadedParts.sort((a, b) => a.PartNumber - b.PartNumber);

                    console.log(`[Multipart Upload] All parts uploaded, completing multipart upload...`);
                    const result = await this.completeMultipartUpload(filename, version, uploadId, uploadedParts);

                    const resultUrl = result.objectUrl.replace(/ /g, "%20");
                    
                    console.log(`[Multipart Upload] Success! File uploaded to: ${resultUrl}`);
                    console.log(`  Sent: ${filename} (version: ${version || 'none'})`);
                    console.log(`  Received: ${resultUrl}`);

                    return resultUrl;
                } catch (error) {
                    console.error('[Multipart Upload] Error:', error);
                    showError('Error uploading large file to S3:', error);
                    throw new Error("S3 multipart upload problem: " + error.message);
                }
            }

            initUploadProgress(filename, data.byteLength);

            try {
                const contentHash = skipHash ? null : await computeContentHash(data);
                let requestData = {
                    filename: filename,
                };
                if (contentHash) {
                    requestData.contentHash = contentHash;
                }
                if (version !== undefined) {
                    requestData.version = version;
                }

                const serverURL = SITREC_SERVER + 'rehost.php?action=getPresignedUrl&unique=' + Date.now();

                let response = await fetch(withTestUser(serverURL), {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(requestData),
                    cache: 'no-store'
                });

                if (!response.ok) {
                    throw new Error('Server responded with ' + response.status);
                }

                let presignedData = await response.json();
                
                if (presignedData.exists) {
                    console.log('File already exists on S3:', presignedData.objectUrl);
                    return presignedData.objectUrl.replace(/ /g, "%20");
                }
                
                const { presignedUrl, objectUrl } = presignedData;

                await new Promise((resolve, reject) => {
                    const xhr = new XMLHttpRequest();
                    xhr.open('PUT', presignedUrl);
                    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
                    
                    const uploadStartTime = Date.now();
                    
                    xhr.upload.onprogress = (evt) => {
                        if (evt.lengthComputable) {
                            const elapsedSeconds = (Date.now() - uploadStartTime) / 1000;
                            const speedMbps = elapsedSeconds > 0 ? (evt.loaded * 8 / 1000000) / elapsedSeconds : 0;
                            updateUploadProgress(filename, evt.loaded, evt.total, speedMbps);
                        }
                    };
                    
                    xhr.onload = () => {
                        if (xhr.status === 200) {
                            resolve();
                        } else {
                            reject(new Error(`S3 upload failed with ${xhr.status}`));
                        }
                    };
                    
                    xhr.onerror = () => reject(new Error('Network error during upload'));
                    xhr.send(data);
                });

                console.log('File uploaded to S3:', objectUrl);

                const resultUrl = objectUrl.replace(/ /g, "%20");

                console.log(`  Sent: ${filename} (version: ${version || 'none'})`);
                console.log(`  Received: ${resultUrl}`);

                return resultUrl;
            } catch (error) {
                showError(`Error uploading file ${filename} to S3:`, error);
                throw new Error("S3 upload problem, maybe not logged in?");
            }
        } else {

            initUploadProgress(filename, data.byteLength);

            try {
                let formData = new FormData();
                formData.append('fileContent', new Blob([data]));
                formData.append('filename', filename);
                if (version !== undefined) {
                    formData.append('version', version);
                }

                const serverURL = SITREC_SERVER + 'rehost.php?unique=' + Date.now();

                const resultUrl = await new Promise((resolve, reject) => {
                    const xhr = new XMLHttpRequest();
                    xhr.open('POST', serverURL);
                    
                    const uploadStartTime = Date.now();
                    
                    xhr.upload.onprogress = (evt) => {
                        if (evt.lengthComputable) {
                            const elapsedSeconds = (Date.now() - uploadStartTime) / 1000;
                            const speedMbps = elapsedSeconds > 0 ? (evt.loaded * 8 / 1000000) / elapsedSeconds : 0;
                            updateUploadProgress(filename, evt.loaded, evt.total, speedMbps);
                        }
                    };
                    
                    xhr.onload = () => {
                        if (xhr.status === 200) {
                            resolve(xhr.responseText);
                        } else {
                            reject(new Error(`Server responded with ${xhr.status}`));
                        }
                    };
                    
                    xhr.onerror = () => reject(new Error('Network error during upload'));
                    xhr.send(formData);
                });

                console.log('File uploaded:', resultUrl);

                const escapedUrl = resultUrl.replace(/ /g, "%20");

                console.log(`  Sent: ${filename} (version: ${version || 'none'})`);
                console.log(`  Received: ${escapedUrl}`);

                return escapedUrl;
            } catch (error) {
                showError('Error uploading file:', error);

                throw new Error("Upload problem, maybe not logged in?");
            }

        }

    }

    async deleteFilePromise(filename) {
        let formData = new FormData();
        formData.append('filename', filename);
        formData.append('delete', 'true');
        const serverURL = SITREC_SERVER +'rehost.php?unique=' + Date.now();
        console.log("Deleting file: ", filename, " with URL: ", serverURL);
        let response = await fetch(withTestUser(serverURL), {
            method: 'POST',
            body: formData,  // Send FormData with file and filename
            cache: 'no-store'  // Ensure we never cache POST responses
        });
        if (!response.ok) {
            throw new Error('Server responded with ' + response.status);
        }
        return response;
    }


    rehostFile(filename, data, version, options) {

        let limit = process.env.MAX_FILE_SIZE_MB || 99; // default to 99MB if not set

        // if data is bigger than 99MB then do not rehost it
        if (data.byteLength > limit * 1024 * 1024) {
            console.warn("File is too big to rehost: ", filename, " size: ", data.byteLength, " bytes");
            alert("File is too big to rehost: " + filename + " size: " + data.byteLength + " bytes. Please use a smaller file. Limit = " + limit + " MB");
            return Promise.reject(new Error("File is too big to rehost: " + filename + " size: " + data.byteLength + " bytes. Please use a smaller file."));
        }

        // make surethe filename does not end with a space or a dot
        while (filename.endsWith(" ") || filename.endsWith(".")) {
            assert(0, "Filename should not end with a space or a dot: " + filename);
            console.warn("Filename ends with a space or a dot, removing it: ", filename);
            filename = filename.trim().replace(/\.$/, "");
        }

        var promise = this.rehostFilePromise(filename, data, version, options)
        this.rehostPromises.push(promise);
        return promise;
    }


    waitForAllRehosts() {
        return Promise.all(this.rehostPromises).then(() => {
            console.log("All files have been successfully rehosted.");
            // delete the promises
            this.rehostPromises = [];
            // Perform any action after all files are uploaded
        }).catch(error => {
            showError("An error occurred during file upload for rehost: ", error);
            // Handle errors here
        });
    }
}

// export const Rehoster = new CRehoster();