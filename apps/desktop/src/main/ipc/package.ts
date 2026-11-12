/**
 * 开写包 IPC
 * 组装要读六七个文件，全在主进程做，渲染进程只拿结果。
 */

import { ipcMain } from 'electron';
import { logError } from '../services/logger';
import { buildWritingPackage } from '../services/package-builder';
import { assertBookId } from '../services/paths';

/**
 * 注册开写包 IPC
 */
export function registerPackageIpc(): void {
    ipcMain.handle('package:build', async (_event, bookId: string, chapterId: string) => {
        try {
            if (typeof chapterId !== 'string' || chapterId.length === 0) {
                throw new Error('章节 id 不合法');
            }
            return await buildWritingPackage(assertBookId(bookId), chapterId);
        } catch (error) {
            logError('组装开写包失败', error);
            throw new Error(error instanceof Error ? error.message : '组装开写包失败');
        }
    });
}
