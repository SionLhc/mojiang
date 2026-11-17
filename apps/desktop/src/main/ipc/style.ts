/**
 * 写法相关的 IPC：人味蒸馏（别人的）与我的笔感（自己的）
 *
 * 人味蒸馏三个动作：选素材（顺带报每本多少字）、跑蒸馏（更新那一份基线）、看已攒多少样本。
 * 我的笔感只读不写入口在这里——采样发生在保存正文时，不靠渲染层触发。
 * 参数一律在主进程重新校验：渲染层传来的路径可能被改过。
 */

import { dialog, ipcMain, shell } from 'electron';
import { extname } from 'path';
import { logError } from '../services/logger';
import { getStyleDir } from '../services/paths';
import {
    clearPersonalTrace,
    personalTraceOverview,
    personalTracePrompt,
    setPersonalTraceAnchor,
} from '../services/personal-trace';
import { distillStyle, humanTraceOverview, inspectStyleFiles } from '../services/style-distill';

/** 允许的扩展名：和 service 里保持一致 */
const ALLOWED_EXTENSIONS = ['.txt', '.md'];

/** 一次最多选几本 */
const MAX_FILES = 8;

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
 * 校验并收敛路径列表
 * @param raw 渲染层传进来的值
 * @returns 合法路径（已去重、限量）
 */
function sanitizeFiles(raw: unknown): string[] {
    if (!Array.isArray(raw)) {
        return [];
    }
    const files = raw
        .filter((item): item is string => typeof item === 'string' && item.length > 0)
        .filter((item) => ALLOWED_EXTENSIONS.includes(extname(item).toLowerCase()));
    return [...new Set(files)].slice(0, MAX_FILES);
}

/**
 * 注册人味蒸馏相关 IPC
 */
export function registerStyleIpc(): void {
    // 选素材：只列扩展名，真正的读文件与字数统计交给 service
    ipcMain.handle('style:pick', async () => {
        try {
            const result = await dialog.showOpenDialog({
                title: '选择参考书（txt / md，一次可以选多本）',
                properties: ['openFile', 'multiSelections'],
                filters: [
                    { name: '文本', extensions: ['txt', 'md'] },
                    { name: '全部文件', extensions: ['*'] },
                ],
            });
            if (result.canceled) {
                return { canceled: true, files: [] };
            }
            const files = await inspectStyleFiles(sanitizeFiles(result.filePaths));
            return { canceled: false, files };
        } catch (error) {
            throw wrapError('选择素材', error);
        }
    });

    ipcMain.handle('style:distill', async (_event, request: { files?: unknown }) => {
        try {
            const files = sanitizeFiles(request?.files);
            if (files.length === 0) {
                return { ok: false, message: '没有可用的 txt / md 文件' };
            }
            const result = await distillStyle({ files });
            return { ok: true, ...result };
        } catch (error) {
            // 蒸馏失败是常见情况（字数不够、文件被移走），返回中文原因而不是抛异常
            logError('人味蒸馏失败', error);
            return { ok: false, message: error instanceof Error ? error.message : '蒸馏失败' };
        }
    });

    ipcMain.handle('style:overview', async () => {
        try {
            return humanTraceOverview();
        } catch (error) {
            throw wrapError('读取人味档案', error);
        }
    });

    ipcMain.handle('personal:overview', async () => {
        try {
            return personalTraceOverview();
        } catch (error) {
            throw wrapError('读取我的笔感', error);
        }
    });

    // 渲染层拼系统提示时来取：成熟度不够时 block 是空串，说明"还不到注入的时候"
    ipcMain.handle('personal:prompt', async () => {
        try {
            return await personalTracePrompt();
        } catch (error) {
            throw wrapError('读取我的笔感提示', error);
        }
    });

    // 回到从前的自己：at 传 null 表示取消参照
    ipcMain.handle('personal:setAnchor', async (_event, at: unknown) => {
        try {
            return setPersonalTraceAnchor(typeof at === 'string' && at.length > 0 ? at : null);
        } catch (error) {
            throw wrapError('设置我的笔感参照', error);
        }
    });

    ipcMain.handle('personal:clear', async () => {
        try {
            clearPersonalTrace();
        } catch (error) {
            throw wrapError('清空我的笔感', error);
        }
    });

    // 画像和参考书档案放同一个目录，一起备份最省事
    ipcMain.handle('personal:reveal', async () => {
        try {
            await shell.openPath(getStyleDir());
        } catch (error) {
            throw wrapError('打开写法目录', error);
        }
    });
}
