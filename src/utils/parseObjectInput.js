export function parseObjectInput(inputString) {
    if (!inputString || typeof inputString !== 'string') {
        return null;
    }
    
    const input = inputString.trim();
    if (input.length === 0) {
        return null;
    }
    
    const match = input.match(/(?:^|[\s,])(-?\d+\.?\d*)/);
    if (!match) {
        return null;
    }
    
    const coordStartIndex = match.index + (match[0].startsWith(' ') || match[0].startsWith(',') ? 1 : 0);
    
    let name = null;
    if (coordStartIndex > 0) {
        const namePart = input.substring(0, coordStartIndex).trim();
        if (namePart.length > 0) {
            name = namePart;
        }
    }
    
    const coordString = input.substring(coordStartIndex);
    
    const parts = coordString.split(/[,\s]+/).filter(p => p.length > 0);
    
    if (parts.length < 2) {
        return null;
    }
    
    const lat = parseFloat(parts[0]);
    const lon = parseFloat(parts[1]);
    
    if (isNaN(lat) || isNaN(lon)) {
        return null;
    }
    
    let alt = 0;
    let hasExplicitAlt = false;
    
    if (parts.length >= 3) {
        const altString = parts[2];
        
        const altMatch = altString.match(/^([-\d.]+)(m|ft)?$/i);
        if (altMatch) {
            const altValue = parseFloat(altMatch[1]);
            if (!isNaN(altValue)) {
                const unit = altMatch[2] ? altMatch[2].toLowerCase() : 'm';
                
                if (unit === 'ft') {
                    alt = altValue * 0.3048;
                } else {
                    alt = altValue;
                }
                
                hasExplicitAlt = true;
            }
        }
    }
    
    return {
        name: name,
        lat: lat,
        lon: lon,
        alt: alt,
        hasExplicitAlt: hasExplicitAlt
    };
}
