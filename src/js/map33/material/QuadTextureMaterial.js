import {CanvasTexture, TextureLoader} from "three";
import {createTerrainDayNightMaterial} from "./TerrainDayNightMaterial";

const loader = new TextureLoader()


// Queue to hold pending requests
const requestQueue = [];
let activeRequests = 0;
const MAX_CONCURRENT_REQUESTS = 5;

function processQueue() {
  // Process the next request if we have capacity
  if (activeRequests < MAX_CONCURRENT_REQUESTS && requestQueue.length > 0) {
    const nextRequest = requestQueue.shift();
    activeRequests++;
    nextRequest();
  }
}

// Function to load a texture with retries and delay on error
export function loadTextureWithRetries(url, maxRetries = 0, delay = 100, currentAttempt = 0, urlIndex = 0, abortSignal = null) {
  // we expect url to be an array of 1 or more urls which we try in sequence until one works
  // if we are passed in a single string, convert it to an array
  if (typeof url === 'string') {
    url = [url];
  }

  return new Promise((resolve, reject) => {
    // Check if already aborted
    if (abortSignal?.aborted) {
      reject(new Error('Aborted'));
      return;
    }

    const attemptLoad = () => {
      // Check abort signal before each attempt
      if (abortSignal?.aborted) {
        activeRequests--;
        processQueue();
        reject(new Error('Aborted'));
        return;
      }

      loader.load(url[urlIndex],
          // On load
          (texture) => {
            // Check if aborted after loading completes
            if (abortSignal?.aborted) {
              texture.dispose();
              activeRequests--;
              processQueue();
              reject(new Error('Aborted'));
              return;
            }

      //  console.log(`Loaded ${url[urlIndex]} successfully`)

            resolve(texture);
            activeRequests--;
            processQueue();
          },
          // On progress (unused)
          undefined,
          // On error
          (err) => {
            // this is no longer an active request
            activeRequests--;

            // Check if aborted
            if (abortSignal?.aborted) {
              processQueue();
              reject(new Error('Aborted'));
              return;
            }

            // If we have more urls to try, immediately try the next one
            if (urlIndex < url.length - 1) {
//              console.log(`Failed to load ${url[urlIndex]}, trying next url`);
              urlIndex++;
          //    console.log(`urlIndex=${urlIndex}, new url=${url[urlIndex]}`);
              activeRequests++;
              attemptLoad();
            } else if (currentAttempt < maxRetries) {
              console.log(`Retry ${currentAttempt + 1}/${maxRetries} for ${url[urlIndex]} after delay. urlIndex=${urlIndex}`);
              setTimeout(() => {
                // Check abort signal before retry
                if (abortSignal?.aborted) {
                  reject(new Error('Aborted'));
                  return;
                }
                loadTextureWithRetries(url, maxRetries, delay, currentAttempt + 1, urlIndex, abortSignal)
                    .then(resolve)
                    .catch(reject);
              }, delay);
            } else {
              console.log(`Failed to load ${url[urlIndex]} after ${maxRetries} attempts`);
              reject(err);
              processQueue();
            }
          }
      );
    };

    // Set up abort listener
    if (abortSignal) {
      abortSignal.addEventListener('abort', () => {
        reject(new Error('Aborted'));
      });
    }

    if (activeRequests < MAX_CONCURRENT_REQUESTS) {
      activeRequests++;
      attemptLoad();
    } else {
      // Add to queue
      requestQueue.push(attemptLoad);
    }
  });
}


const QuadTextureMaterial = (urls) => {
  return Promise.all(urls.map(url => loadTextureWithRetries(url))).then(maps => {
    // Combine the 4 texture tiles into a single double resolution texture
    // Maps are arranged as: [SW, NW, SE, NE]
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    canvas.width = maps[0].image.width * 2
    canvas.height = maps[0].image.height * 2
    ctx.drawImage(maps[0].image, 0, 0)  // SW - bottom left
    ctx.drawImage(maps[1].image, 0, maps[0].image.height)  // NW - top left
    ctx.drawImage(maps[2].image, maps[0].image.width, 0)  // SE - bottom right
    ctx.drawImage(maps[3].image, maps[0].image.width, maps[0].image.height)  // NE - top right
    
    const texture = new CanvasTexture(canvas)
    texture.needsUpdate = true
    
    // Clean up temporary resources
    canvas.remove()
    maps.forEach(map => map.dispose())

    // Use custom terrain shader with day/night lighting and terrain shading
    return createTerrainDayNightMaterial(texture, 0.3);
  })
}

export default QuadTextureMaterial
