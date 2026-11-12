/**
 * 市场调研 IPC
 * 抓取在主进程做，渲染进程只拿结构化结果。
 */

import { ipcMain } from 'electron';
import { fetchMarketSnapshots, saveMarketReport } from '../services/market';
import { logError } from '../services/logger';
import { assertBookId } from '../services/paths';

/**
 * 注册市场调研 IPC
 */
export function registerMarketIpc(): void {
    ipcMain.handle('market:fetch', async (_event, bookId: string) => {
        try {
            return await fetchMarketSnapshots(assertBookId(bookId));
        } catch (error) {
            logError('抓取榜单失败', error);
            throw new Error(error instanceof Error ? error.message : '抓取失败');
        }
    });

    ipcMain.handle('market:saveReport', async (_event, bookId: string, markdown: string) => {
        try {
            if (typeof markdown !== 'string' || markdown.length === 0) {
                throw new Error('报告内容为空');
            }
            await saveMarketReport(assertBookId(bookId), markdown);
        } catch (error) {
            logError('保存市场报告失败', error);
            throw new Error(error instanceof Error ? error.message : '保存报告失败');
        }
    });
}
