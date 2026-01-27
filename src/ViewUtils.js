// Mouse coordinate utility functions for converting between coordinate systems.
//
// Coordinate systems:
// - Screen/Window: (0,0) at top-left of browser window (event.clientX, event.clientY)
// - View-relative: (0,0) at top-left of view (after subtracting view position)
// - Three.js NDC: (-1,-1) at bottom-left, (1,1) at top-right, (0,0) at center
//
// IMPORTANT: view.leftPx/topPx are positions RELATIVE to the Content container.
// The Content container itself may be offset from the screen edge (e.g., by sidebars).
// ViewMan.screenOffsetX tracks this container offset for proper screen-to-view conversion.

import {assert} from "./assert";
import {ViewMan} from "./CViewManager";
import {Vector2} from "three";

/**
 * Convert screen coordinates to view-relative coordinates.
 * Both input and output use top-left origin (screen convention).
 * Accounts for sidebar offsets via ViewMan.screenOffsetX.
 * @param {Object} view - The view object with leftPx, topPx, widthPx, heightPx
 * @param {number} x - Screen X coordinate (event.clientX)
 * @param {number} y - Screen Y coordinate (event.clientY)
 * @returns {[number, number]} View-relative [x, y] with (0,0) at view's top-left
 */
export function mouseToView(view, x, y) {
    // view.leftPx is relative to the container, so add container's screen offset
    const containerOffsetX = ViewMan.screenOffsetX || 0;
    const xv = x - view.leftPx - containerOffsetX;
    const yv = y - view.topPx;
    return [xv, yv];
}

/**
 * Convert screen coordinates to Three.js Normalized Device Coordinates (NDC).
 * Three.js NDC has (-1,-1) at bottom-left, (1,1) at top-right.
 * Accounts for sidebar offsets via ViewMan.screenOffsetX.
 * @param {Object} view - The view object with leftPx, topPx, widthPx, heightPx
 * @param {number} x - Screen X coordinate (event.clientX)
 * @param {number} y - Screen Y coordinate (event.clientY)
 * @returns {[number, number]} NDC [x, y] in range [-1, 1]
 */
export function mouseToViewNormalized(view, x, y) {
    const [xv, yv] = mouseToView(view, x, y);
    return [(xv / view.widthPx) * 2 - 1, -(yv / view.heightPx) * 2 + 1];
}

/**
 * Create a Vector2 in Three.js NDC from screen coordinates.
 * This is the preferred method for raycaster.setFromCamera().
 * Accounts for sidebar offsets via ViewMan.screenOffsetX.
 * @param {Object} view - The view object with leftPx, topPx, widthPx, heightPx
 * @param {number} x - Screen X coordinate (event.clientX)
 * @param {number} y - Screen Y coordinate (event.clientY)
 * @returns {Vector2} NDC coordinates suitable for raycaster.setFromCamera()
 */
export function mouseToNDC(view, x, y) {
    const [ndcX, ndcY] = mouseToViewNormalized(view, x, y);
    return new Vector2(ndcX, ndcY);
}

/**
 * Convert screen coordinates to view-relative coordinates.
 * Alias for mouseToView() for backward compatibility.
 * @deprecated Use mouseToView() instead
 */
export function mouseToCanvas(view, x, y) {
    return mouseToView(view, x, y);
}

export function mouseInView(view, x, y, debug = false) {
    assert(view !== undefined)
    assert(x !== undefined)
    assert(y !== undefined)
    // localize to the view window
    const [vx, vy] = mouseToView(view, x, y)

    if (view.ignoreMouse) {
        if (debug) console.log(`Mouse (${x},${y}) Ignored in view(${view.id})`)
        return false;
    }
    if (!view.visible) {
        if (debug) console.log(`Mouse (${x},${y}) NOT visible in view(${view.id})`)
        return false;
    }

    const inside = (vx >= 0 && vy >= 0 && vx < view.widthPx && vy < view.heightPx);
    if (debug) {
        if (inside)
            console.log(`Mouse (${x},${y}) In view(${view.id})`)
        else
            console.log(`Mouse (${x},${y}) NOT in view(${view.id})`)
    }
    return inside;
}

export function mouseInViewOnly(view, x, y, debug = false) {
    if (!mouseInView(view, x, y, debug)) {
        if (debug) console.log(`Mouse (${x},${y}) NOT in view(${view.id})`)
        return false;
    }

    const viewZ = view.zIndex || 0;
    let inView = true;
    
    ViewMan.iterateVisibleIncludingOverlays((key, otherView) => {
        if (otherView === view) return;
        
        const otherZ = otherView.zIndex || 0;
        if (otherZ > viewZ && mouseInView(otherView, x, y)) {
            if (debug) {
                console.log(`Mouse (${x},${y}) In FRONT view(${otherView.id}) z=${otherZ} > ${viewZ}`)
            }
            if (otherView.onMouseDown !== undefined) {
                inView = false;
            }
        }
    })

    return inView;
}