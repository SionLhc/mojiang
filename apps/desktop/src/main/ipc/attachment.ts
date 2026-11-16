/**
 * AI 对话附件 IPC
 * 选文件（系统对话框）或直接按路径提取（拖拽用）
 */

import { BrowserWindow, dialog, ipcMain } from 'electron';
import { ATTACHMENT_EXTENSIONS, extractAttachments } from '../services/attachment';
import { logError } from '../services/logger';
import { ocrImageBuffer } from '../services/ocr';

/** 文件选择框过滤器 */
const OPEN_FILTERS = [
    { name: '可上传的文档', extensions: ATTACHMENT_EXTENSIONS },
    { name: 'Word 文档', extensions: ['docx'] },
    { name: '全部文件', extensions: ['*'] },
];

/**
 * 注册附件相关 IPC
 */
export function registerAttachmentIpc(): void {
    ipcMain.handle('attachment:pick', async (event) => {
        try {
            const window = BrowserWindow.fromWebContents(event.sender);
            const options = {
                title: '选择要交给 AI 的文档',
                properties: ['openFile' as const, 'multiSelections' as const],
                filters: OPEN_FILTERS,
                buttonLabel: '添加这些',
            };
            const result = window
                ? await dialog.showOpenDialog(window, options)
                : await dialog.showOpenDialog(options);
            if (result.canceled || result.filePaths.length === 0) {
                return { items: [], errors: [] };
            }
            return await extractAttachments(result.filePaths);
        } catch (error) {
            logError('选择附件失败', error);
            return { items: [], errors: [{ name: '', message: '选择文件失败' }] };
        }
    });

    ipcMain.handle('attachment:extract', async (_event, filePaths: unknown) => {
        if (!Array.isArray(filePaths)) {
            return { items: [], errors: [] };
        }
        const paths = filePaths.filter((item): item is string => typeof item === 'string');
        return extractAttachments(paths);
    });

    // 图片识别：粘贴的截图交给本地 OCR，认出文字后当附件用
    ipcMain.handle('attachment:ocr', async (_event, bytes: unknown, mimeType: unknown) => {
        const data =
            bytes instanceof Uint8Array
                ? bytes
                : Array.isArray(bytes)
                  ? new Uint8Array(bytes as number[])
                  : null;
        if (!data || data.length === 0) {
            return { ok: false, text: '', message: '图片数据为空' };
        }
        return ocrImageBuffer(data, typeof mimeType === 'string' ? mimeType : 'image/png');
    });
}
