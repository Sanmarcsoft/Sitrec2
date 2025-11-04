// AR Mode - Use device orientation to control camera
// Based on compass/index.html device orientation code

import {Globals} from "./Globals";
import {Euler, MathUtils} from "three";

class ARModeManager {
    constructor() {
        this.compassHeading = 0;
        this.elevationAngle = 0;
        this.isAbsolute = false;
        this.screenOrientation = 0; // 0, 90, -90, 180
        this.cameraNode = null;
        this.isIOS = false;
        this.permissionGranted = false;
        this.isListening = false;
        
        // Detect iOS
        this.isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                     (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    }
    
    async requestPermission() {
        // Check if we need to request permission (iOS 13+)
        if (typeof DeviceOrientationEvent !== 'undefined' && 
            typeof DeviceOrientationEvent.requestPermission === 'function') {
            try {
                const permission = await DeviceOrientationEvent.requestPermission();
                if (permission === 'granted') {
                    this.permissionGranted = true;
                    return true;
                } else {
                    console.warn('AR Mode: Permission denied for device orientation');
                    return false;
                }
            } catch (error) {
                console.error('AR Mode: Error requesting permission:', error);
                return false;
            }
        } else {
            // Android or older iOS - no permission needed
            this.permissionGranted = true;
            return true;
        }
    }
    
    trackOrientation() {
        const updateOrientation = () => {
            if (screen.orientation) {
                // Modern API - preferred method
                this.screenOrientation = screen.orientation.angle;
            } else if (window.orientation !== undefined) {
                // Legacy fallback for older iOS devices (deprecated but necessary for compatibility)
                this.screenOrientation = window.orientation;
            }
        };
        
        updateOrientation();
        
        // Listen for orientation changes
        if (screen.orientation) {
            screen.orientation.addEventListener('change', updateOrientation);
        } else {
            window.addEventListener('orientationchange', updateOrientation);
        }
    }
    
    handleOrientation = (event) => {
        // Check if we have absolute orientation
        this.isAbsolute = event.absolute === true || event.type === 'deviceorientationabsolute';
        
        let rawHeading = 0;
        
        // iOS: webkitCompassHeading gives true heading (0-360, 0 = North)
        // Note: webkitCompassHeading already accounts for screen orientation on iOS
        if (event.webkitCompassHeading !== undefined && event.webkitCompassHeading !== null) {
            rawHeading = event.webkitCompassHeading;
            this.isAbsolute = true;
        } 
        // Android with absolute orientation
        else if (event.alpha !== null) {
            // Formula from working examples: Math.abs(alpha - 360)
            // This gives heading where 0 = North
            rawHeading = Math.abs(event.alpha - 360);
        }
        
        // Adjust heading based on screen orientation
        // webkitCompassHeading gives the direction the DEVICE top is pointing
        // We need to adjust it to show the direction the SCREEN top is pointing
        // screenOrientation: 0 (portrait), 90 (landscape-left), -90 (landscape-right), 180 (upside down)
        this.compassHeading = (rawHeading + this.screenOrientation + 360) % 360;
        
        // Adjust elevation based on screen orientation
        const beta = event.beta || 0;
        const gamma = event.gamma || 0;
        
        switch(this.screenOrientation) {
            case 0: // Portrait
                this.elevationAngle = beta;
                break;
            case 90: // Landscape-left (rotated counter-clockwise)
                this.elevationAngle = -gamma;
                break;
            case -90: // Landscape-right (rotated clockwise)
                this.elevationAngle = gamma;
                break;
            case 180: // Upside down
                this.elevationAngle = -beta;
                break;
            default:
                this.elevationAngle = beta;
        }
    }
    
    startListening() {
        if (!window.DeviceOrientationEvent) {
            console.warn('AR Mode: Device orientation not supported on this device.');
            return false;
        }
        
        if (this.isListening) return true;
        
        // Track screen orientation changes
        this.trackOrientation();
        
        // iOS: uses deviceorientation with webkitCompassHeading
        // Android: uses deviceorientationabsolute with absolute flag
        if (this.isIOS) {
            window.addEventListener('deviceorientation', this.handleOrientation, true);
        } else {
            // For Android, listen to deviceorientationabsolute
            window.addEventListener('deviceorientationabsolute', this.handleOrientation, true);
        }
        
        // Listen for compass calibration needs
        window.addEventListener('compassneedscalibration', (e) => {
            console.warn('AR Mode: Compass needs calibration - wave phone in figure 8');
            e.preventDefault();
        }, true);
        
        this.isListening = true;
        return true;
    }
    
    stopListening() {
        if (!this.isListening) return;
        
        if (this.isIOS) {
            window.removeEventListener('deviceorientation', this.handleOrientation, true);
        } else {
            window.removeEventListener('deviceorientationabsolute', this.handleOrientation, true);
        }
        
        this.isListening = false;
    }
    
    async enableARMode(cameraNode) {
        if (!Globals.isMobile) {
            console.warn('AR Mode: Only available on mobile devices');
            return false;
        }
        
        if (Globals.arMode) {
            console.log('AR Mode: Already enabled');
            return true;
        }
        
        // Request permission if needed
        if (!this.permissionGranted) {
            const granted = await this.requestPermission();
            if (!granted) {
                return false;
            }
        }
        
        // Start listening to device orientation
        const started = this.startListening();
        if (!started) {
            return false;
        }
        
        this.cameraNode = cameraNode;
        Globals.arMode = true;
        
        console.log('AR Mode: Enabled');
        return true;
    }
    
    disableARMode() {
        if (!Globals.arMode) return;
        
        this.stopListening();
        this.cameraNode = null;
        Globals.arMode = false;
        
        console.log('AR Mode: Disabled');
    }
    
    update() {
        if (!Globals.arMode || !this.cameraNode) return;
        
        const camera = this.cameraNode.camera;
        if (!camera) return;
        
        // Instead of directly rotating the camera, update the PTZ controller
        // This allows AR mode to work with the Manual PTZ "Use Angles" system
        const ptzController = NodeMan.get("ptzAngles", false);
        if (ptzController) {

            // Update PTZ controller with device orientation
            // compassHeading: 0-360°, 0 = North (matches PTZ azimuth)
            ptzController.az = this.compassHeading;
            
            // elevationAngle: positive = device tilted forward (looking down)
            // PTZ el: positive = looking up, negative = looking down
            ptzController.el = this.elevationAngle - 90; // Adjust so 0° = horizon
            
            // Don't need to call recalculateCascade - the PTZ controller
            // will apply these values in its normal update cycle
        } else {
            // Fallback: if no PTZ controller, directly rotate camera (old behavior)
            // Convert heading (0-360 degrees, 0 = North) to radians
            // In Three.js, rotation around Y axis: 0 = +Z (South), π/2 = -X (West), π = -Z (North), 3π/2 = +X (East)
            // So we need to convert: North (0°) should point to -Z, which is π radians
            const headingRad = MathUtils.degToRad(this.compassHeading);
            const yaw = Math.PI - headingRad; // Convert compass heading to Three.js Y rotation
            
            // Convert elevation to radians
            // Positive elevation = looking up, negative = looking down
            const pitch = MathUtils.degToRad(-this.elevationAngle);
            
            // Create rotation: first rotate around Y axis (yaw/heading), then around X axis (pitch/elevation)
            const euler = new Euler(pitch, yaw, 0, 'YXZ');
            camera.quaternion.setFromEuler(euler);
            
            // Update camera matrices
            camera.updateMatrixWorld(true);
        }
    }
}

// Create singleton instance
export const arModeManager = new ARModeManager();