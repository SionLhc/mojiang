/**
 * 设置与应用级 IPC
 * 这里做的事都要能被作者拒绝：换目录要弹框、开外部链接要校验协议。
 */

import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { loadSettings, updateSettings, type AppSettings } from '../services/settings';
import { clearApiKey, describeEncryption, getApiKey, hasApiKey, setApiKey } from '../services/secrets';
import { ensureRootDirs, getLogDir, getLibraryDir, getRecycleDir, getRootDir, getSettingsPath, setRootDir } from '../services/paths';
import { logError, logInfo } from '../services/logger';
import type { ProviderId } from '@mojiang/llm';
import type { AppPaths } from '../../shared/types';

/**
 * 校验 provider id
 * @param value 传入值
 * @returns 合法 id 或抛错
 */
function assertProviderId(value: unknown): ProviderId {
    const allowed: ProviderId[] = ['deepseek', 'openai', 'anthropic', 'ollama', 'custom'];
    if (typeof value !== 'string' || !allowed.includes(value as ProviderId)) {
        throw new Error('provider 参数非法');
    }
    return value as ProviderId;
}

/**
 * 注册设置相关 IPC
 */
export function registerSettingsIpc(): void {
    ipcMain.handle('settings:read', async () => {
        return loadSettings();
    });

    ipcMain.handle('settings:update', async (_event, patch: Partial<AppSettings>) => {
        try {
            if (!patch || typeof patch !== 'object') {
                throw new Error('设置参数非法');
            }
            return updateSettings(patch);
        } catch (error) {
            logError('更新设置失败', error);
            throw new Error(error instanceof Error ? error.message : '更新设置失败');
        }
    });

    ipcMain.handle('secrets:set', async (_event, providerId: unknown, apiKey: unknown) => {
        if (typeof apiKey !== 'string') {
            throw new Error('API Key 参数非法');
        }
        setApiKey(assertProviderId(providerId), apiKey);
    });

    ipcMain.handle('secrets:has', async (_event, providerId: unknown) => {
        return hasApiKey(assertProviderId(providerId));
    });

    ipcMain.handle('secrets:clear', async (_event, providerId: unknown) => {
        clearApiKey(assertProviderId(providerId));
    });

    ipcMain.handle('secrets:describe', async () => {
        return describeEncryption();
    });

    // 渲染进程永远拿不到 Key，只能拿到"有没有"
    ipcMain.handle('secrets:peekLength', async (_event, providerId: unknown) => {
        return getApiKey(assertProviderId(providerId)).length;
    });
}

/**
 * 注册应用级 IPC
 */
export function registerAppIpc(): void {
    ipcMain.handle('app:paths', async (): Promise<AppPaths> => {
        return {
            rootDir: getRootDir(),
            libraryDir: getLibraryDir(),
            recycleDir: getRecycleDir(),
            logDir: getLogDir(),
            settingsPath: getSettingsPath(),
        };
    });

    ipcMain.handle('app:revealRoot', async () => {
        await shell.openPath(getRootDir());
    });

    ipcMain.handle('app:changeRoot', async () => {
        const result = await dialog.showOpenDialog({
            title: '选择书稿存放目录',
            properties: ['openDirectory', 'createDirectory'],
            buttonLabel: '用这个目录',
        });
        if (result.canceled || result.filePaths.length === 0) {
            return null;
        }
        const target = result.filePaths[0];
        try {
            setRootDir(target);
            logInfo('书库目录已切换', { target });
            return target;
        } catch (error) {
            logError('切换书库目录失败', error);
            throw new Error('这个目录不可写，换一个试试（例如「文档」下新建一个文件夹）');
        }
    });

    ipcMain.handle('app:openExternal', async (_event, url: unknown) => {
        if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
            throw new Error('只允许打开 http/https 链接');
        }
        await shell.openExternal(url);
    });

    ipcMain.handle('app:minimize', async (event) => {
        BrowserWindow.fromWebContents(event.sender)?.minimize();
    });

    ipcMain.handle('app:maximize', async (event) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window) {
            return;
        }
        if (window.isMaximized()) {
            window.unmaximize();
        } else {
            window.maximize();
        }
    });

    ipcMain.handle('app:close', async (event) => {
        BrowserWindow.fromWebContents(event.sender)?.close();
    });

    ipcMain.handle('app:version', async () => {
        const { app } = await import('electron');
        return app.getVersion();
    });

    // 首次启动建目录，放在这里是因为渲染进程一定会先问 paths
    ensureRootDirs();
}
