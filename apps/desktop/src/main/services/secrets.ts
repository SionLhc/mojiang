/**
 * API Key 安全存储
 * 优先用 Electron 内置 safeStorage（Windows 走 DPAPI / macOS 走 Keychain / Linux 走 libsecret）。
 * 为什么不用 keytar：keytar 是原生模块，装不上的机器直接崩，而且每个 Electron 大版本都要重编。
 * safeStorage 是官方方案，零原生依赖，安全等级相同。
 *
 * 降级：系统加密不可用时，用本机派生密钥做 AES-256-GCM，并在设置页提示风险。
 * Key 永远存在 userData，不进「文档/墨匠」，因为书库可能被同步或分享出去。
 */

import { app, safeStorage } from 'electron';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { ProviderId } from '@mojiang/llm';
import { logError, logInfo } from './logger';

/** 存储格式标识 */
type SecretsFormat = 'safeStorage' | 'aes-256-gcm';

/** 磁盘结构 */
interface SecretsFile {
    format: SecretsFormat;
    /** providerId -> 密文（base64） */
    entries: Record<string, string>;
}

/**
 * secrets 文件路径
 * @returns 绝对路径
 */
function secretsPath(): string {
    return join(app.getPath('userData'), 'secrets.json');
}

/**
 * 用本机信息派生 32 字节密钥，作为 safeStorage 不可用时的兜底
 * 这不是强保护（拿到本机文件仍可能被解），但明显好过明文
 * @returns 密钥 buffer
 */
function deriveLocalKey(): Buffer {
    const material = `${app.getPath('userData')}|${process.env.COMPUTERNAME ?? 'local'}|mojiang`;
    return scryptSync(material, 'mojiang-secrets', 32);
}

/**
 * 读 secrets 文件
 * @returns 文件内容，不存在或损坏时返回空结构
 */
function readSecrets(): SecretsFile {
    const path = secretsPath();
    if (!existsSync(path)) {
        return { format: selectFormat(), entries: {} };
    }
    try {
        const raw = JSON.parse(readFileSync(path, 'utf-8')) as SecretsFile;
        if (!raw || typeof raw.entries !== 'object') {
            return { format: selectFormat(), entries: {} };
        }
        return raw;
    } catch (error) {
        logError('secrets 文件损坏，已忽略', error);
        return { format: selectFormat(), entries: {} };
    }
}

/**
 * 选择当前可用的加密方式
 * @returns 格式标识
 */
function selectFormat(): SecretsFormat {
    return safeStorage.isEncryptionAvailable() ? 'safeStorage' : 'aes-256-gcm';
}

/**
 * 写 secrets 文件，权限收紧到仅当前用户
 * @param file 内容
 */
function writeSecrets(file: SecretsFile): void {
    const dir = app.getPath('userData');
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    writeFileSync(secretsPath(), JSON.stringify(file, null, 4), { encoding: 'utf-8', mode: 0o600 });
}

/**
 * 加密一个字符串
 * @param plain 明文
 * @returns base64 密文与使用的格式
 */
function encrypt(plain: string): { format: SecretsFormat; payload: string } {
    const format = selectFormat();
    if (format === 'safeStorage') {
        return { format, payload: safeStorage.encryptString(plain).toString('base64') };
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', deriveLocalKey(), iv);
    const encrypted = Buffer.concat([cipher.update(plain, 'utf-8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    // 格式：iv(12) + tag(16) + 密文
    return { format, payload: Buffer.concat([iv, tag, encrypted]).toString('base64') };
}

/**
 * 解密一个字符串
 * @param format 加密格式
 * @param payload base64 密文
 * @returns 明文，失败返回空串
 */
function decrypt(format: SecretsFormat, payload: string): string {
    try {
        const buffer = Buffer.from(payload, 'base64');
        if (format === 'safeStorage') {
            return safeStorage.decryptString(buffer);
        }
        const iv = buffer.subarray(0, 12);
        const tag = buffer.subarray(12, 28);
        const encrypted = buffer.subarray(28);
        const decipher = createDecipheriv('aes-256-gcm', deriveLocalKey(), iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf-8');
    } catch (error) {
        logError('API Key 解密失败，可能需要重新填写', error);
        return '';
    }
}

/**
 * 保存某个 provider 的 Key
 * @param providerId provider
 * @param apiKey 明文 Key
 */
export function setApiKey(providerId: ProviderId, apiKey: string): void {
    const file = readSecrets();
    const trimmed = apiKey.trim();
    if (trimmed.length === 0) {
        delete file.entries[providerId];
        writeSecrets(file);
        return;
    }
    const encrypted = encrypt(trimmed);
    file.format = encrypted.format;
    file.entries[providerId] = encrypted.payload;
    writeSecrets(file);
    logInfo(`已保存 ${providerId} 的 API Key`, { format: encrypted.format });
}

/**
 * 取某个 provider 的 Key
 * @param providerId provider
 * @returns 明文 Key，没有则空串
 */
export function getApiKey(providerId: ProviderId): string {
    const file = readSecrets();
    const payload = file.entries[providerId];
    if (!payload) {
        return '';
    }
    return decrypt(file.format, payload);
}

/**
 * 是否已经存过 Key
 * @param providerId provider
 * @returns 是否存在
 */
export function hasApiKey(providerId: ProviderId): boolean {
    const file = readSecrets();
    return Boolean(file.entries[providerId]);
}

/**
 * 清空某个 provider 的 Key
 * @param providerId provider
 */
export function clearApiKey(providerId: ProviderId): void {
    const file = readSecrets();
    delete file.entries[providerId];
    writeSecrets(file);
}

/**
 * 当前加密方式的人话说明，设置页要显示
 * @returns 说明文本
 */
export function describeEncryption(): string {
    return selectFormat() === 'safeStorage'
        ? 'Key 已用系统钥匙串加密存储（Windows DPAPI / macOS Keychain）'
        : '系统钥匙串不可用，已用本机派生密钥加密（安全性低于系统钥匙串）';
}
