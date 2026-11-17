/**
 * 原生确认对话框 IPC
 *
 * 为什么不让渲染进程直接 window.confirm：
 * window.confirm 是同步的 JS 对话框，在 Windows + 中文输入法下关闭之后，
 * Chromium 会丢掉输入法上下文，表现为「之后新建文档、新建文件夹都打不进字」。
 * 主进程的 showMessageBox 是真正的窗口级模态框，关掉后焦点和输入法都会正常归还。
 */

import { BrowserWindow, dialog, ipcMain } from 'electron';
import { logError } from '../services/logger';

/**
 * 注册确认对话框 IPC
 */
export function registerDialogIpc(): void {
    ipcMain.handle('dialog:confirm', async (event, message: string, detail?: string) => {
        try {
            const owner = BrowserWindow.fromWebContents(event.sender);
            const options = {
                type: 'question' as const,
                // 顺序按 Windows 习惯：取消在左，确定在右
                buttons: ['取消', '确定'],
                defaultId: 1,
                cancelId: 0,
                noLink: true,
                title: '墨匠',
                message,
                // 没有补充说明就不要带 detail，否则会显示一块空白
                ...(detail ? { detail } : {}),
            };
            const result = owner
                ? await dialog.showMessageBox(owner, options)
                : await dialog.showMessageBox(options);
            return result.response === 1;
        } catch (error) {
            // 弹不出来按「用户没同意」处理，绝不误删
            logError('确认对话框失败', error);
            return false;
        }
    });
}
