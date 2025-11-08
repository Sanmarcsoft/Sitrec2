export class ULogParser {
    constructor() {
        this.formats = new Map();
        this.messages = new Map();
        this.data = [];
        this.parameters = new Map();
        this.info = new Map();
        this.multiData = new Map();
    }

    async parse(arrayBuffer) {
        const view = new DataView(arrayBuffer);
        let offset = 0;

        const headerBytes = this.readBytes(view, offset, 7);
        offset += 7;
        const expected = [0x55, 0x4c, 0x6f, 0x67, 0x01, 0x12, 0x35];
        
        if (!headerBytes.every((b, i) => b === expected[i])) {
            throw new Error(`Invalid ULog file: header magic bytes not found`);
        }

        const version = view.getUint8(offset);
        offset += 1;

        const timestamp = view.getBigUint64(offset, true);
        offset += 8;

        this.info.set('version', version);
        this.info.set('timestamp', timestamp);

        while (offset < view.byteLength) {
            if (offset + 3 > view.byteLength) break;
            
            const msgSize = view.getUint16(offset, true);
            offset += 2;

            const msgType = view.getUint8(offset);
            offset += 1;

            if (offset + msgSize > view.byteLength) break;
            
            const msgData = new DataView(arrayBuffer, offset, msgSize);
            
            try {
                switch (msgType) {
                    case 70: // 'F' - Format
                        this.parseFormat(msgData);
                        break;
                    case 73: // 'I' - Info
                        this.parseInfo(msgData);
                        break;
                    case 77: // 'M' - Info Multiple
                        this.parseInfoMultiple(msgData);
                        break;
                    case 80: // 'P' - Parameter
                        this.parseParameter(msgData);
                        break;
                    case 65: // 'A' - Add Logged Message
                        this.parseAddLogged(msgData);
                        break;
                    case 68: // 'D' - Data
                        this.parseData(msgData);
                        break;
                    case 76: // 'L' - Logged String
                        break;
                    case 82: // 'R' - Remove Logged Message
                        break;
                    case 83: // 'S' - Sync
                        break;
                    case 79: // 'O' - Dropout
                        break;
                    default:
                        console.warn(`Unknown message type: ${msgType} (${String.fromCharCode(msgType)})`);
                }
            } catch (e) {
                console.error(`Error parsing message type ${String.fromCharCode(msgType)}:`, e);
            }

            offset += msgSize;
        }

        return this.extractTrackData();
    }

    readBytes(view, offset, length) {
        const bytes = [];
        for (let i = 0; i < length; i++) {
            bytes.push(view.getUint8(offset + i));
        }
        return bytes;
    }

    readString(view, offset, maxLength) {
        const bytes = [];
        for (let i = 0; i < maxLength; i++) {
            const byte = view.getUint8(offset + i);
            if (byte === 0) break;
            bytes.push(byte);
        }
        return String.fromCharCode(...bytes);
    }

    parseFormat(view) {
        const formatStr = this.readString(view, 0, view.byteLength);
        const colonIdx = formatStr.indexOf(':');
        if (colonIdx === -1) return;

        const name = formatStr.substring(0, colonIdx);
        const fieldsStr = formatStr.substring(colonIdx + 1);
        
        const fields = [];
        const fieldParts = fieldsStr.split(';');
        
        for (const part of fieldParts) {
            if (!part.trim()) continue;
            const spaceIdx = part.lastIndexOf(' ');
            if (spaceIdx === -1) continue;
            
            const type = part.substring(0, spaceIdx).trim();
            const fieldName = part.substring(spaceIdx + 1).trim();
            
            fields.push({ name: fieldName, type: this.parseFieldType(type) });
        }

        this.formats.set(name, fields);
    }

    parseFieldType(typeStr) {
        const arrayMatch = typeStr.match(/^(.+)\[(\d+)\]$/);
        if (arrayMatch) {
            return {
                baseType: arrayMatch[1],
                isArray: true,
                arraySize: parseInt(arrayMatch[2])
            };
        }
        return {
            baseType: typeStr,
            isArray: false,
            arraySize: 1
        };
    }

    parseInfo(view) {
        const keyLen = view.getUint8(0);
        const typeAndKey = this.readString(view, 1, keyLen);
        
        const spaceIdx = typeAndKey.indexOf(' ');
        if (spaceIdx === -1) return;
        
        const type = typeAndKey.substring(0, spaceIdx);
        const key = typeAndKey.substring(spaceIdx + 1);
        
        const valueOffset = 1 + keyLen;
        const valueLength = view.byteLength - valueOffset;
        
        let value;
        if (type.startsWith('char[')) {
            const bytes = [];
            for (let i = 0; i < valueLength; i++) {
                const byte = view.getUint8(valueOffset + i);
                if (byte === 0) break;
                bytes.push(byte);
            }
            value = String.fromCharCode(...bytes);
        } else if (type === 'int32_t') {
            value = view.getInt32(valueOffset, true);
        } else if (type === 'uint32_t') {
            value = view.getUint32(valueOffset, true);
        } else if (type === 'int64_t') {
            value = view.getBigInt64(valueOffset, true);
        } else if (type === 'uint64_t') {
            value = view.getBigUint64(valueOffset, true);
        } else if (type === 'float') {
            value = view.getFloat32(valueOffset, true);
        } else if (type === 'double') {
            value = view.getFloat64(valueOffset, true);
        } else {
            value = this.readString(view, valueOffset, valueLength);
        }
        
        this.info.set(key, value);
    }

    parseInfoMultiple(view) {
        const isContinued = view.getUint8(0);
        const keyLen = view.getUint8(1);
        const typeAndKey = this.readString(view, 2, keyLen);
        
        const spaceIdx = typeAndKey.indexOf(' ');
        if (spaceIdx === -1) return;
        
        const type = typeAndKey.substring(0, spaceIdx);
        const key = typeAndKey.substring(spaceIdx + 1);
        
        const valueOffset = 2 + keyLen;
        const valueLength = view.byteLength - valueOffset;
        
        let value;
        if (type.startsWith('char[')) {
            const bytes = [];
            for (let i = 0; i < valueLength; i++) {
                const byte = view.getUint8(valueOffset + i);
                if (byte === 0) break;
                bytes.push(byte);
            }
            value = String.fromCharCode(...bytes);
        } else {
            value = this.readString(view, valueOffset, valueLength);
        }
        
        if (!this.multiData.has(key)) {
            this.multiData.set(key, []);
        }
        this.multiData.get(key).push(value);
    }

    parseParameter(view) {
        const keyLen = view.getUint8(0);
        const typeAndKey = this.readString(view, 1, keyLen);
        
        const spaceIdx = typeAndKey.indexOf(' ');
        if (spaceIdx === -1) return;
        
        const type = typeAndKey.substring(0, spaceIdx);
        const key = typeAndKey.substring(spaceIdx + 1);
        
        const valueOffset = 1 + keyLen;
        
        let value;
        if (type === 'int32_t') {
            value = view.getInt32(valueOffset, true);
        } else if (type === 'float') {
            value = view.getFloat32(valueOffset, true);
        } else {
            value = this.readString(view, valueOffset, view.byteLength - valueOffset);
        }
        
        this.parameters.set(key, value);
    }

    parseAddLogged(view) {
        const multiId = view.getUint8(0);
        const msgId = view.getUint16(1, true);
        const msgName = this.readString(view, 3, view.byteLength - 3);
        
        this.messages.set(msgId, { name: msgName, multiId });
    }

    parseData(view) {
        const msgId = view.getUint16(0, true);
        const msgInfo = this.messages.get(msgId);
        
        if (!msgInfo) return;
        
        const format = this.formats.get(msgInfo.name);
        if (!format) return;

        const record = { _msgName: msgInfo.name, _msgId: msgId };
        let offset = 2;

        for (const field of format) {
            try {
                const value = this.readFieldValue(view, offset, field.type);
                record[field.name] = value.value;
                offset += value.size;
            } catch (e) {
                break;
            }
        }

        this.data.push(record);
    }

    readFieldValue(view, offset, type) {
        const { baseType, isArray, arraySize } = type;

        if (isArray) {
            const values = [];
            let totalSize = 0;
            for (let i = 0; i < arraySize; i++) {
                const result = this.readSingleValue(view, offset + totalSize, baseType);
                values.push(result.value);
                totalSize += result.size;
            }
            return { value: values, size: totalSize };
        } else {
            return this.readSingleValue(view, offset, baseType);
        }
    }

    readSingleValue(view, offset, type) {
        switch (type) {
            case 'int8_t':
                return { value: view.getInt8(offset), size: 1 };
            case 'uint8_t':
                return { value: view.getUint8(offset), size: 1 };
            case 'int16_t':
                return { value: view.getInt16(offset, true), size: 2 };
            case 'uint16_t':
                return { value: view.getUint16(offset, true), size: 2 };
            case 'int32_t':
                return { value: view.getInt32(offset, true), size: 4 };
            case 'uint32_t':
                return { value: view.getUint32(offset, true), size: 4 };
            case 'int64_t':
                return { value: view.getBigInt64(offset, true), size: 8 };
            case 'uint64_t':
                return { value: view.getBigUint64(offset, true), size: 8 };
            case 'float':
                return { value: view.getFloat32(offset, true), size: 4 };
            case 'double':
                return { value: view.getFloat64(offset, true), size: 8 };
            case 'bool':
                return { value: view.getUint8(offset) !== 0, size: 1 };
            case 'char':
                return { value: String.fromCharCode(view.getUint8(offset)), size: 1 };
            default:
                console.warn(`Unknown type: ${type}`);
                return { value: null, size: 1 };
        }
    }

    extractTrackData() {
        const trackPoints = [];
        
        const positionMessages = this.data.filter(d => 
            d._msgName === 'vehicle_global_position' || 
            d._msgName === 'vehicle_local_position' ||
            d._msgName === 'vehicle_gps_position'
        );

        for (const msg of positionMessages) {
            const point = {
                timestamp: msg.timestamp ? Number(msg.timestamp) / 1000000.0 : 0,
            };

            if (msg.lat !== undefined && msg.lon !== undefined) {
                point.lat = msg.lat / 1e7;
                point.lon = msg.lon / 1e7;
                point.alt = msg.alt !== undefined ? msg.alt / 1000.0 : 0;
            } else if (msg.x !== undefined && msg.y !== undefined) {
                point.x = msg.x;
                point.y = msg.y;
                point.z = msg.z !== undefined ? msg.z : 0;
            }

            if (msg.vx !== undefined) point.vx = msg.vx;
            if (msg.vy !== undefined) point.vy = msg.vy;
            if (msg.vz !== undefined) point.vz = msg.vz;

            if (Object.keys(point).length > 1) {
                trackPoints.push(point);
            }
        }

        return {
            points: trackPoints,
            formats: this.formats,
            messages: this.messages,
            parameters: this.parameters,
            info: this.info,
            allData: this.data
        };
    }

    exportToCSV(result) {
        if (!result || !result.allData || result.allData.length === 0) {
            return '';
        }

        const allFields = new Set();
        result.allData.forEach(record => {
            Object.keys(record).forEach(key => {
                if (!key.startsWith('_')) {
                    allFields.add(key);
                }
            });
        });

        const fields = ['_msgName', ...Array.from(allFields).sort()];
        
        let csv = fields.join(',') + '\n';

        for (const record of result.allData) {
            const row = fields.map(field => {
                const value = record[field];
                if (value === undefined || value === null) return '';
                if (Array.isArray(value)) return `"${value.join(';')}"`;
                if (typeof value === 'bigint') return value.toString();
                if (typeof value === 'string' && value.includes(',')) return `"${value}"`;
                return value;
            });
            csv += row.join(',') + '\n';
        }

        return csv;
    }

    exportTrackToCSV(result) {
        if (!result || !result.points || result.points.length === 0) {
            return '';
        }

        const fields = Object.keys(result.points[0]);
        let csv = fields.join(',') + '\n';

        for (const point of result.points) {
            const row = fields.map(field => {
                const value = point[field];
                return value !== undefined ? value : '';
            });
            csv += row.join(',') + '\n';
        }

        return csv;
    }
}
