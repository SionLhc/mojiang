/**
 * 文件日志
 * 面向他人使用时，出问题要能拿到日志，但不能把日志写到用户找不到的地方。
 * 规划书要求：日志放 文档/墨匠/日志/
 */

import { appendFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { getLogDir } from './paths';

/** 单条日志超过这个长度就截断，避免把整章正文写进日志 */
const MAX_MESSAGE_LENGTH = 2000;

/**
 * 当天的日志文件路径
 * @returns 绝对路径
 */
function todayLogPath(): string {
    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
        now.getDate(),
    ).padStart(2, '0')}`;
    return join(getLogDir(), `${stamp}.log`);
}

/**
 * 写一条日志
 * 日志失败绝不能影响主流程，所以内部吞掉异常
 * @param level 级别
 * @param message 内容
 * @param detail 附加信息
 */
async function writeLog(level: string, message: string, detail?: unknown): Promise<void> {
    const line = `[${new Date().toISOString()}] [${level}] ${message}${
        detail === undefined ? '' : ` ${safeStringify(detail)}`
    }`;

    if (level === 'ERROR') {
        console.error(line);
    } else {
        console.log(line);
    }

    try {
        await mkdir(getLogDir(), { recursive: true });
        await appendFile(todayLogPath(), `${line}\n`, 'utf-8');
    } catch {
        // 日志目录不可写时静默失败，不能因为记日志把应用搞崩
    }
}

/**
 * 安全序列化，避免循环引用或超大对象把日志写爆
 * @param value 任意值
 * @returns 字符串
 */
function safeStringify(value: unknown): string {
    try {
        const text = JSON.stringify(value);
        return text.length > MAX_MESSAGE_LENGTH ? `${text.slice(0, MAX_MESSAGE_LENGTH)}…` : text;
    } catch {
        return '[无法序列化]';
    }
}

/**
 * 记录普通信息
 * @param message 内容
 * @param detail 附加信息
 */
export function logInfo(message: string, detail?: unknown): void {
    void writeLog('INFO', message, detail);
}

/**
 * 记录警告
 * @param message 内容
 * @param detail 附加信息
 */
export function logWarn(message: string, detail?: unknown): void {
    void writeLog('WARN', message, detail);
}

/**
 * 记录错误
 * @param message 内容
 * @param error 错误对象
 */
export function logError(message: string, error?: unknown): void {
    if (error instanceof Error) {
        void writeLog('ERROR', message, { name: error.name, message: error.message, stack: error.stack });
        return;
    }
    void writeLog('ERROR', message, error);
}
