/**
 * 偏好蒸馏 IPC
 * 渲染层只发三件事：记一笔 AI 原文、看学到了什么、删掉不想要的
 * 对齐动作发生在保存正文时（见 ipc/library.ts），不从这里触发
 */

import { ipcMain, shell } from 'electron';
import { isPreferenceModule } from '@mojiang/core';
import { logError } from '../services/logger';
import { getPreferenceDir } from '../services/paths';
import {
    clearPreference,
    markAiText,
    preferenceOverview,
    removePreferencePair,
} from '../services/preference';

/**
 * 统一错误包装
 * @param action 动作名
 * @param error 原始错误
 * @returns 可读错误
 */
function wrapError(action: string, error: unknown): Error {
    logError(`${action} 失败`, error);
    return new Error(error instanceof Error ? error.message : `${action}失败`);
}

/**
 * 注册偏好蒸馏相关 IPC
 */
export function registerPreferenceIpc(): void {
    ipcMain.handle('preference:overview', async () => {
        try {
            return preferenceOverview();
        } catch (error) {
            throw wrapError('读取偏好', error);
        }
    });

    // 渲染层在"用到正文/替换选中"之后调一次，主进程只负责记着
    ipcMain.handle(
        'preference:mark',
        async (
            _event,
            input: { module?: unknown; bookId?: unknown; chapterId?: unknown; text?: unknown },
        ) => {
            try {
                const module = input?.module;
                const bookId = input?.bookId;
                const chapterId = input?.chapterId;
                const text = input?.text;
                // 参数一律重新校验，不信任渲染进程
                if (
                    !isPreferenceModule(module) ||
                    typeof bookId !== 'string' ||
                    typeof chapterId !== 'string' ||
                    typeof text !== 'string'
                ) {
                    return { pending: 0 };
                }
                return { pending: markAiText({ module, bookId, chapterId, text }) };
            } catch (error) {
                throw wrapError('记录偏好样本', error);
            }
        },
    );

    ipcMain.handle('preference:remove', async (_event, id: string) => {
        try {
            return removePreferencePair(String(id));
        } catch (error) {
            throw wrapError('删除偏好', error);
        }
    });

    ipcMain.handle('preference:clear', async () => {
        try {
            clearPreference();
        } catch (error) {
            throw wrapError('清空偏好', error);
        }
    });

    ipcMain.handle('preference:reveal', async () => {
        try {
            await shell.openPath(getPreferenceDir());
        } catch (error) {
            throw wrapError('打开偏好目录', error);
        }
    });
}
