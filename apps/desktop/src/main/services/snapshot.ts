/**
 * 版本快照
 * 每次保存前把旧内容存一份，保留最近 N 个。
 * 为什么不用 git：作者可能没装 git，而且快照要能"在软件里一键回滚"，不能依赖外部工具。
 */

import { existsSync } from 'fs';
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import type { ChapterSection, SnapshotEntry } from '../../shared/types';
import { logError } from './logger';
import { bookPath } from './paths';

/** section 到中文目录名的映射，目录名对作者要可读 */
const SECTION_DIR: Record<ChapterSection, string> = {
    zhengwen: '正文',
    xigang: '细纲',
};

/**
 * 快照目录
 * @param bookId 书 id
 * @param section 区
 * @param chapterId 章节 id
 * @returns 绝对路径
 */
function snapshotDir(bookId: string, section: ChapterSection, chapterId: string): string {
    return bookPath(bookId, '版本', SECTION_DIR[section], chapterId);
}

/**
 * 生成快照文件名，精确到毫秒，避免同秒连按保存覆盖
 * @returns 文件名
 */
function snapshotFileName(): string {
    const now = new Date();
    const pad = (value: number, width: number = 2): string => String(value).padStart(width, '0');
    const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}${pad(
        now.getMilliseconds(),
        3,
    )}`;
    return `${date}-${time}.md`;
}

/**
 * 写一份快照并清理超量部分
 * @param bookId 书 id
 * @param section 区
 * @param chapterId 章节 id
 * @param content 旧内容
 * @param keep 保留数量
 */
export async function writeSnapshot(
    bookId: string,
    section: ChapterSection,
    chapterId: string,
    content: string,
    keep: number,
): Promise<void> {
    if (content.trim().length === 0) {
        // 空内容不值得存快照，省得把 50 个名额挤满
        return;
    }
    const dir = snapshotDir(bookId, section, chapterId);
    try {
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, snapshotFileName()), content, 'utf-8');
        await purgeOldSnapshots(bookId, section, chapterId, keep);
    } catch (error) {
        logError(`写快照失败：${bookId}/${chapterId}`, error);
    }
}

/**
 * 删掉超出保留数量的旧快照
 * @param bookId 书 id
 * @param section 区
 * @param chapterId 章节 id
 * @param keep 保留数量
 */
export async function purgeOldSnapshots(
    bookId: string,
    section: ChapterSection,
    chapterId: string,
    keep: number,
): Promise<void> {
    const dir = snapshotDir(bookId, section, chapterId);
    if (!existsSync(dir)) {
        return;
    }
    const files = (await readdir(dir)).filter((name) => name.endsWith('.md')).sort();
    const overflow = files.length - Math.max(keep, 1);
    if (overflow <= 0) {
        return;
    }
    for (const name of files.slice(0, overflow)) {
        try {
            await unlink(join(dir, name));
        } catch (error) {
            logError(`删旧快照失败：${name}`, error);
        }
    }
}

/**
 * 列出一章的快照，新的在前
 * @param bookId 书 id
 * @param section 区
 * @param chapterId 章节 id
 * @returns 快照列表
 */
export async function listSnapshots(
    bookId: string,
    section: ChapterSection,
    chapterId: string,
): Promise<SnapshotEntry[]> {
    const dir = snapshotDir(bookId, section, chapterId);
    if (!existsSync(dir)) {
        return [];
    }

    const entries: SnapshotEntry[] = [];
    for (const name of await readdir(dir)) {
        if (!name.endsWith('.md')) {
            continue;
        }
        const fullPath = join(dir, name);
        try {
            const info = await stat(fullPath);
            entries.push({
                fileName: name,
                relativePath: `版本/${SECTION_DIR[section]}/${chapterId}/${name}`,
                createdAt: info.mtime.toISOString(),
                size: info.size,
            });
        } catch (error) {
            logError(`读快照信息失败：${name}`, error);
        }
    }

    return entries.sort((left, right) => right.fileName.localeCompare(left.fileName));
}

/**
 * 读一份快照内容
 * @param bookId 书 id
 * @param section 区
 * @param chapterId 章节 id
 * @param fileName 快照文件名
 * @returns 内容
 */
export async function readSnapshot(
    bookId: string,
    section: ChapterSection,
    chapterId: string,
    fileName: string,
): Promise<string> {
    if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
        throw new Error('快照文件名非法');
    }
    const path = join(snapshotDir(bookId, section, chapterId), fileName);
    if (!existsSync(path)) {
        throw new Error('这份快照已经不在了');
    }
    return readFile(path, 'utf-8');
}
