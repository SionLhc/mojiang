/**
 * 技能 IPC
 * 显式列出来，方便审计"渲染进程能对技能做什么"：只能列、装、启停、删。
 */

import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import type { MarketSkillState, Skill } from '@mojiang/core';
import { getSkillDir } from '../services/paths';
import {
    exportSkillIndex,
    fetchMarketIndex,
    installSkillFromFile,
    installSkillFromMarket,
    installSkillFromText,
    installSkillFromUrl,
    listMarketSkills,
    listSkills,
    removeSkill,
    seedBuiltinSkills,
    toggleSkill,
    type SkillInstallResult,
} from '../services/skill-store';
import { logError } from '../services/logger';

/** 安装结果：走 IPC 不能直接抛异常，要用结果对象把中文原因带回去 */
type InstallResponse =
    | { ok: true; skill: Skill; replaced: boolean }
    | { ok: false; message: string };

/** 加载外部清单的结果，同样用结果对象代替异常 */
type MarketLoadResponse = { ok: true; items: MarketSkillState[] } | { ok: false; message: string };

/**
 * 统一跑一次安装并兜住异常
 * @param action 具体安装动作
 * @returns 给渲染层的结果
 */
async function runInstall(
    action: () => SkillInstallResult | Promise<SkillInstallResult>,
): Promise<InstallResponse> {
    try {
        const result = await action();
        return { ok: true, skill: result.skill, replaced: result.replaced };
    } catch (error) {
        logError('安装技能失败', error);
        return { ok: false, message: error instanceof Error ? error.message : '安装失败' };
    }
}

/**
 * 注册技能相关 IPC
 */
export function registerSkillIpc(): void {
    // 每次启动补齐内置技能并做版本迁移：作者删掉的内置技能会回来，旧版会补上新字段
    seedBuiltinSkills();

    ipcMain.handle('skill:list', async (): Promise<Skill[]> => listSkills());

    ipcMain.handle(
        'skill:import',
        async (event): Promise<{ canceled: boolean; skill?: Skill; message?: string }> => {
            const owner = BrowserWindow.fromWebContents(event.sender);
            const options = {
                title: '导入技能包',
                buttonLabel: '导入',
                properties: ['openFile' as const],
                filters: [
                    { name: '墨匠技能包', extensions: ['mjskill'] },
                    { name: '所有文件', extensions: ['*'] },
                ],
            };
            try {
                const picked = owner
                    ? await dialog.showOpenDialog(owner, options)
                    : await dialog.showOpenDialog(options);
                if (picked.canceled || picked.filePaths.length === 0) {
                    return { canceled: true };
                }
                const result = installSkillFromFile(picked.filePaths[0]);
                return { canceled: false, skill: result.skill };
            } catch (error) {
                logError('导入技能失败', error);
                return {
                    canceled: false,
                    message: error instanceof Error ? error.message : '导入失败',
                };
            }
        },
    );

    // 拖拽安装：渲染层用 webUtils 拿到本地路径后调这里
    ipcMain.handle('skill:installPath', async (_event, filePath: string): Promise<InstallResponse> => {
        return runInstall(() => installSkillFromFile(filePath));
    });

    // 粘贴安装：网页上复制的一段内容
    ipcMain.handle('skill:installText', async (_event, text: string): Promise<InstallResponse> => {
        return runInstall(() => installSkillFromText(text));
    });

    // 链接安装：把技能文件的直链丢过来
    ipcMain.handle('skill:installUrl', async (_event, url: string): Promise<InstallResponse> => {
        return runInstall(() => installSkillFromUrl(url));
    });

    // 商店：精选清单写在代码里，断网也能看能装
    ipcMain.handle('skill:market', async (): Promise<MarketSkillState[]> => listMarketSkills());

    ipcMain.handle('skill:marketInstall', async (_event, id: string): Promise<InstallResponse> => {
        return runInstall(() => installSkillFromMarket(id));
    });

    // 外部清单：别人维护的 index.json，加载后同样能一键装
    ipcMain.handle('skill:marketLoad', async (_event, url: string): Promise<MarketLoadResponse> => {
        try {
            return { ok: true, items: await fetchMarketIndex(url) };
        } catch (error) {
            logError('加载商店清单失败', error);
            return { ok: false, message: error instanceof Error ? error.message : '加载失败' };
        }
    });

    // 发布用：导出自己写的技能清单，作者拿去托管就能变成别人的"外部清单"
    ipcMain.handle('skill:exportIndex', async (): Promise<string> => exportSkillIndex());

    ipcMain.handle('skill:toggle', async (_event, id: string, enabled: boolean): Promise<Skill> => {
        return toggleSkill(id, enabled);
    });

    ipcMain.handle('skill:remove', async (_event, id: string): Promise<void> => {
        removeSkill(id);
    });

    ipcMain.handle('skill:reveal', async (): Promise<void> => {
        await shell.openPath(getSkillDir());
    });
}
