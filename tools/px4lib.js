function crc16Xmodem(bytes, init = 0x0000) {
    let crc = init & 0xFFFF;
    for (let i = 0; i < bytes.length; i++) {
        crc ^= (bytes[i] & 0xFF) << 8;
        for (let b = 0; b < 8; b++) {
            crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
            crc &= 0xFFFF;
        }
    }
    return crc;
}

export class ULogParser {
    constructor() {
        this.formats = new Map();
        this.messages = new Map();
        this.data = [];
        this.parameters = new Map();
        this.info = new Map();
        this.multiData = new Map();
        this.hasChecksums = false;
    }

    detectChecksums(view, startOffset) {
        const validTypes = [70, 73, 77, 80, 65, 68, 66, 76, 82, 83, 79, 67, 81];
        let offset = startOffset;
        let validCount = 0;
        
        for (let i = 0; i < 3; i++) {
            if (offset + 3 > view.byteLength) break;
            
            const msgSize = view.getUint16(offset, true);
            const msgType = view.getUint8(offset + 2);
            
            if (!validTypes.includes(msgType) || msgSize === 0 || msgSize > 10000) {
                break;
            }
            
            if (offset + 3 + msgSize + 2 > view.byteLength) break;
            
            const msgBytes = new Uint8Array(3 + msgSize);
            msgBytes[0] = msgSize & 0xFF;
            msgBytes[1] = (msgSize >>> 8) & 0xFF;
            msgBytes[2] = msgType;
            for (let j = 0; j < msgSize; j++) {
                msgBytes[3 + j] = view.getUint8(offset + 3 + j);
            }
            
            const calculatedCrc = crc16Xmodem(msgBytes);
            const fileCrcLow = view.getUint8(offset + 3 + msgSize);
            const fileCrcHigh = view.getUint8(offset + 3 + msgSize + 1);
            const fileCrc = fileCrcLow | (fileCrcHigh << 8);
            
            if (calculatedCrc !== fileCrc) {
                break;
            }
            
            const nextOffset = offset + 3 + msgSize + 2;
            if (nextOffset + 3 <= view.byteLength) {
                const nextSize = view.getUint16(nextOffset, true);
                const nextType = view.getUint8(nextOffset + 2);
                
                if (!validTypes.includes(nextType) || nextSize === 0 || nextSize > 10000) {
                    break;
                }
            }
            
            validCount++;
            offset = nextOffset;
        }
        
        return validCount === 3;
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

        this.version = version;
        this.info.set('version', version);
        this.info.set('timestamp', timestamp);

        console.log(`ULog version: 0x${version.toString(16)}, timestamp: 0x${timestamp.toString(16)}`);
        console.log(`Header parsed. Starting messages at offset 0x${offset.toString(16)}`);
        console.log(`First 180 bytes of file:`, this.readBytes(view, 0, 180).map(b => b.toString(16).padStart(2, '0')).join(' '));

        this.hasChecksums = this.detectChecksums(view, offset);
        console.log(`Checksum detection: ${this.hasChecksums ? 'present' : 'not present'}`);

        let messageCount = 0;
        let firstUnknownOffset = null;

        while (offset < view.byteLength) {
            if (offset + 3 > view.byteLength) break;
            
            const msgStartOffset = offset;
            
            if (messageCount < 5) {
                const peek20 = this.readBytes(view, offset, Math.min(20, view.byteLength - offset));
                console.log(`Offset 0x${offset.toString(16)}, next 20 bytes:`, peek20.map(b => b.toString(16).padStart(2, '0')).join(' '));
            }
            
            const msgSize = view.getUint16(offset, true);
            offset += 2;

            const msgType = view.getUint8(offset);
            offset += 1;
            
            if (messageCount < 5) {
                console.log(`Message #${messageCount} at offset 0x${msgStartOffset.toString(16)}: size=0x${msgSize.toString(16)}, type=0x${msgType.toString(16)} '${String.fromCharCode(msgType)}'`);
            }

            if (offset + msgSize > view.byteLength) {
                console.warn(`Message at offset 0x${(offset-3).toString(16)} has size 0x${msgSize.toString(16)} which exceeds file length. Stopping parse.`);
                break;
            }
            
            const msgData = new DataView(arrayBuffer, offset, msgSize);
            
            const validTypes = [70, 73, 77, 80, 65, 68, 66, 76, 82, 83, 79, 67, 81];
            if (!validTypes.includes(msgType) && firstUnknownOffset === null) {
                firstUnknownOffset = offset - 3;
                console.error(`First unknown message type at offset 0x${firstUnknownOffset.toString(16)}:`);
                console.error(`  Message #${messageCount}`);
                console.error(`  Size: 0x${msgSize.toString(16)}`);
                console.error(`  Type: 0x${msgType.toString(16)} '${String.fromCharCode(msgType)}'`);
                console.error(`  Previous 10 bytes:`, this.readBytes(view, Math.max(0, offset - 13), 10).map(b => b.toString(16).padStart(2, '0')).join(' '));
                console.error(`  Next 10 bytes:`, this.readBytes(view, offset, 10).map(b => b.toString(16).padStart(2, '0')).join(' '));
                
                console.log('Searching for next valid message type...');
                let found = false;
                let bestMatch = null;
                for (let searchOffset = offset; searchOffset < Math.min(offset + 100, view.byteLength - 3); searchOffset++) {
                    const testSize = view.getUint16(searchOffset, true);
                    const testType = view.getUint8(searchOffset + 2);
                    if (validTypes.includes(testType) && testSize > 0 && testSize < 10000) {
                        if (!bestMatch) {
                            bestMatch = searchOffset;
                            console.log(`  Found valid message at offset 0x${searchOffset.toString(16)}: size=0x${testSize.toString(16)}, type=0x${testType.toString(16)} ('${String.fromCharCode(testType)}')`);
                            console.log(`  Gap bytes (offset 0x${offset.toString(16)} to 0x${searchOffset.toString(16)}):`, this.readBytes(view, offset, searchOffset - offset).map(b => b.toString(16).padStart(2, '0')).join(' '));
                            
                            if (searchOffset === offset + 2) {
                                console.log('  -> Exactly 2 bytes off! This might be a padding/alignment issue.');
                                offset = searchOffset;
                                continue;
                            }
                        }
                        if (searchOffset - offset < 5) break;
                    }
                }
                
                if (messageCount < 5 && !bestMatch) {
                    console.error(`Stopping parse due to early unknown message type.`);
                    throw new Error(`Invalid ULog format: unknown message type 0x${msgType.toString(16)} at offset 0x${firstUnknownOffset.toString(16)} (message #${messageCount})`);
                } else if (bestMatch && bestMatch !== offset) {
                    console.log(`Skipped to offset 0x${bestMatch.toString(16)} to recover from parse error`);
                    offset = bestMatch;
                    messageCount--;
                    continue;
                }
            }
            
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
                    case 66: // 'B' - Flag Bits
                        this.parseFlagBits(msgData);
                        break;
                    case 76: // 'L' - Logged String
                        break;
                    case 82: // 'R' - Remove Logged Message
                        break;
                    case 83: // 'S' - Sync
                        break;
                    case 79: // 'O' - Dropout
                        break;
                    case 67: // 'C' - Logging Tagged
                        break;
                    case 81: // 'Q' - Parameter Default
                        break;
                    default:
                        if (messageCount < 100) {
                            console.warn(`Unknown message type: 0x${msgType.toString(16)} ('${String.fromCharCode(msgType)}') at offset 0x${(offset-3).toString(16)}`);
                        }
                }
            } catch (e) {
                console.error(`Error parsing message type '${String.fromCharCode(msgType)}' at offset 0x${(offset-3).toString(16)}:`, e);
            }

            offset += msgSize;
            
            if (this.hasChecksums) {
                const msgBytes = new Uint8Array(3 + msgSize);
                msgBytes[0] = msgSize & 0xFF;
                msgBytes[1] = (msgSize >>> 8) & 0xFF;
                msgBytes[2] = msgType;
                for (let i = 0; i < msgSize; i++) {
                    msgBytes[3 + i] = view.getUint8(msgStartOffset + 3 + i);
                }
                
                const calculatedCrc = crc16Xmodem(msgBytes);
                const fileCrcLow = view.getUint8(offset);
                const fileCrcHigh = view.getUint8(offset + 1);
                const fileCrc = fileCrcLow | (fileCrcHigh << 8);
                
                if (calculatedCrc !== fileCrc) {
                    if (messageCount < 100) {
                        console.error(`CRC mismatch at message #${messageCount} (offset 0x${offset.toString(16)}): calculated=0x${calculatedCrc.toString(16)}, file=0x${fileCrc.toString(16)}`);
                    }
                } else if (messageCount < 5) {
                    console.log(`CRC OK for message #${messageCount}: 0x${calculatedCrc.toString(16)}`);
                }
                
                offset += 2;
            }
            
            messageCount++;
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

    parseFlagBits(view) {
        if (view.byteLength < 16) {
            console.warn('Flag Bits message too short');
            return;
        }

        const compatFlags = view.getBigUint64(0, true);
        const incompatFlags = view.getBigUint64(8, true);
        
        console.log(`Flag Bits: compat=0x${compatFlags.toString(16)}, incompat=0x${incompatFlags.toString(16)}`);
        
        const INCOMPAT_FLAG0_DATA_APPENDED_MASK = 1n;
        if (incompatFlags & INCOMPAT_FLAG0_DATA_APPENDED_MASK) {
            const numAppendedOffsets = (view.byteLength - 16) / 8;
            console.log(`File has appended data. 0x${numAppendedOffsets.toString(16)} appended offsets.`);
            this.info.set('has_appended_data', true);
            
            const appendedOffsets = [];
            for (let i = 0; i < numAppendedOffsets; i++) {
                appendedOffsets.push(view.getBigUint64(16 + i * 8, true));
            }
            this.info.set('appended_offsets', appendedOffsets);
        }
        
        if (incompatFlags !== 0n) {
            console.warn(`Incompatible flags detected: 0x${incompatFlags.toString(16)}`);
            if (incompatFlags & ~INCOMPAT_FLAG0_DATA_APPENDED_MASK) {
                console.error('Unknown incompatibility flags - file may not parse correctly');
            }
        }
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
                if (!this.formats.has(type)) {
                    console.warn(`Unknown type: ${type}`);
                }
                return { value: null, size: 1 };
        }
    }

    extractTrackData() {
        const trackPoints = [];
        
        const positionMessages = this.data.filter(d => 
            // d._msgName === 'vehicle_global_position' ||
            // d._msgName === 'vehicle_local_position' ||
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

        const allFields = new Set();
        result.points.forEach(point => {
            Object.keys(point).forEach(key => allFields.add(key));
        });
        
        const fields = Array.from(allFields).sort();
        let csv = fields.join(',') + '\n';

        for (const point of result.points) {
            const row = fields.map(field => {
                const value = point[field];
                if (value === undefined || value === null) return '';
                if (typeof value === 'number' && !isFinite(value)) return 'NaN';
                return value;
            });
            csv += row.join(',') + '\n';
        }

        return csv;
    }
}
