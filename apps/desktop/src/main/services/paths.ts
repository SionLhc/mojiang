/**
 * 路径与安全边界
 * 全应用只有这里能决定"磁盘上的东西放在哪"，所有文件操作都必须过 assertInsideRoot。
 * 这是面向他人使用的安全底线：渲染进程传来的路径不能直接信。
 */

import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve, sep } from 'path';
import { getProjectFeatures, type ProjectKind } from '@mojiang/core';

/** 引导配置只存书库根目录，放 userData，避免和书库互相依赖 */
interface BootstrapConfig {
    libraryRoot?: string;
}

let cachedRoot: string | null = null;

/**
 * 引导配置文件路径
 * @returns 绝对路径
 */
function getBootstrapPath(): string {
    return join(app.getPath('userData'), 'bootstrap.json');
}

/**
 * 读引导配置，读坏了就当空
 * @returns 配置对象
 */
function readBootstrap(): BootstrapConfig {
    try {
        const raw = readFileSync(getBootstrapPath(), 'utf-8');
        return JSON.parse(raw) as BootstrapConfig;
    } catch {
        return {};
    }
}

/**
 * 写引导配置
 * @param config 配置
 */
function writeBootstrap(config: BootstrapConfig): void {
    const dir = app.getPath('userData');
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    writeFileSync(getBootstrapPath(), JSON.stringify(config, null, 4), 'utf-8');
}

/**
 * 取书库根目录
 * 默认在「文档/墨匠」，不放在 AppData —— 作者要能自己找到自己的书
 * @returns 绝对路径
 */
export function getRootDir(): string {
    if (cachedRoot) {
        return cachedRoot;
    }
    const bootstrap = readBootstrap();
    cachedRoot = bootstrap.libraryRoot ?? join(app.getPath('documents'), '墨匠');
    return cachedRoot;
}

/**
 * 换一个书库根目录，用于默认位置没权限的情况
 * @param newRoot 新根目录
 */
export function setRootDir(newRoot: string): void {
    const resolved = resolve(newRoot);
    cachedRoot = resolved;
    writeBootstrap({ libraryRoot: resolved });
    ensureRootDirs();
}

/**
 * 书库目录
 * @returns 绝对路径
 */
export function getLibraryDir(): string {
    return join(getRootDir(), '书库');
}

/**
 * 回收站目录，删除的书先挪进来
 * @returns 绝对路径
 */
export function getRecycleDir(): string {
    return join(getRootDir(), '回收站');
}

/**
 * 词库目录
 * @returns 绝对路径
 */
export function getLexiconDir(): string {
    return join(getRootDir(), '词库');
}

/**
 * 日志目录
 * @returns 绝对路径
 */
export function getLogDir(): string {
    return join(getRootDir(), '日志');
}

/**
 * 设置文件路径（不含任何 Key）
 * @returns 绝对路径
 */
export function getSettingsPath(): string {
    return join(getRootDir(), '设置.json');
}

/**
 * 建齐所有基础目录
 * 第一次启动和换目录时都要调，幂等
 */
export function ensureRootDirs(): void {
    for (const dir of [getRootDir(), getLibraryDir(), getRecycleDir(), getLexiconDir(), getLogDir()]) {
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
    }
}

/**
 * 校验路径必须落在书库根目录内
 * 防 ../ 穿越，也防渲染进程被注入后乱读文件
 * @param target 待校验路径
 * @returns 规范化后的绝对路径
 */
export function assertInsideRoot(target: string): string {
    const root = resolve(getRootDir());
    const resolved = resolve(target);
    if (resolved !== root && !resolved.startsWith(root + sep)) {
        throw new Error('路径越界：只能访问墨匠数据目录内的文件');
    }
    return resolved;
}

/**
 * 校验书 id（就是书库下的单层目录名）
 * @param bookId 书 id
 * @returns 原样返回
 */
export function assertBookId(bookId: string): string {
    if (
        bookId.length === 0 ||
        bookId.includes('..') ||
        bookId.includes('/') ||
        bookId.includes('\\') ||
        bookId.includes(':')
    ) {
        throw new Error('书 id 非法');
    }
    return bookId;
}

/**
 * 拼一本书内的路径并过安全校验
 * @param bookId 书 id
 * @param segments 子路径
 * @returns 绝对路径
 */
export function bookPath(bookId: string, ...segments: string[]): string {
    return assertInsideRoot(join(getLibraryDir(), assertBookId(bookId), ...segments));
}

/**
 * 确保一个项目的目录结构存在
 * 按项目类型决定要建哪些：小说的细纲/人设/报告，笔记用不上
 * @param bookId 书 id
 * @param kind 项目类型
 */
export function ensureBookDirs(bookId: string, kind?: ProjectKind): void {
    const features = getProjectFeatures(kind);
    const dirs = [features.contentDir, '版本'];
    if (features.beatSheet) {
        dirs.push('细纲');
    }
    if (features.characters) {
        dirs.push('人设');
    }
    if (features.health || features.market) {
        dirs.push('报告');
    }

    for (const dir of dirs) {
        const target = bookPath(bookId, dir);
        if (!existsSync(target)) {
            mkdirSync(target, { recursive: true });
        }
    }
}
