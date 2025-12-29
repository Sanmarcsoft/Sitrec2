import {Vector2} from "three";

export function fixXRLayerMasks(renderer, sourceCameraLayersMask) {
    const internalXRCamera = renderer.xr.getCamera();
    if (!internalXRCamera || !internalXRCamera.cameras || internalXRCamera.cameras.length < 2) {
        return internalXRCamera;
    }
    
    for (let i = 0; i < internalXRCamera.cameras.length; i++) {
        internalXRCamera.cameras[i].layers.mask &= 0b110;
        internalXRCamera.cameras[i].layers.mask |= sourceCameraLayersMask;
    }
    
    return internalXRCamera;
}

export function renderCelestialScene(renderer, xrCameraRig, xrCamera, sourceCameraLayersMask, scene, renderCallback) {
    const tempPos = xrCameraRig.position.clone();
    const tempQuat = xrCameraRig.quaternion.clone();
    
    xrCameraRig.position.set(0, 0, 0);
    xrCameraRig.updateMatrix();
    xrCameraRig.updateMatrixWorld(true);
    
    xrCamera.updateMatrix();
    xrCamera.updateMatrixWorld(true);
    renderer.xr.updateCamera(xrCamera);
    
    fixXRLayerMasks(renderer, sourceCameraLayersMask);
    
    if (renderCallback) {
        renderCallback();
    } else {
        renderer.render(scene, xrCamera);
    }
    
    renderer.clearDepth();
    
    xrCameraRig.position.copy(tempPos);
    xrCameraRig.quaternion.copy(tempQuat);
    xrCameraRig.updateMatrix();
    xrCameraRig.updateMatrixWorld(true);
    xrCamera.updateMatrix();
    xrCamera.updateMatrixWorld(true);
    renderer.xr.updateCamera(xrCamera);
}

export function renderFullscreenQuadStereo(renderer, fullscreenQuadScene, fullscreenQuadCamera) {
    const internalXRCamera = renderer.xr.getCamera();
    const cameras = internalXRCamera.cameras;
    
    if (cameras && cameras.length > 0) {
        for (let i = 0; i < cameras.length; i++) {
            const cam = cameras[i];
            const viewport = cam.viewport;
            
            const savedXREnabled = renderer.xr.enabled;
            renderer.xr.enabled = false;
            renderer.setViewport(viewport.x, viewport.y, viewport.width, viewport.height);
            renderer.render(fullscreenQuadScene, fullscreenQuadCamera);
            renderer.xr.enabled = savedXREnabled;
        }
    } else {
        const savedXREnabled = renderer.xr.enabled;
        renderer.xr.enabled = false;
        const size = renderer.getSize(new Vector2());
        renderer.setViewport(0, 0, size.x, size.y);
        renderer.render(fullscreenQuadScene, fullscreenQuadCamera);
        renderer.xr.enabled = savedXREnabled;
    }
}

export function getXREyeFocalLengths(renderer) {
    const internalXRCamera = renderer.xr.getCamera();
    if (!internalXRCamera || !internalXRCamera.cameras || internalXRCamera.cameras.length < 2) {
        return null;
    }
    
    const focalLengths = [];
    for (let i = 0; i < internalXRCamera.cameras.length; i++) {
        const cam = internalXRCamera.cameras[i];
        const viewport = cam.viewport;
        const projMatrix = cam.projectionMatrix.elements;
        const focalLengthY = projMatrix[5] * (viewport.height / 2);
        focalLengths.push(focalLengthY);
    }
    
    return focalLengths;
}
