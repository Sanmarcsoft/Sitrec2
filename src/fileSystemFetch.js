// Custom fetch wrapper that uses File System Access API when available
// This allows loading files from the local filesystem when running from file:// protocol

import {quickFetch} from "./quickFetch";
import {Globals} from "./Globals";

function logNetwork(url, status) {
    if (Globals.regression) {
        console.log(`[NET:${url}:${status}]`);
    }
}

export async function fileSystemFetch(url, options = {}) {
    if (window.location.protocol !== 'file:' || !window.fileSystemDirectoryHandle) {
        return quickFetch(url, options);
    }
    
    if (url.startsWith('http://') || url.startsWith('https://')) {
        return quickFetch(url, options);
    }
    
    // We're running from file:// with directory access and have a relative URL
    console.log("Using File System Access API for:", url);
    logNetwork(url, 'pending');
    
    try {
        // Clean up the URL - remove query strings first
        let filePath = url.split('?')[0];
        
        // Handle file:// URLs by extracting the relative path
        if (filePath.startsWith('file://')) {
            // Extract the absolute path from the file:// URL
            const absolutePath = filePath.substring(7); // Remove 'file://'
            
            // Find the dist-serverless part and extract relative path from there
            const distIndex = absolutePath.indexOf('/dist-serverless/');
            if (distIndex !== -1) {
                // Get everything after dist-serverless/
                filePath = absolutePath.substring(distIndex + '/dist-serverless/'.length);
            } else {
                // Fallback: try to extract just the data/ portion
                const dataIndex = absolutePath.indexOf('/data/');
                if (dataIndex !== -1) {
                    filePath = absolutePath.substring(dataIndex + 1);
                }
            }
        }
        
        // Remove leading slashes and prefixes
        if (filePath.startsWith('./')) {
            filePath = filePath.substring(2);
        }
        if (filePath.startsWith('/')) {
            filePath = filePath.substring(1);
        }
        
        // Navigate through the directory structure
        const pathParts = filePath.split('/');
        let currentHandle = window.fileSystemDirectoryHandle;
        
        // Navigate to the file's directory
        for (let i = 0; i < pathParts.length - 1; i++) {
            try {
                currentHandle = await currentHandle.getDirectoryHandle(pathParts[i]);
            } catch (err) {
                console.error(`Directory not found: ${pathParts[i]} in path ${filePath}`);
                throw err;
            }
        }
        
        // Get the file handle
        const fileName = pathParts[pathParts.length - 1];
        const fileHandle = await currentHandle.getFileHandle(fileName);
        
        // Get the file
        const file = await fileHandle.getFile();
        
        // Determine response type based on file extension or options
        const isBinary = url.endsWith('.bin') ||
                       url.endsWith('.klv') ||
                       url.endsWith('.ts') ||
                       url.endsWith('.jpg') ||
                       url.endsWith('.png') ||
                       url.endsWith('.mp4') ||
                       url.endsWith('.webm') ||
                       url.endsWith('.h264') ||
                       url.endsWith('.dad') ||
                       options.responseType === 'arraybuffer';
        
        // Create a Response object that mimics fetch() response
        let responseBody;
        if (isBinary) {
            responseBody = await file.arrayBuffer();
        } else {
            responseBody = await file.text();
        }
        
        // Create a proper Response object
        const response = new Response(responseBody, {
            status: 200,
            statusText: 'OK',
            headers: new Headers({
                'Content-Type': file.type || 'application/octet-stream',
                'Content-Length': file.size
            })
        });
        
        // Add methods that might be expected
        if (!response.arrayBuffer && isBinary) {
            response.arrayBuffer = async () => responseBody;
        }
        if (!response.text && !isBinary) {
            response.text = async () => responseBody;
        }
        
        console.log(`Successfully loaded ${fileName} via File System Access API`);
        logNetwork(url, 200);
        return response;
        
    } catch (err) {
        console.error("File System Access API fetch failed, falling back to quickFetch:", err);
        logNetwork(url, 500);
        return quickFetch(url, options);
    }
}

// Helper function to check if File System Access API is available and configured
export function isFileSystemAccessAvailable() {
    return window.fileSystemDirectoryHandle !== undefined;
}