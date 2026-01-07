let alignWithFlow = false;
let motionAnalyzerRef = null;

export function setAlignWithFlow(value) {
    alignWithFlow = value;
}

export function isAlignWithFlowEnabled() {
    return alignWithFlow;
}

export function setMotionAnalyzerRef(analyzer) {
    motionAnalyzerRef = analyzer;
}

export function getFlowAlignRotation(frame) {
    if (!alignWithFlow || !motionAnalyzerRef || !motionAnalyzerRef.active) return 0;
    const cached = motionAnalyzerRef.resultCache.get(Math.floor(frame));
    if (!cached || !cached.smoothedDirection) return 0;
    return -cached.smoothedDirection.angle;
}
