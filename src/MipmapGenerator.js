import {CanvasTexture} from "three/src/textures/CanvasTexture";

/**
 * Generates mipmaps for a texture by creating progressively smaller filtered versions
 * Each level is half the resolution of the previous level
 */
export class MipmapGenerator {
    constructor() {
        this.mipmapCache = new Map(); // Cache generated mipmaps
    }

    /**
     * Generate a mipmap level for a given texture
     * @param {Texture} baseTexture - The original texture
     * @param {number} level - Mipmap level (0 = original, 1 = half size, etc.)
     * @returns {CanvasTexture} The generated mipmap texture
     */
    generateMipmapLevel(baseTexture, level) {
        if (level === 0) {
            return baseTexture;
        }

        const cacheKey = `${baseTexture.uuid}_${level}`;
        if (this.mipmapCache.has(cacheKey)) {
            return this.mipmapCache.get(cacheKey);
        }

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        // Calculate dimensions for this mipmap level
        const originalWidth = baseTexture.image.width;
        const originalHeight = baseTexture.image.height;
        const scale = Math.pow(0.5, level);
        
        canvas.width = Math.max(1, Math.floor(originalWidth * scale));
        canvas.height = Math.max(1, Math.floor(originalHeight * scale));
        
        // Enable image smoothing for better filtering
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        
        // Draw the scaled image
        ctx.drawImage(baseTexture.image, 0, 0, canvas.width, canvas.height);
        
        // Create texture from canvas
        const mipmapTexture = new CanvasTexture(canvas);
        mipmapTexture.needsUpdate = true;
        
        // Copy texture properties from original
        mipmapTexture.wrapS = baseTexture.wrapS;
        mipmapTexture.wrapT = baseTexture.wrapT;
        mipmapTexture.magFilter = baseTexture.magFilter;
        mipmapTexture.minFilter = baseTexture.minFilter;
        
        // Cache the generated mipmap
        this.mipmapCache.set(cacheKey, mipmapTexture);
        
        return mipmapTexture;
    }

    /**
     * Generate mipmaps for tiled textures based on zoom level
     * Creates a proper mipmap chain where each level is generated from the previous level
     * @param {Texture} baseTexture - The original seamless texture
     * @param {number} currentZoom - Current zoom level
     * @param {number} maxZoom - Maximum zoom level for this texture
     * @param {boolean} isSeamless - Whether this is a seamless/static texture that doesn't need 2x2 tiling
     * @returns {CanvasTexture} The appropriate mipmap for this zoom level
     */
    generateTiledMipmap(baseTexture, currentZoom, maxZoom, isSeamless = false) {
        if (!baseTexture) {
            throw new Error('MipmapGenerator.generateTiledMipmap: baseTexture is undefined or null');
        }

        if (!baseTexture.uuid) {
            throw new Error('MipmapGenerator.generateTiledMipmap: baseTexture.uuid is undefined');
        }

        if (currentZoom > maxZoom) {
            console.log(`MipmapGenerator: Using original texture for zoom ${currentZoom} (> maxZoom ${maxZoom})`);
            return baseTexture;
        }

        const cacheKey = `tiled_${baseTexture.uuid}_${currentZoom}_${maxZoom}${isSeamless ? '_seamless' : ''}`;
        if (this.mipmapCache.has(cacheKey)) {
            return this.mipmapCache.get(cacheKey);
        }
        
        // For seamless textures, we can use a memory-efficient version of the tiling approach
        if (isSeamless) {
            return this.generateSeamlessMipmapChain(baseTexture, currentZoom, maxZoom, cacheKey);
        }
        
        // Generate the mipmap chain from maxZoom down to currentZoom
        let currentTexture = baseTexture;
        
        // Build the chain from maxZoom down to currentZoom
        for (let zoom = maxZoom - 1; zoom >= currentZoom; zoom--) {
            const levelCacheKey = `tiled_${baseTexture.uuid}_${zoom}_${maxZoom}`;
            
            if (this.mipmapCache.has(levelCacheKey)) {
                currentTexture = this.mipmapCache.get(levelCacheKey);
                continue;
            }
            
            // Generate this level from the previous (higher resolution) level
            currentTexture = this.generateNextMipmapLevel(currentTexture, baseTexture.uuid, zoom, maxZoom);
        }
        
        return currentTexture;
    }

    /**
     * Generate mipmap chain for seamless textures using truly progressive 2x2 tiling
     * Each level is generated from the previous level, not the original texture
     * @param {Texture} baseTexture - The original texture
     * @param {number} currentZoom - Target zoom level
     * @param {number} maxZoom - Maximum zoom level
     * @param {string} finalCacheKey - Cache key for the final result
     * @returns {CanvasTexture} The mipmap texture for the target zoom level
     */
    generateSeamlessMipmapChain(baseTexture, currentZoom, maxZoom, finalCacheKey) {
        if (currentZoom >= maxZoom) {
            return baseTexture;
        }

        // Check if we already have the final result cached
        if (this.mipmapCache.has(finalCacheKey)) {
            return this.mipmapCache.get(finalCacheKey);
        }

        // Generate the mipmap chain progressively - each level from the previous level
        let currentTexture = baseTexture;
        
        // Build the chain from maxZoom down to currentZoom
        for (let zoom = maxZoom - 1; zoom >= currentZoom; zoom--) {
            const levelCacheKey = `tiled_${baseTexture.uuid}_${zoom}_${maxZoom}_seamless`;
            
            if (this.mipmapCache.has(levelCacheKey)) {
                currentTexture = this.mipmapCache.get(levelCacheKey);
                continue;
            }
            
            // Generate this level from the PREVIOUS level (not original texture)
            currentTexture = this.generateProgressiveMipmapLevel(currentTexture, baseTexture.uuid, zoom, maxZoom);
        }
        
        // Cache the final result with the provided cache key
        this.mipmapCache.set(finalCacheKey, currentTexture);
        
        return currentTexture;
    }

    /**
     * Generate next mipmap level progressively (each level from previous level)
     * Creates a 2x2 tiled version of the source, then scales it down to original size
     * This is the correct visual approach but uses minimal memory
     * @param {Texture} sourceTexture - The source texture to downsample (previous level)
     * @param {string} baseUuid - UUID of the original base texture for caching
     * @param {number} targetZoom - The zoom level we're generating
     * @param {number} maxZoom - Maximum zoom level
     * @returns {CanvasTexture} The downsampled texture
     */
    generateProgressiveMipmapLevel(sourceTexture, baseUuid, targetZoom, maxZoom) {
        const cacheKey = `tiled_${baseUuid}_${targetZoom}_${maxZoom}_seamless`;
        
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        // Final canvas is same size as source (not 4x larger like the old method)
        canvas.width = sourceTexture.image.width;
        canvas.height = sourceTexture.image.height;
        
        // Create a small temporary canvas for the 2x2 pattern
        // This is only 4x the FINAL size, not 4x the ORIGINAL size
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        tempCanvas.width = canvas.width * 2;
        tempCanvas.height = canvas.height * 2;
        
        // Enable high-quality image smoothing
        tempCtx.imageSmoothingEnabled = true;
        tempCtx.imageSmoothingQuality = 'high';
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        
        // Draw 2x2 pattern on temp canvas
        tempCtx.drawImage(sourceTexture.image, 0, 0);
        tempCtx.drawImage(sourceTexture.image, canvas.width, 0);
        tempCtx.drawImage(sourceTexture.image, 0, canvas.height);
        tempCtx.drawImage(sourceTexture.image, canvas.width, canvas.height);
        
        // Scale down to final size with filtering
        ctx.drawImage(tempCanvas, 0, 0, canvas.width, canvas.height);
        
        // Properly clean up temporary canvas memory
        tempCanvas.width = 0;
        tempCanvas.height = 0;
        tempCanvas.remove();
        
        // Create texture from canvas
        const mipmapTexture = new CanvasTexture(canvas);
        mipmapTexture.needsUpdate = true;
        
        // Copy texture properties from source
        mipmapTexture.wrapS = sourceTexture.wrapS;
        mipmapTexture.wrapT = sourceTexture.wrapT;
        mipmapTexture.magFilter = sourceTexture.magFilter;
        mipmapTexture.minFilter = sourceTexture.minFilter;
        
        // Cache the generated mipmap
        this.mipmapCache.set(cacheKey, mipmapTexture);
        
        return mipmapTexture;
    }

    /**
     * Generate the next mipmap level (one level lower resolution) - Original method for tiled textures
     * @param {Texture} sourceTexture - The source texture to downsample
     * @param {string} baseUuid - UUID of the original base texture for caching
     * @param {number} targetZoom - The zoom level we're generating
     * @param {number} maxZoom - Maximum zoom level
     * @returns {CanvasTexture} The downsampled texture
     */
    generateNextMipmapLevel(sourceTexture, baseUuid, targetZoom, maxZoom) {
        const cacheKey = `tiled_${baseUuid}_${targetZoom}_${maxZoom}`;
        
//        console.log(`MipmapGenerator: Generating mipmap level ${targetZoom} (2x2 downsample)`);
        
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        // Use the original texture size
        canvas.width = sourceTexture.image.width;
        canvas.height = sourceTexture.image.height;
        
        // Enable high-quality image smoothing for better filtering
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        
        // Create a 2x2 tiled version of the source texture, then scale it down
        // This simulates the effect of viewing 4 tiles as 1 tile at the next zoom level
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        tempCanvas.width = canvas.width * 2;
        tempCanvas.height = canvas.height * 2;
        
        // Draw 2x2 pattern
        tempCtx.drawImage(sourceTexture.image, 0, 0);
        tempCtx.drawImage(sourceTexture.image, canvas.width, 0);
        tempCtx.drawImage(sourceTexture.image, 0, canvas.height);
        tempCtx.drawImage(sourceTexture.image, canvas.width, canvas.height);
        
        // Scale down to original size with filtering
        ctx.drawImage(tempCanvas, 0, 0, canvas.width, canvas.height);
        
        // Create texture from canvas
        const mipmapTexture = new CanvasTexture(canvas);
        mipmapTexture.needsUpdate = true;
        
        // Copy texture properties from source
        mipmapTexture.wrapS = sourceTexture.wrapS;
        mipmapTexture.wrapT = sourceTexture.wrapT;
        mipmapTexture.magFilter = sourceTexture.magFilter;
        mipmapTexture.minFilter = sourceTexture.minFilter;
        
        // Cache the generated mipmap
        this.mipmapCache.set(cacheKey, mipmapTexture);
        
        // Clean up temporary canvas - properly dispose of canvas memory
        tempCanvas.width = 0;
        tempCanvas.height = 0;
        tempCanvas.remove();
        
        return mipmapTexture;
    }

    /**
     * Get cache statistics for debugging
     */
    getCacheStats() {
        const stats = {
            totalEntries: this.mipmapCache.size,
            seamlessEntries: 0,
            tiledEntries: 0,
            memoryEstimate: 0
        };
        
        this.mipmapCache.forEach((texture, key) => {
            if (key.includes('_seamless') || key.startsWith('static_')) {
                stats.seamlessEntries++;
            } else {
                stats.tiledEntries++;
            }
            
            // Rough memory estimate (width * height * 4 bytes per pixel)
            if (texture.image) {
                stats.memoryEstimate += texture.image.width * texture.image.height * 4;
            }
        });
        
        return stats;
    }

    /**
     * Log cache statistics to console
     */
    logCacheStats() {
        const stats = this.getCacheStats();
        console.log('MipmapGenerator Cache Stats:', {
            ...stats,
            memoryEstimateMB: (stats.memoryEstimate / (1024 * 1024)).toFixed(2) + ' MB'
        });
    }

    /**
     * Clear all cached mipmaps
     */
    clearCache() {
        this.mipmapCache.forEach((texture) => {
            texture.dispose();
        });
        this.mipmapCache.clear();
    }

    /**
     * Clear mipmaps for a specific base texture
     */
    clearTextureCache(baseTextureUuid) {
        const keysToDelete = [];
        this.mipmapCache.forEach((texture, key) => {
            if (key.startsWith(baseTextureUuid) || key.includes(`_${baseTextureUuid}_`)) {
                texture.dispose();
                keysToDelete.push(key);
            }
        });
        keysToDelete.forEach(key => this.mipmapCache.delete(key));
    }
}

// Global instance
export const globalMipmapGenerator = new MipmapGenerator();

// Make it available globally for debugging
if (typeof window !== 'undefined') {
    window.MipmapGenerator = globalMipmapGenerator;
}