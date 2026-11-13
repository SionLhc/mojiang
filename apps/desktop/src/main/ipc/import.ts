import { BrowserWindow, dialog, ipcMain } from 'electron';
import type { ImportResult } from '../../shared/types';
import { importOneFile } from '../services/import';
import { logError } from '../services/logger';

/**
 * 注册稿件导入 IPC
 */
export function registerImportIpc(): void {
    ipcMain.handle(
        'import:pick',
        async (event): Promise<{ canceled: boolean; results: ImportResult[] }> => {
            try {
                const owner = BrowserWindow.fromWebContents(event.sender);
                const picked = owner
                    ? await dialog.showOpenDialog(owner, {
                          title: '选择要导入的稿件',
                          buttonLabel: '导入',
                          properties: ['openFile', 'multiSelections'],
                          filters: [{ name: '文本稿件', extensions: ['txt', 'md'] }],
                      })
                    : await dialog.showOpenDialog({
                          title: '选择要导入的稿件',
                          buttonLabel: '导入',
                          properties: ['openFile', 'multiSelections'],
                          filters: [{ name: '文本稿件', extensions: ['txt', 'md'] }],
                      });

                if (picked.canceled || picked.filePaths.length === 0) {
                    return { canceled: true, results: [] };
                }

                const results: ImportResult[] = [];
                // 一个个来：单本可能上万章，并发写会打满磁盘
                for (const filePath of picked.filePaths) {
                    results.push(await importOneFile(filePath));
                }
                return { canceled: false, results };
            } catch (error) {
                logError('导入稿件失败', error);
                throw new Error('导入失败，请查看日志');
            }
        },
    );
}
