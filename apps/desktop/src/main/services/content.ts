/**
 * 项目内容服务：文档树、读写、标签
 * 小说用「正文/细纲」，笔记用「文档」，物理目录按项目类型决定。
 * 所有路径都过 bookPath 校验，渲染进程拿不到任意读写能力。
 */

import { existsSync, readFileSync } from 'fs';
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import {
    getProjectFeatures,
    parseFrontMatter,
    pickDocumentTitle,
    writeTags,
    type ProjectKind,
} from '@mojiang/core';
import type { ChapterSection, ChapterSummary, TreeNode } from '../../shared/types';
import { logError } from './logger';
import { bookPath, ensureBookDirs } from './paths';
import { writeSnapshot } from './snapshot';

/** 目录树最大递归深度，防止异常目录结构把界面拖死 */
const MAX_TREE_DEPTH = 8;

/**
 * 校验书内相对路径，禁止穿越
 * @param relativePath 相对路径
 * @returns 原样返回
 */
function assertRelativePath(relativePath: string): string {
    if (
        relativePath.length === 0 ||
        relativePath.includes('..') ||
        relativePath.startsWith('/') ||
        relativePath.startsWith('\\') ||
        relativePath.includes(':')
    ) {
        throw new Error('文件路径非法');
    }
    return relativePath;
}

/**
 * 同步读项目类型，老数据没有 kind 就返回 undefined（按小说处理）
 * @param bookId 书 id
 * @returns 项目类型
 */
function readProjectKind(bookId: string): ProjectKind | undefined {
    const metaPath = bookPath(bookId, 'book.json');
    if (!existsSync(metaPath)) {
        return undefined;
    }
    try {
        const meta = JSON.parse(readFileSync(metaPath, 'utf-8')) as { kind?: ProjectKind };
        return meta.kind;
    } catch {
        return undefined;
    }
}

/**
 * 取某个区对应的物理目录名
 * @param kind 项目类型
 * @param section 区
 * @returns 目录名
 */
function sectionDir(kind: ProjectKind | undefined, section: ChapterSection): string {
    if (section === 'xigang') {
        return '细纲';
    }
    return getProjectFeatures(kind).contentDir;
}

/**
 * 把标题转成安全的文件名
 * @param name 原始标题
 * @returns 可用作文件名的名字
 */
function safeFileTitle(name: string): string {
    const cleaned = name
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned.length > 0 ? cleaned.slice(0, 60) : '未命名';
}

/**
 * 把章节文件名转成序号
 * @param fileName 形如 001.md
 * @returns 序号，解析不出来返回 0
 */
function parseChapterIndex(fileName: string): number {
    const match = fileName.match(/^(\d+)/);
    return match ? Number.parseInt(match[1], 10) : 0;
}

/**
 * 递归读一个目录，生成树
 * @param dir 绝对目录
 * @param relative 相对内容根目录的路径，根为空串
 * @param depth 当前深度
 * @returns 节点列表
 */
async function walkTree(dir: string, relative: string, depth: number): Promise<TreeNode[]> {
    if (depth > MAX_TREE_DEPTH || !existsSync(dir)) {
        return [];
    }

    const folders: TreeNode[] = [];
    const files: TreeNode[] = [];
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
        const entryPath = relative.length > 0 ? `${relative}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
            folders.push({
                type: 'folder',
                name: entry.name,
                path: entryPath,
                children: await walkTree(join(dir, entry.name), entryPath, depth + 1),
            });
            continue;
        }

        if (!entry.name.endsWith('.md')) {
            continue;
        }

        const fullPath = join(dir, entry.name);
        try {
            const content = await readFile(fullPath, 'utf-8');
            const info = await stat(fullPath);
            const meta = parseFrontMatter(content);
            const name = entry.name.replace(/\.md$/, '');
            const id = relative.length > 0 ? `${relative}/${name}` : name;
            files.push({
                type: 'file',
                name,
                path: id,
                chapter: {
                    id,
                    index: parseChapterIndex(entry.name),
                    title: pickDocumentTitle(content, name),
                    charCount: meta.body.replace(/\s/g, '').length,
                    updatedAt: info.mtime.toISOString(),
                    tags: meta.tags,
                },
            });
        } catch (error) {
            logError(`读文档失败：${entryPath}`, error);
        }
    }

    folders.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
    // 001 / 002 这种编号名按字符串排也对，笔记按名字排也顺
    files.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));

    return [...folders, ...files];
}

/**
 * 读某个区的目录树
 * @param bookId 书 id
 * @param section 区
 * @returns 树
 */
export async function listTree(bookId: string, section: ChapterSection): Promise<TreeNode[]> {
    const kind = readProjectKind(bookId);
    ensureBookDirs(bookId, kind);
    const dir = bookPath(bookId, sectionDir(kind, section));
    return walkTree(dir, '', 0);
}

/**
 * 把树拍平成文档列表
 * @param nodes 树
 * @returns 文档列表
 */
function flattenTree(nodes: TreeNode[]): ChapterSummary[] {
    const result: ChapterSummary[] = [];
    const walk = (list: TreeNode[]): void => {
        for (const node of list) {
            if (node.chapter) {
                result.push(node.chapter);
            }
            if (node.children) {
                walk(node.children);
            }
        }
    };
    walk(nodes);
    return result;
}

/**
 * 列出一个区下的全部文档（含子目录）
 * @param bookId 书 id
 * @param section 区
 * @returns 文档列表
 */
export async function listChapters(
    bookId: string,
    section: ChapterSection,
): Promise<ChapterSummary[]> {
    return flattenTree(await listTree(bookId, section));
}

/**
 * 读一篇内容
 * @param bookId 书 id
 * @param section 区
 * @param chapterId 相对路径，如 "001" 或 "项目A/会议"
 * @returns 内容
 */
export async function readChapter(
    bookId: string,
    section: ChapterSection,
    chapterId: string,
): Promise<string> {
    const kind = readProjectKind(bookId);
    const dir = sectionDir(kind, section);
    assertRelativePath(`${dir}/${chapterId}.md`);
    const path = bookPath(bookId, dir, `${chapterId}.md`);
    if (!existsSync(path)) {
        return '';
    }
    return readFile(path, 'utf-8');
}

/**
 * 写一篇内容，写之前自动快照旧内容
 * @param bookId 书 id
 * @param section 区
 * @param chapterId 相对路径
 * @param content 新内容
 * @param options 快照开关与保留数量
 * @returns 写入后的字数与是否生成了快照
 */
export async function writeChapter(
    bookId: string,
    section: ChapterSection,
    chapterId: string,
    content: string,
    options: { autoSnapshot: boolean; keep: number },
): Promise<{ charCount: number; snapshotCreated: boolean }> {
    const kind = readProjectKind(bookId);
    const dir = sectionDir(kind, section);
    assertRelativePath(`${dir}/${chapterId}.md`);
    const path = bookPath(bookId, dir, `${chapterId}.md`);

    let previous = '';
    if (existsSync(path)) {
        previous = await readFile(path, 'utf-8');
    }

    // 内容没变就不写、不快照，避免刷新一次多一份垃圾快照
    if (previous === content) {
        return { charCount: content.replace(/\s/g, '').length, snapshotCreated: false };
    }

    let snapshotCreated = false;
    if (options.autoSnapshot && previous.trim().length > 0) {
        await writeSnapshot(bookId, section, chapterId, previous, options.keep);
        snapshotCreated = true;
    }

    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf-8');
    return { charCount: content.replace(/\s/g, '').length, snapshotCreated };
}

/**
 * 生成一个不冲突的文件名
 * @param dir 绝对目录
 * @param base 基础名（不含扩展名）
 * @returns 可用的 id（相对路径）
 */
async function uniqueDocumentId(dir: string, base: string): Promise<string> {
    let candidate = base;
    let counter = 2;
    while (existsSync(join(dir, `${candidate}.md`))) {
        candidate = `${base}-${counter}`;
        counter += 1;
    }
    return candidate;
}

/**
 * 新建一篇内容
 * 小说按 001 编号，笔记按标题命名
 * @param bookId 书 id
 * @param section 区
 * @param title 标题，笔记项目直接当文件名
 * @param parentPath 父文件夹相对路径，留空放根目录
 * @returns 新文档摘要
 */
export async function createChapter(
    bookId: string,
    section: ChapterSection,
    title?: string,
    parentPath?: string,
): Promise<ChapterSummary> {
    const kind = readProjectKind(bookId);
    const features = getProjectFeatures(kind);
    const dirName = sectionDir(kind, section);
    ensureBookDirs(bookId, kind);

    const parentRelative = parentPath ? assertRelativePath(parentPath) : '';
    const baseDir = parentRelative
        ? bookPath(bookId, dirName, parentRelative)
        : bookPath(bookId, dirName);
    await mkdir(baseDir, { recursive: true });

    if (features.numberedFiles) {
        const existing = await listChapters(bookId, section);
        const maxIndex = existing.reduce((max, item) => Math.max(max, item.index), 0);
        const nextIndex = maxIndex + 1;
        const chapterId = String(nextIndex).padStart(3, '0');
        const heading = title?.trim() && title.trim().length > 0 ? title.trim() : `第 ${nextIndex} 章`;
        const content = `# ${heading}\n\n`;
        const fullId = parentRelative ? `${parentRelative}/${chapterId}` : chapterId;
        await writeFile(bookPath(bookId, dirName, `${fullId}.md`), content, 'utf-8');
        return {
            id: fullId,
            index: nextIndex,
            title: heading,
            charCount: 0,
            updatedAt: new Date().toISOString(),
            tags: [],
        };
    }

    const base = safeFileTitle(title?.trim() || '未命名');
    const uniqueName = await uniqueDocumentId(baseDir, base);
    const fullId = parentRelative ? `${parentRelative}/${uniqueName}` : uniqueName;
    const content = `# ${uniqueName}\n\n`;
    await writeFile(bookPath(bookId, dirName, `${fullId}.md`), content, 'utf-8');

    return {
        id: fullId,
        index: 0,
        title: uniqueName,
        charCount: 0,
        updatedAt: new Date().toISOString(),
        tags: [],
    };
}

/**
 * 新建一个文件夹
 * @param bookId 书 id
 * @param section 区
 * @param name 文件夹名
 * @param parentPath 父文件夹相对路径
 * @returns 新文件夹的相对路径
 */
export async function createFolder(
    bookId: string,
    section: ChapterSection,
    name: string,
    parentPath?: string,
): Promise<string> {
    const kind = readProjectKind(bookId);
    const dirName = sectionDir(kind, section);
    const folderName = safeFileTitle(name?.trim() || '新文件夹');
    const parentRelative = parentPath ? assertRelativePath(parentPath) : '';
    const relative = parentRelative ? `${parentRelative}/${folderName}` : folderName;
    await mkdir(bookPath(bookId, dirName, relative), { recursive: true });
    return relative;
}

/**
 * 删除一篇内容：挪到回收站，不直接删
 * @param bookId 书 id
 * @param section 区
 * @param chapterId 相对路径
 */
export async function deleteChapter(
    bookId: string,
    section: ChapterSection,
    chapterId: string,
): Promise<void> {
    const kind = readProjectKind(bookId);
    const dirName = sectionDir(kind, section);
    assertRelativePath(`${dirName}/${chapterId}.md`);
    const path = bookPath(bookId, dirName, `${chapterId}.md`);
    if (!existsSync(path)) {
        return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = chapterId.split('/').pop() ?? chapterId;
    const target = bookPath(bookId, '回收站', `${fileName}__${stamp}.md`);
    await mkdir(dirname(target), { recursive: true });
    await rename(path, target);
}

/**
 * 给一篇文档设置标签，写进 frontmatter
 * @param bookId 书 id
 * @param section 区
 * @param chapterId 相对路径
 * @param tags 标签
 * @returns 新内容
 */
export async function setDocumentTags(
    bookId: string,
    section: ChapterSection,
    chapterId: string,
    tags: string[],
): Promise<string> {
    const current = await readChapter(bookId, section, chapterId);
    const next = writeTags(current, tags);
    // 改标签不产生快照，否则版本列表会被标签噪音挤满
    await writeChapter(bookId, section, chapterId, next, { autoSnapshot: false, keep: 0 });
    return next;
}

/**
 * 读书内任意文本文件（大纲、人设、报告等）
 * @param bookId 书 id
 * @param relativePath 相对路径
 * @returns 内容，不存在时为空串
 */
export async function readTextFile(bookId: string, relativePath: string): Promise<string> {
    const path = bookPath(bookId, assertRelativePath(relativePath));
    if (!existsSync(path)) {
        return '';
    }
    return readFile(path, 'utf-8');
}

/**
 * 写书内任意文本文件，自动建父目录
 * @param bookId 书 id
 * @param relativePath 相对路径
 * @param content 内容
 */
export async function writeTextFile(
    bookId: string,
    relativePath: string,
    content: string,
): Promise<void> {
    const path = bookPath(bookId, assertRelativePath(relativePath));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf-8');
}

/**
 * 读书内 JSON 文件，坏了就返回兜底值并留日志
 * @param bookId 书 id
 * @param relativePath 相对路径
 * @param fallback 兜底值
 * @returns 解析结果
 */
export async function readJsonFile<T>(bookId: string, relativePath: string, fallback: T): Promise<T> {
    const content = await readTextFile(bookId, relativePath);
    if (content.trim().length === 0) {
        return fallback;
    }
    try {
        return JSON.parse(content) as T;
    } catch (error) {
        logError(`${relativePath} 解析失败，已用兜底值`, error);
        return fallback;
    }
}

/**
 * 写书内 JSON 文件
 * @param bookId 书 id
 * @param relativePath 相对路径
 * @param data 数据
 */
export async function writeJsonFile(bookId: string, relativePath: string, data: unknown): Promise<void> {
    await writeTextFile(bookId, relativePath, JSON.stringify(data, null, 4));
}

/**
 * 列出某个目录下的文件
 * @param bookId 书 id
 * @param relativeDir 相对目录
 * @param extension 扩展名过滤，如 .md
 * @returns 文件名列表
 */
export async function listFiles(
    bookId: string,
    relativeDir: string,
    extension: string,
): Promise<string[]> {
    const dir = bookPath(bookId, assertRelativePath(relativeDir));
    if (!existsSync(dir)) {
        return [];
    }
    return (await readdir(dir)).filter((name) => name.endsWith(extension)).sort();
}

/**
 * 删除书内一个文件，挪进书内回收站
 * @param bookId 书 id
 * @param relativePath 相对路径
 */
export async function deleteFile(bookId: string, relativePath: string): Promise<void> {
    const path = bookPath(bookId, assertRelativePath(relativePath));
    if (!existsSync(path)) {
        return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = relativePath.split('/').pop() ?? 'file';
    const target = bookPath(bookId, '回收站', `${fileName}__${stamp}`);
    await mkdir(dirname(target), { recursive: true });
    await rename(path, target);
}

/**
 * 确保书目录存在（供写操作前调用）
 * @param bookId 书 id
 */
export function ensureContentDirs(bookId: string): void {
    ensureBookDirs(bookId, readProjectKind(bookId));
}

/**
 * 清理书内回收站里过老的条目
 * @param bookId 书 id
 * @param keepDays 保留天数
 */
export async function purgeBookTrash(bookId: string, keepDays: number = 30): Promise<void> {
    const dir = bookPath(bookId, '回收站');
    if (!existsSync(dir)) {
        return;
    }
    const deadline = Date.now() - keepDays * 24 * 60 * 60 * 1000;
    for (const name of await readdir(dir)) {
        const fullPath = join(dir, name);
        try {
            const info = await stat(fullPath);
            if (info.mtimeMs < deadline) {
                await unlink(fullPath);
            }
        } catch (error) {
            logError(`清理回收站失败：${name}`, error);
        }
    }
}
