/**
 * 码字统计的 IPC 通道
 * 数据在主进程根目录 统计.json，渲染进程只发动作。
 */

import { ipcMain } from 'electron';
import { logError } from '../services/logger';
import { readStats, recordWriting, setDailyGoal } from '../services/stats';

/** 把任意错误包成带上下文的 Error */
function wrapError(prefix: string, error: unknown): Error {
    const message = error instanceof Error ? error.message : String(error);
    return new Error(`${prefix}：${message}`);
}

/**
 * 注册统计相关 IPC
 */
export function registerStatsIpc(): void {
    ipcMain.handle('stats:read', async () => {
        return readStats();
    });

    ipcMain.handle('stats:record', async (_event, deltaChars: number, deltaSeconds: number) => {
        try {
            return recordWriting(
                Number.isFinite(deltaChars) ? deltaChars : 0,
                Number.isFinite(deltaSeconds) ? deltaSeconds : 0,
            );
        } catch (error) {
            logError('记写作量失败', error);
            throw wrapError('记写作量失败', error);
        }
    });

    ipcMain.handle('stats:setGoal', async (_event, goal: number) => {
        try {
            return setDailyGoal(goal);
        } catch (error) {
            logError('设置字数目标失败', error);
            throw wrapError('设置字数目标失败', error);
        }
    });
}
