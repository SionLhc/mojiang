/**
 * 导出 IPC
 * 渲染进程只说"要哪种格式"，路径由用户通过系统对话框决定。
 */

import { BrowserWindow, ipcMain } from 'electron';
import { exportBook } from '../services/export';
import { logError } from '../services/logger';
import { assertBookId } from '../services/paths';
import type { ExportFormat, ExportResult } from '../../shared/types';

/** 允许的格式，防止渲染进程传奇怪的值 */
const ALLOWED_FORMATS: ExportFormat[] = ['txt', 'markdown', 'docx', 'epub'];

/**
 * 注册导出 IPC
 */
export function registerExportIpc(): void {
    ipcMain.handle(
        'export:book',
        async (event, bookId: string, format: ExportFormat): Promise<ExportResult> => {
            try {
                if (!ALLOWED_FORMATS.includes(format)) {
                    return { ok: false, message: '不支持的导出格式' };
                }
                const window = BrowserWindow.fromWebContents(event.sender);
                return await exportBook(assertBookId(bookId), format, window);
            } catch (error) {
                logError('导出失败', error);
                return {
                    ok: false,
                    message: error instanceof Error ? error.message : '导出失败',
                };
            }
        },
    );
}
