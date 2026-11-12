/**
 * 极简 ZIP 写入器
 * docx 和 epub 都是 zip 包，用不着为这点事引一个第三方库。
 * 只支持两种存储方式：deflate（默认）和 store（EPUB 的 mimetype 强制要求不压缩）。
 */

import { deflateRawSync } from 'zlib';

/** CRC32 查表，模块加载时算一次 */
const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
        let value = index;
        for (let bit = 0; bit < 8; bit += 1) {
            value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
        }
        table[index] = value >>> 0;
    }
    return table;
})();

/**
 * 计算 CRC32
 * @param buffer 数据
 * @returns 校验值
 */
function crc32(buffer: Buffer): number {
    let crc = 0xffffffff;
    for (let index = 0; index < buffer.length; index += 1) {
        crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

/** 一个待打包的文件 */
export interface ZipEntry {
    /** 包内路径，用正斜杠 */
    name: string;
    data: Buffer;
    /** 为 true 时不压缩，EPUB 的 mimetype 必须这样 */
    store?: boolean;
}

/**
 * 把一组文件打成 zip
 * 写入顺序完全按传入顺序，这样 EPUB 能把 mimetype 放在第一个
 * @param entries 文件列表
 * @returns zip 二进制
 */
export function createZip(entries: ZipEntry[]): Buffer {
    const bodyParts: Buffer[] = [];
    const centralParts: Buffer[] = [];
    let offset = 0;

    // DOS 时间格式，写当前时间就行，阅读器不依赖它
    const now = new Date();
    const dosTime =
        ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
    const dosDate =
        (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;

    for (const entry of entries) {
        const nameBuffer = Buffer.from(entry.name, 'utf8');
        const crc = crc32(entry.data);
        const payload = entry.store ? entry.data : deflateRawSync(entry.data);
        const method = entry.store ? 0 : 8;

        // 本地文件头
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0x0800, 6); // bit 11：文件名用 UTF-8，中文路径不会乱码
        local.writeUInt16LE(method, 8);
        local.writeUInt16LE(dosTime, 10);
        local.writeUInt16LE(dosDate, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(payload.length, 18);
        local.writeUInt32LE(entry.data.length, 22);
        local.writeUInt16LE(nameBuffer.length, 26);
        local.writeUInt16LE(0, 28);

        bodyParts.push(local, nameBuffer, payload);

        // 中央目录项
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0x0800, 8);
        central.writeUInt16LE(method, 10);
        central.writeUInt16LE(dosTime, 12);
        central.writeUInt16LE(dosDate, 14);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(payload.length, 20);
        central.writeUInt32LE(entry.data.length, 24);
        central.writeUInt16LE(nameBuffer.length, 28);
        central.writeUInt32LE(0, 30); // extra + comment 长度打包成 0
        central.writeUInt16LE(0, 34); // 磁盘号
        central.writeUInt16LE(0, 36); // 内部属性
        central.writeUInt32LE(0, 38); // 外部属性
        central.writeUInt32LE(offset, 42);

        centralParts.push(central, nameBuffer);
        offset += local.length + nameBuffer.length + payload.length;
    }

    const centralBuffer = Buffer.concat(centralParts);

    // 中央目录结束记录
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralBuffer.length, 12);
    end.writeUInt32LE(offset, 16);
    end.writeUInt16LE(0, 20);

    return Buffer.concat([...bodyParts, centralBuffer, end]);
}
