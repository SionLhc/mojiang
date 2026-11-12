/**
 * 书库服务：建书 / 读书 / 删书 / 列表
 * 一本书 = 一个文件夹，所有内容都是纯文本，作者可以用任何编辑器打开。
 */

import {
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    renameSync,
    statSync,
    writeFileSync,
} from 'fs';
import { join } from 'path';
import { getProjectFeatures, type ProjectKind } from '@mojiang/core';
import type { BookMeta, BookSummary, CreateBookInput } from '../../shared/types';
import { logError, logInfo } from './logger';
import { bookPath, ensureBookDirs, getLibraryDir, getRecycleDir } from './paths';

/** 书元数据文件名 */
const BOOK_META_FILE = 'book.json';

/**
 * 把书名转成可用的目录名
 * 去掉 Windows 不允许的字符，保留中文
 * @param title 书名
 * @returns 目录名
 */
function toFolderName(title: string): string {
    const cleaned = title
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    const trimmed = cleaned.slice(0, 60);
    return trimmed.length > 0 ? trimmed : '未命名';
}

/**
 * 在书库里找一个不冲突的目录名
 * @param folderName 期望的目录名
 * @returns 实际可用的目录名
 */
function uniqueFolderName(folderName: string): string {
    let candidate = folderName;
    let counter = 2;
    while (existsSync(join(getLibraryDir(), candidate))) {
        candidate = `${folderName}-${counter}`;
        counter += 1;
    }
    return candidate;
}

/**
 * 统计一本书的正文总字数与章节数
 * @param bookId 书 id
 * @returns 统计结果
 */
function countBookContent(
    bookId: string,
    kind?: ProjectKind,
): { chapterCount: number; charCount: number; lastEditedAt: string } {
    const contentDir = bookPath(bookId, getProjectFeatures(kind).contentDir);
    if (!existsSync(contentDir)) {
        return { chapterCount: 0, charCount: 0, lastEditedAt: '' };
    }

    let chapterCount = 0;
    let charCount = 0;
    let lastEditedAt = '';

    // 递归统计：笔记项目的文档经常放在子文件夹里，只数根目录会漏
    const walk = (currentDir: string): void => {
        let entries;
        try {
            entries = readdirSync(currentDir, { withFileTypes: true });
        } catch (error) {
            logError(`统计目录失败：${currentDir}`, error);
            return;
        }
        for (const entry of entries) {
            const fullPath = join(currentDir, entry.name);
            if (entry.isDirectory()) {
                walk(fullPath);
                continue;
            }
            if (!entry.name.endsWith('.md')) {
                continue;
            }
            try {
                const content = readFileSync(fullPath, 'utf-8');
                chapterCount += 1;
                charCount += content.replace(/\s/g, '').length;
                const mtime = statSync(fullPath).mtime.toISOString();
                if (mtime > lastEditedAt) {
                    lastEditedAt = mtime;
                }
            } catch (error) {
                logError(`统计文档失败：${entry.name}`, error);
            }
        }
    };

    walk(contentDir);
    return { chapterCount, charCount, lastEditedAt };
}

/**
 * 读一本书的 book.json
 * @param bookId 书 id
 * @returns 元数据，读不到返回 null
 */
export function readBookMeta(bookId: string): BookMeta | null {
    const path = bookPath(bookId, BOOK_META_FILE);
    if (!existsSync(path)) {
        return null;
    }
    try {
        return JSON.parse(readFileSync(path, 'utf-8')) as BookMeta;
    } catch (error) {
        logError(`book.json 损坏：${bookId}`, error);
        return null;
    }
}

/**
 * 写一本书的 book.json
 * @param meta 元数据
 */
export function saveBookMeta(meta: BookMeta): void {
    const path = bookPath(meta.id, BOOK_META_FILE);
    writeFileSync(path, JSON.stringify(meta, null, 4), 'utf-8');
}

/**
 * 列出全部书
 * @returns 书列表，按最近编辑倒序
 */
export function listBooks(): BookSummary[] {
    const libraryDir = getLibraryDir();
    if (!existsSync(libraryDir)) {
        return [];
    }

    const summaries: BookSummary[] = [];
    for (const entry of readdirSync(libraryDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
            continue;
        }
        const meta = readBookMeta(entry.name);
        if (!meta) {
            continue;
        }
        const stats = countBookContent(entry.name, meta.kind);
        summaries.push({
            ...meta,
            chapterCount: stats.chapterCount,
            charCount: stats.charCount,
            lastEditedAt: stats.lastEditedAt || meta.updatedAt,
        });
    }

    return summaries.sort((left, right) => right.lastEditedAt.localeCompare(left.lastEditedAt));
}

/**
 * 建一个项目
 * @param input 建项目输入
 * @returns 新建的元数据
 */
export function createBook(input: CreateBookInput): BookMeta {
    const title = input.title.trim();
    if (title.length === 0) {
        throw new Error('名称不能为空');
    }
    if (input.chapterWordTarget <= 0) {
        throw new Error('字数目标必须大于 0');
    }

    const kind = input.kind ?? 'novel';
    const features = getProjectFeatures(kind);
    const folderName = uniqueFolderName(toFolderName(title));
    const now = new Date().toISOString();
    const meta: BookMeta = {
        id: folderName,
        title,
        genre: input.genre.trim(),
        chapterWordTarget: input.chapterWordTarget,
        kind,
        createdAt: now,
        updatedAt: now,
    };

    const dir = join(getLibraryDir(), folderName);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    ensureBookDirs(folderName, kind);
    saveBookMeta(meta);

    // 小说才需要账本、伏笔、大纲，笔记项目保持干净
    if (features.ledger) {
        const ledgerPath = bookPath(folderName, '账本.json');
        if (!existsSync(ledgerPath)) {
            writeFileSync(ledgerPath, JSON.stringify({ tree: {}, history: [] }, null, 4), 'utf-8');
        }
    }
    if (features.foreshadow) {
        const foreshadowPath = bookPath(folderName, '伏笔.json');
        if (!existsSync(foreshadowPath)) {
            writeFileSync(foreshadowPath, JSON.stringify({ items: [] }, null, 4), 'utf-8');
        }
    }
    if (features.outline8) {
        const outlinePath = bookPath(folderName, '大纲.md');
        if (!existsSync(outlinePath)) {
            writeFileSync(
                outlinePath,
                `# 《${title}》大纲\n\n（还没走八问，先在左侧点"八问大纲"）\n`,
                'utf-8',
            );
        }
    }

    logInfo('新建项目', { id: folderName, title, kind });
    return meta;
}

/**
 * 删除一本书：先挪进回收站，不直接删
 * @param bookId 书 id
 * @returns 回收站里的新路径
 */
export function deleteBook(bookId: string): string {
    const source = join(getLibraryDir(), bookId);
    if (!existsSync(source)) {
        throw new Error('这本书不存在，可能已经被删了');
    }
    const recycleDir = getRecycleDir();
    if (!existsSync(recycleDir)) {
        mkdirSync(recycleDir, { recursive: true });
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = join(recycleDir, `${bookId}__${stamp}`);
    renameSync(source, target);
    logInfo('书已移入回收站', { bookId, target });
    return target;
}

/**
 * 列出回收站里的书
 * @returns 目录名列表
 */
export function listRecycleBin(): string[] {
    const recycleDir = getRecycleDir();
    if (!existsSync(recycleDir)) {
        return [];
    }
    return readdirSync(recycleDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
        .reverse();
}

/**
 * 从回收站恢复一本书
 * @param folderName 回收站里的目录名
 * @returns 恢复后的书 id
 */
export function restoreFromRecycleBin(folderName: string): string {
    if (folderName.includes('..') || folderName.includes('/') || folderName.includes('\\')) {
        throw new Error('目录名非法');
    }
    const source = join(getRecycleDir(), folderName);
    if (!existsSync(source)) {
        throw new Error('回收站里没有这一项');
    }
    const bookId = uniqueFolderName(folderName.split('__')[0]);
    const target = join(getLibraryDir(), bookId);
    renameSync(source, target);

    // 目录名可能变了，book.json 里的 id 要跟着改
    const meta = readBookMeta(bookId);
    if (meta && meta.id !== bookId) {
        saveBookMeta({ ...meta, id: bookId });
    }
    logInfo('从回收站恢复', { bookId });
    return bookId;
}

/**
 * 更新一本书的最近编辑时间
 * @param bookId 书 id
 */
export function touchBook(bookId: string): void {
    const meta = readBookMeta(bookId);
    if (!meta) {
        return;
    }
    saveBookMeta({ ...meta, updatedAt: new Date().toISOString() });
}
