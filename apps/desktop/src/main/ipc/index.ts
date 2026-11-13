/**
 * IPC 统一注册入口
 * 所有通道都在这里一次性挂上，方便审计"渲染进程能干什么"。
 */

import { registerDataIpc } from './data';
import { registerExportIpc } from './export';
import { registerImportIpc } from './import';
import { registerContentIpc, registerLibraryIpc } from './library';
import { registerLlmIpc } from './llm';
import { registerMarketIpc } from './market';
import { registerPackageIpc } from './package';
import { registerAppIpc, registerSettingsIpc } from './settings';
import { registerStatsIpc } from './stats';
import { registerWorkspaceIpc } from './workspace';

/**
 * 注册全部 IPC
 */
export function registerAllIpc(): void {
    registerLibraryIpc();
    registerContentIpc();
    registerDataIpc();
    registerSettingsIpc();
    registerLlmIpc();
    registerPackageIpc();
    registerMarketIpc();
    registerExportIpc();
    registerImportIpc();
    registerWorkspaceIpc();
    registerStatsIpc();
    registerAppIpc();
}
