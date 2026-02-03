export const TEST_REGISTRY = [
    { id: 'testquick', name: 'TestQuick', group: 'Visual', file: 'regression.test.js', grep: 'testquick', snapshot: 'testquick-snapshot' },
    { id: 'default', name: 'Default', group: 'Visual', file: 'regression.test.js', grep: 'default', snapshot: 'default-snapshot' },
   // { id: 'wmts', name: 'WMTS', group: 'Visual', file: 'regression.test.js', grep: 'WMTS', snapshot: 'WMTS-snapshot' },
    { id: 'agua', name: 'Agua', group: 'Visual', file: 'regression.test.js', grep: 'agua', snapshot: 'agua-snapshot' },
    { id: 'ocean', name: 'Ocean', group: 'Visual', file: 'regression.test.js', grep: 'ocean surface', snapshot: 'ocean-surface-snapshot' },
    { id: 'gimbal', name: 'Gimbal', group: 'Visual', file: 'regression.test.js', grep: 'gimbal', snapshot: 'gimbal-snapshot' },
    { id: 'starlink', name: 'Starlink', group: 'Visual', file: 'regression.test.js', grep: 'starlink', snapshot: 'starlink-snapshot' },
    { id: 'potomac', name: 'Potomac', group: 'Visual', file: 'regression.test.js', grep: 'potomac', snapshot: 'potomac-snapshot' },
    { id: 'orion', name: 'Orion', group: 'Visual', file: 'regression.test.js', grep: 'orion', snapshot: 'orion-snapshot' },
    { id: 'bledsoe', name: 'Bledsoe', group: 'Visual', file: 'regression.test.js', grep: 'bledsoe', snapshot: 'bledsoe-snapshot' },
    { id: 'mosul', name: 'Mosul', group: 'Visual', file: 'regression.test.js', grep: 'mosul', snapshot: 'mosul-snapshot' },
    
    { id: 'ui-lighting', name: 'UI-Light', group: 'UI', file: 'ui-playwright.test.js', grep: 'Lighting ambient', snapshot: 'lighting-ambient-intensity-1.5-snapshot' },
    { id: 'ui-csv', name: 'UI-CSV', group: 'UI', file: 'ui-playwright.test.js', grep: 'LA Features CSV', snapshot: 'import-la-features-csv-snapshot' },
    { id: 'ui-stanag', name: 'UI-STANAG', group: 'UI', file: 'ui-playwright.test.js', grep: 'STANAG 4676', snapshot: 'import-stanag-xml-snapshot' },
    { id: 'ui-ambient', name: 'UI-Ambient', group: 'UI', file: 'ui-playwright.test.js', grep: 'same result with Ambient Only' },
    
    { id: 'video-load', name: 'VideoLoad', group: 'Video', file: 'video-loading.test.js', grep: 'multiple video types' },
    { id: 'webm', name: 'WebM', group: 'Video', file: 'webm-video-export.test.js', grep: 'valid WebM video' },
    
    { id: 'opencv', name: 'OpenCV', group: 'Motion', file: 'motion-analysis.test.js', grep: 'diagonal motion' },
    { id: 'motion-acc', name: 'MotionAcc', group: 'Motion', file: 'motion-accumulation.test.js', grep: 'Linear Tracklet' },
    { id: 'motion-acc2', name: 'MotionAcc2', group: 'Motion', file: 'motion-accumulation.test.js', grep: 'real video analysis' },
    
    { id: 'satellite', name: 'Satellite', group: 'Other', file: 'satellite-label-visibility.test.js', grep: 'Label Look Visible' },
    { id: 'mobile', name: 'Mobile', group: 'Other', file: 'mobile-viewport.test.js', grep: 'iPhone-sized viewport' },

    { id: 'ai-tab', name: 'AI-Tab', group: 'AI', file: 'chatbot-playwright.test.js', grep: 'open chat with Tab' },
    { id: 'ai-math', name: 'AI-Math', group: 'AI', file: 'chatbot-playwright.test.js', grep: 'simple math' },
    { id: 'ai-heli', name: 'AI-Heli', group: 'AI', file: 'chatbot-playwright.test.js', grep: 'helicopter model' },
    { id: 'ai-ambient', name: 'AI-Ambient', group: 'AI', file: 'chatbot-playwright.test.js', grep: 'change lighting to ambient' },
    { id: 'ai-jet', name: 'AI-Jet', group: 'AI', file: 'chatbot-playwright.test.js', grep: 'make it a jet' },
    { id: 'ai-drone', name: 'AI-Drone', group: 'AI', file: 'chatbot-playwright.test.js', grep: 'use a drone' },
    { id: 'ai-time', name: 'AI-Time', group: 'AI', file: 'chatbot-playwright.test.js', grep: 'colloquial time' },
    { id: 'ai-zoom', name: 'AI-Zoom', group: 'AI', file: 'chatbot-playwright.test.js', grep: 'zoom in' },
    { id: 'ai-stars', name: 'AI-Stars', group: 'AI', file: 'chatbot-playwright.test.js', grep: 'partial menu' },
    { id: 'ai-plane', name: 'AI-Plane', group: 'AI', file: 'chatbot-playwright.test.js', grep: 'small plane' },
    { id: 'ai-egg', name: 'AI-Egg', group: 'AI', file: 'chatbot-playwright.test.js', grep: 'superegg' },
    { id: 'ai-spheres', name: 'AI-Spheres', group: 'AI', file: 'chatbot-playwright.test.js', grep: 'all objects use spheres' },
    { id: 'ai-box', name: 'AI-Box', group: 'AI', file: 'chatbot-playwright.test.js', grep: 'box shape' },
    { id: 'ai-geom', name: 'AI-Geom', group: 'AI', file: 'chatbot-playwright.test.js', grep: 'geometry instead' },
    { id: 'ai-737', name: 'AI-737', group: 'AI', file: 'chatbot-playwright.test.js', grep: '737s' },
    { id: 'ai-skinny', name: 'AI-Skinny', group: 'AI', file: 'chatbot-playwright.test.js', grep: 'skinny cuboids' },
];

export function getTestById(id) {
    return TEST_REGISTRY.find(t => t.id === id);
}

export function getTestByGrep(grep) {
    return TEST_REGISTRY.find(t => grep.includes(t.grep) || t.grep.includes(grep));
}
