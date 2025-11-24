import {assert} from "./assert.js";
import {SITREC_SERVER} from "./configUtils";
import {showError} from "./showError";
import {parseBoolean} from "./utils";


export class CRehoster {

    constructor() {
        // this.rehostedFiles = [];
        this.rehostPromises = [];
    }

    async uploadPartWithXHR(blob, url, partNumber, totalParts) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('PUT', url);
            
            xhr.upload.onprogress = (evt) => {
                if (evt.lengthComputable) {
                    const percentComplete = (evt.loaded / evt.total * 100).toFixed(1);
                    console.log(`  Part ${partNumber}/${totalParts}: ${percentComplete}% uploaded`);
                }
            };
            
            xhr.onload = () => {
                if (xhr.status === 200) {
                    const etag = xhr.getResponseHeader('ETag');
                    if (etag) {
                        resolve({
                            ETag: etag.replace(/"/g, ''),
                            PartNumber: partNumber
                        });
                    } else {
                        reject(new Error('No ETag in response'));
                    }
                } else {
                    reject(new Error(`Upload failed with status ${xhr.status}`));
                }
            };
            
            xhr.onerror = () => reject(new Error('Network error during upload'));
            xhr.send(blob);
        });
    }

    async initiateMultipartUpload(filename, version, totalParts) {
        const serverURL = SITREC_SERVER + 'rehost.php?action=initiateMultipart&unique=' + Date.now();
        
        const requestData = {
            filename: filename,
            parts: totalParts
        };
        if (version !== undefined) {
            requestData.version = version;
        }

        const response = await fetch(serverURL, {
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

        const response = await fetch(serverURL, {
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
    async rehostFilePromise(filename, data, version) {
        assert(filename !== undefined, "rehostFile needs a filename")

        if (parseBoolean(process.env.SAVE_TO_S3) && parseBoolean(process.env.USE_S3_PRESIGNED_URLS)) {
            const MULTIPART_THRESHOLD = 100 * 1024 * 1024;
            const CHUNK_SIZE = 50 * 1024 * 1024;

            if (data.byteLength > MULTIPART_THRESHOLD) {
                console.log(`[Multipart Upload] Starting upload for ${filename} (${(data.byteLength / 1024 / 1024).toFixed(2)} MB)`);
                
                try {
                    const totalParts = Math.ceil(data.byteLength / CHUNK_SIZE);
                    console.log(`[Multipart Upload] File will be split into ${totalParts} parts of ~${CHUNK_SIZE / 1024 / 1024}MB each`);

                    const { uploadId, uploadUrls, objectUrl } = await this.initiateMultipartUpload(filename, version, totalParts);
                    console.log(`[Multipart Upload] Initiated with uploadId: ${uploadId}`);

                    const uploadedParts = [];
                    for (let i = 0; i < totalParts; i++) {
                        const start = i * CHUNK_SIZE;
                        const end = Math.min(start + CHUNK_SIZE, data.byteLength);
                        const chunk = data.slice(start, end);
                        
                        console.log(`[Multipart Upload] Uploading part ${i + 1}/${totalParts} (${(chunk.byteLength / 1024 / 1024).toFixed(2)} MB)`);
                        
                        const part = await this.uploadPartWithXHR(chunk, uploadUrls[i], i + 1, totalParts);
                        uploadedParts.push(part);
                        
                        console.log(`[Multipart Upload] Part ${i + 1}/${totalParts} completed (ETag: ${part.ETag.substring(0, 8)}...)`);
                    }

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

            try {
                let requestData = {
                    filename: filename,
                };
                if (version !== undefined) {
                    requestData.version = version;
                }

                const serverURL = SITREC_SERVER + 'rehost.php?action=getPresignedUrl&unique=' + Date.now();

                let response = await fetch(serverURL, {
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
                const { presignedUrl, objectUrl } = presignedData;

                const uploadResponse = await fetch(presignedUrl, {
                    method: 'PUT',
                    body: data,
                    headers: {
                        'Content-Type': 'application/octet-stream',
                    },
                    cache: 'no-store'
                });

                if (!uploadResponse.ok) {
                    throw new Error('S3 upload failed with ' + uploadResponse.status);
                }

                console.log('File uploaded to S3:', objectUrl);

                const resultUrl = objectUrl.replace(/ /g, "%20");

                console.log(`  Sent: ${filename} (version: ${version || 'none'})`);
                console.log(`  Received: ${resultUrl}`);

                return resultUrl;
            } catch (error) {
                showError('Error uploading file to S3:', error);
                throw new Error("S3 upload problem, maybe not logged in?");
            }
        } else {


            try {
                let formData = new FormData();
                formData.append('fileContent', new Blob([data]));
                formData.append('filename', filename);
                if (version !== undefined) {
                    // if we pass in a version number, then the backend (rehost.php) will save the file to
                    // a folder with the file name, and the version within that folder
                    // it will use the extension of the filename for the version
                    formData.append('version', version);
                }

                const serverURL = SITREC_SERVER + 'rehost.php?unique=' + Date.now();

                let response = await fetch(serverURL, {
                    method: 'POST',
                    body: formData,  // Send FormData with file and filename
                    cache: 'no-store'  // Ensure we never cache POST responses
                });

                if (!response.ok) {
                    throw new Error('Server responded with ' + response.status);
                }

                let resultUrl = await response.text();

                // // Remove existing instance of resultUrl, if present
                // // this will ensure we load the files in the same order, but each file just once (the most recent)
                // // e.g. A,B,C,A will be B,C,A
                //
                // const index = this.rehostedFiles.indexOf(resultUrl);
                // if (index > -1) {
                //     this.rehostedFiles.splice(index, 1);
                // }
                //
                // // Push the new resultUrl
                // this.rehostedFiles.push(resultUrl);


                console.log('File uploaded:', resultUrl);

                // // copy the URL to the clipboard
                // navigator.clipboard.writeText(resultUrl).then(() => {
                //     console.log('URL copied to clipboard:', resultUrl);
                // })

                // make resultUrl more shareable by escaping any space with %20
                resultUrl = resultUrl.replace(/ /g, "%20");

                // Diagnostic check: log the returned URL vs what was sent to detect caching issues
                console.log(`  Sent: ${filename} (version: ${version || 'none'})`);
                console.log(`  Received: ${resultUrl}`);

                return resultUrl
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
        let response = await fetch(serverURL, {
            method: 'POST',
            body: formData,  // Send FormData with file and filename
            cache: 'no-store'  // Ensure we never cache POST responses
        });
        if (!response.ok) {
            throw new Error('Server responded with ' + response.status);
        }
        return response;
    }


    rehostFile(filename, data, version) {

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

        var promise = this.rehostFilePromise(filename, data, version)
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