/**
 * DeviceOrientationCompass - Shared library for device orientation and compass functionality
 * 
 * Provides cross-platform (iOS/Android) compass heading and device elevation/tilt readings
 * using device orientation sensors.
 * 
 * Features:
 * - iOS webkitCompassHeading support with tilt correction
 * - Android deviceorientationabsolute support
 * - Screen orientation adjustment (portrait/landscape)
 * - Permission handling for iOS 13+
 * - Smooth handling of edge cases (e.g., iOS 135° beta flip)
 * 
 * Usage:
 *   import { DeviceOrientationCompass } from './DeviceOrientationCompass.js';
 *   
 *   const compass = new DeviceOrientationCompass();
 *   
 *   // Request permissions (required for iOS 13+)
 *   const granted = await compass.requestPermission();
 *   if (granted) {
 *       compass.startListening();
 *       
 *       // Get current readings
 *       const { heading, elevation, isAbsolute } = compass.getReadings();
 *       
 *       // Or use event-based updates
 *       compass.onUpdate = (readings) => {
 *           console.log(`Heading: ${readings.heading}°, Elevation: ${readings.elevation}°`);
 *       };
 *   }
 */

export class DeviceOrientationCompass {
    constructor() {
        // Current processed values
        this.compassHeading = 0;      // 0-360°, 0 = North, adjusted for screen orientation
        this.elevationAngle = 0;      // Device tilt angle, adjusted for screen orientation
        this.isAbsolute = false;      // Whether we have absolute (compass-based) orientation
        
        // Raw sensor values
        this.alpha = 0;               // Device orientation alpha (rotation around Z axis)
        this.beta = 0;                // Device orientation beta (rotation around X axis)
        this.gamma = 0;               // Device orientation gamma (rotation around Y axis)
        this.webkitCompassHeading = null;  // iOS compass heading (if available)
        
        // Screen orientation tracking
        this.screenOrientation = 0;   // 0, 90, 270, 180 (modern standard)
        
        // Device detection
        this.isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                     (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        
        // Permission and state
        this.permissionGranted = false;
        this.isListening = false;
        
        // iOS heading correction for tilt flip at ~135° beta
        this.goodHeading = 0;         // Last known good heading (when beta < 133°)
        
        // Callback for orientation updates
        this.onUpdate = null;         // Optional callback: (readings) => void
        this.onStatusChange = null;   // Optional callback: (message, isError) => void
        
        // Bind methods
        this.handleOrientation = this.handleOrientation.bind(this);
        this.handleOrientationChange = this.handleOrientationChange.bind(this);
        this.handleCompassCalibration = this.handleCompassCalibration.bind(this);
    }
    
    /**
     * Request permission to access device orientation (required for iOS 13+)
     * @returns {Promise<boolean>} True if permission granted or not required
     */
    async requestPermission() {
        // Check if we need to request permission (iOS 13+)
        if (typeof DeviceOrientationEvent !== 'undefined' && 
            typeof DeviceOrientationEvent.requestPermission === 'function') {
            try {
                const permission = await DeviceOrientationEvent.requestPermission();
                if (permission === 'granted') {
                    this.permissionGranted = true;
                    this._updateStatus('Permission granted', false);
                    return true;
                } else {
                    this._updateStatus('Permission denied for device orientation', true);
                    return false;
                }
            } catch (error) {
                this._updateStatus('Error requesting permission: ' + error.message, true);
                return false;
            }
        } else {
            // Android or older iOS - no permission needed
            this.permissionGranted = true;
            return true;
        }
    }
    
    /**
     * Start listening to device orientation events
     * @returns {boolean} True if started successfully
     */
    startListening() {
        if (!window.DeviceOrientationEvent) {
            this._updateStatus('Device orientation not supported on this device', true);
            return false;
        }
        
        if (this.isListening) {
            return true;
        }
        
        // Track screen orientation changes
        this._trackScreenOrientation();
        
        // iOS: uses deviceorientation with webkitCompassHeading
        // Android: uses deviceorientationabsolute with absolute flag
        if (this.isIOS) {
            window.addEventListener('deviceorientation', this.handleOrientation, true);
            this._updateStatus('Starting compass (iOS)...', false);
        } else {
            // For Android, listen to deviceorientationabsolute
            window.addEventListener('deviceorientationabsolute', this.handleOrientation, true);
            this._updateStatus('Starting compass (Android)...', false);
        }
        
        // Listen for compass calibration needs
        window.addEventListener('compassneedscalibration', this.handleCompassCalibration, true);
        
        this.isListening = true;
        
        // Set timeout to check if we're receiving data
        setTimeout(() => {
            if (this.compassHeading === 0 && this.elevationAngle === 0) {
                this._updateStatus('No sensor data received. Ensure sensors are enabled.', true);
            }
        }, 3000);
        
        return true;
    }
    
    /**
     * Stop listening to device orientation events
     */
    stopListening() {
        if (!this.isListening) {
            return;
        }
        
        if (this.isIOS) {
            window.removeEventListener('deviceorientation', this.handleOrientation, true);
        } else {
            window.removeEventListener('deviceorientationabsolute', this.handleOrientation, true);
        }
        
        window.removeEventListener('compassneedscalibration', this.handleCompassCalibration, true);
        
        // Stop tracking screen orientation
        if (screen.orientation) {
            screen.orientation.removeEventListener('change', this.handleOrientationChange);
        } else {
            window.removeEventListener('orientationchange', this.handleOrientationChange);
        }
        
        this.isListening = false;
        this._updateStatus('Compass stopped', false);
    }
    
    /**
     * Get current compass and elevation readings
     * @returns {Object} { heading, elevation, isAbsolute, raw: { alpha, beta, gamma, webkit, screenOrientation } }
     */
    getReadings() {
        return {
            heading: this.compassHeading,
            elevation: this.elevationAngle,
            isAbsolute: this.isAbsolute,
            raw: {
                alpha: this.alpha,
                beta: this.beta,
                gamma: this.gamma,
                webkit: this.webkitCompassHeading,
                screenOrientation: this.screenOrientation
            }
        };
    }
    
    /**
     * Track screen orientation changes
     * @private
     */
    _trackScreenOrientation() {
        this.handleOrientationChange();
        
        // Listen for orientation changes
        if (screen.orientation) {
            screen.orientation.addEventListener('change', this.handleOrientationChange);
        } else {
            window.addEventListener('orientationchange', this.handleOrientationChange);
        }
    }
    
    /**
     * Handle screen orientation change events
     * @private
     */
    handleOrientationChange() {
        let angle = 0;
        
        if (screen.orientation) {
            // Modern API - returns 0, 90, 180, 270
            angle = screen.orientation.angle;
        } else if (window.orientation !== undefined) {
            // Legacy API - returns 0, 90, -90, 180
            angle = window.orientation;
        }
        
        // Normalize to modern standard: Convert -90 to 270
        // Both represent landscape-right (device rotated clockwise when in portrait)
        if (angle === -90) {
            angle = 270;
        }
        
        this.screenOrientation = angle;
    }
    
    /**
     * Handle device orientation events
     * @private
     */
    handleOrientation(event) {
        // Store raw sensor values
        this.alpha = event.alpha !== null ? event.alpha : 0;
        this.beta = event.beta !== null ? event.beta : 0;
        this.gamma = event.gamma !== null ? event.gamma : 0;
        this.webkitCompassHeading = event.webkitCompassHeading !== undefined ? event.webkitCompassHeading : null;
        
        // Check if we have absolute orientation
        this.isAbsolute = event.absolute === true || event.type === 'deviceorientationabsolute';
        
        let rawHeading = 0;
        let useWebkitHeading = false;
        
        // iOS: webkitCompassHeading gives true heading (0-360, 0 = North)
        // Note: webkitCompassHeading has a known issue - it flips 180° when pitch > ~45°
        // We need to calculate the heading properly using rotation matrix when tilted
        if (event.webkitCompassHeading !== undefined && event.webkitCompassHeading !== null) {
            // Use webkitCompassHeading as a base, but we'll correct it below
            rawHeading = event.webkitCompassHeading;
            useWebkitHeading = true;
            this.isAbsolute = true;
            
            // When pitch > 45° in portrait, webkitCompassHeading flips 180°
            // Note: this is a patch for observed behavior on iOS devices only
            if (this.screenOrientation === 0 && Math.abs(this.beta) >= 135) {
                // Flip it back
                rawHeading = (rawHeading + 180) % 360;
                this._updateStatus('✓ Active (iOS, tilt-corrected)', false);
            } else {
                this._updateStatus('✓ Active (iOS)', false);
            }
            
            // Handle 180° flips near 135°
            // If more than 100° away from last good heading, flip it
            if (this.screenOrientation === 0) {
                if (Math.abs(this.beta) <= 133) {
                    // We assume the heading is good when beta is less than 133° or more than 137°
                    // based on observed behavior
                    this.goodHeading = rawHeading;
                } else {
                    // If current heading is more than 100° away from last good heading, flip it
                    const angleDiff = Math.abs(rawHeading - this.goodHeading);
                    if (angleDiff > 100 && angleDiff < 260) {
                        rawHeading = (rawHeading + 180) % 360;
                        this._updateStatus('✓ Active (iOS, tilt-corrected+)', false);

                        // not ideal, but it keeps flipping if you don't create a new "good" reference
                        this.goodHeading = rawHeading;

                    }
                }
            }
        } 
        // Android with absolute orientation
        else if (event.alpha !== null && event.beta !== null && event.gamma !== null) {
            // Formula that works in any device orientation (flat, upright, tilted)
            // This accounts for device tilt using beta and gamma
            rawHeading = -(this.alpha + this.beta * this.gamma / 90);
            // Normalize to [0, 360) range
            rawHeading = rawHeading - Math.floor(rawHeading / 360) * 360;
            
            if (this.isAbsolute) {
                this._updateStatus('✓ Active (absolute)', false);
            } else {
                this._updateStatus('⚠️ Relative heading - needs device calibration', true);
            }
        }
        
        // Adjust heading based on screen orientation
        // webkitCompassHeading gives the direction the DEVICE top is pointing
        // We need to adjust it to show the direction the SCREEN top is pointing
        // screenOrientation: 0 (portrait), 90 (landscape-left), 270 (landscape-right), 180 (upside down)
        this.compassHeading = (rawHeading + this.screenOrientation + 360) % 360;
        
        // Calculate elevation using simple gamma correction
        // Gamma goes 0 to -90 then 90 to 0
        let correctedElevation = this.gamma;
        if (this.screenOrientation === 90) {
            // Landscape-left
            if (this.gamma < 0) {
                correctedElevation = -this.gamma;
            } else {
                correctedElevation = 180 - this.gamma;
            }
        } else if (this.screenOrientation === 270) {
            // Landscape-right (inverted)
            if (this.gamma < 0) {
                correctedElevation = 180 - (-this.gamma);
            } else {
                correctedElevation = this.gamma;
            }
        } else {
            // Portrait mode (0° or 180°) - use beta
            correctedElevation = this.beta;
        }
        this.elevationAngle = correctedElevation - 90; // Adjust so 0° = point at horizon, positive = up, negative = down
        
        // Notify callback if provided
        if (this.onUpdate) {
            this.onUpdate(this.getReadings());
        }
    }
    
    /**
     * Handle compass calibration events
     * @private
     */
    handleCompassCalibration(event) {
        this._updateStatus('⚠️ Compass needs calibration - wave phone in figure 8', true);
        event.preventDefault();
    }
    
    /**
     * Update status (internal helper for callbacks)
     * @private
     */
    _updateStatus(message, isError) {
        if (this.onStatusChange) {
            this.onStatusChange(message, isError);
        }
    }
}

// Create and export a singleton instance for convenience
export const deviceOrientationCompass = new DeviceOrientationCompass();