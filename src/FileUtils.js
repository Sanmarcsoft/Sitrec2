import {writeToClipboard} from "./urlUtils";
import {par} from "./par";

/**
 * Save contents directly to a file handle in a directory, without showing a picker.
 * @param {Blob} contents - The content to write
 * @param {FileSystemDirectoryHandle} directoryHandle - The directory to write into
 * @param {string} filename - The filename to create/overwrite
 * @returns {Promise<string>} The filename that was saved
 */
export async function saveFileToDirectory(contents, directoryHandle, filename) {
    const fileHandle = await directoryHandle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(contents);
    await writable.close();
    console.log('File saved to working folder:', filename);
    return filename;
}

/**
 * Save contents directly to an existing file handle, without showing a picker.
 * @param {Blob} contents - The content to write
 * @param {FileSystemFileHandle} fileHandle - The target file handle
 * @returns {Promise<string>} The filename that was saved
 */
export async function saveFileToHandle(contents, fileHandle) {
    const writable = await fileHandle.createWritable();
    await writable.write(contents);
    await writable.close();
    console.log('File saved to existing handle:', fileHandle.name);
    return fileHandle.name;
}

/**
 * Prompt for a file location and save there.
 * @param {Blob} contents - The content to write
 * @param {string} [suggestedName='download.txt'] - Suggested filename in picker
 * @returns {Promise<{name: string, fileHandle: FileSystemFileHandle}>}
 */
export async function saveFilePrompted(contents, suggestedName = 'download.txt') {
    try {
        // 1. Prompt user with the "save file" dialog
        const fileHandle = await window.showSaveFilePicker({
            suggestedName,
            types: [{
                description: 'Text File',
                accept: {
//                    'text/plain': ['.txt'],
                    'application/json': ['.json'],
                }
            }]
        });

        // 2. Create a writable stream
        const writable = await fileHandle.createWritable();

        // 3. Write the contents
        await writable.write(contents);

        // 4. Close the file and finalize the save
        await writable.close();

        console.log('File saved successfully!');

        return {
            name: fileHandle.name,
            fileHandle
        };

    } catch (err) {
        console.warn('Save canceled or failed:', err);
        throw err;
    }
}

export function createCustomModalWithCopy(url) {
    // Create the modal container
    const modal = document.createElement('div');
    modal.style.display = 'none';
    modal.style.position = 'fixed';
    modal.style.zIndex = '10001';
    modal.style.left = '0';
    modal.style.top = '0';
    modal.style.width = '100%';
    modal.style.height = '100%';
    modal.style.backgroundColor = 'rgba(0,0,0,0.4)';

    // Create the modal content container
    const modalContent = document.createElement('div');
    modalContent.style.backgroundColor = '#fefefe';
    modalContent.style.margin = '15% auto';
    modalContent.style.padding = '20px';
    modalContent.style.border = '1px solid #888';
    modalContent.style.width = '50%';

    // Create the close button
    const closeButton = document.createElement('span');
    closeButton.innerHTML = '&times;';
    closeButton.style.color = '#aaa';
    closeButton.style.float = 'right';
    closeButton.style.fontSize = '28px';
    closeButton.style.fontWeight = 'bold';
    closeButton.style.cursor = 'pointer';

    function closeModal() {
        modal.style.display = 'none';
        // remove it from the DOM
        document.body.removeChild(modal);
        // remove the event listener
        closeButton.onclick = null;
    }

    // Close modal event and cleanup
    closeButton.onclick = function () {
        closeModal();
    };

    // Append the close button to the modal content
    modalContent.appendChild(closeButton);

    // Create and append the URL text
    const urlText = document.createElement('p');
    urlText.textContent = url;
    modalContent.appendChild(urlText);

    function addModalButton(text, onClick) {
        // Create and append the Copy button
        const button = document.createElement('button');
        button.textContent = text;
        button.onclick = onClick;
        button.style.margin = '5px';
        modalContent.appendChild(button);
    }


    addModalButton('Copy URL', function () {
        writeToClipboard(url)
        closeModal()
    });

    addModalButton('Copy & Open', function () {
        writeToClipboard(url)
        closeModal();
        par.paused = true;
        // Open this url in a new tab
        window.open(url, '_blank');
    });


    // Append the modal content to the modal
    modal.appendChild(modalContent);

    // Append the modal to the body
    document.body.appendChild(modal);

    // Function to display the modal
    const showModal = function () {
        modal.style.display = 'block';
    };

    // Return the showModal function to allow opening the modal
    return showModal;
}

// Given an ArrayBuffer and a MIME type (e.g. 'image/jpeg' or 'image/png'),
// create an Image object from it.
// Note that we have to return a promise as the Image loading is async,
// even when from a blob/URL
export function createImageFromArrayBuffer(arrayBuffer, type) {
    return new Promise((resolve, reject) => {
        // Create a blob from the ArrayBuffer
        const blob = new Blob([arrayBuffer], {type: type});

        // Create an object URL for the blob
        const url = URL.createObjectURL(blob);

        // Create a new Image and set its source to the object URL
        const img = new Image();
        img.onload = () => {
            console.log("Done with " + url);
            // Release the object URL after the image has been loaded
            URL.revokeObjectURL(url);
            resolve(img); // Resolve the promise with the Image object
        };
        img.onerror = reject; // Reject the promise if there's an error loading the image
        img.src = url;
    });
}
