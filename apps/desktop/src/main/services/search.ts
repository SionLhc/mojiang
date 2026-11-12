/**
 * 全局搜索
 * 笔记场景没有搜索等于废，所以这里要跨项目扫正文。
 * 策略：遍历书库，跳过版本和回收站，按关键词做大小写不敏感的包含匹配。
 */

import { existsSync } from 'fs';
import { readdir, readFile } from 'fs/promises';
import { join, relative } from 'path';
import {
    getProjectFeatures,
    parseFrontMatter,
    pickDocumentTitle,
    type ProjectKind,
} from '@mojiang/core';
import type { SearchHit, SearchResult } from '../../shared/types';
import { logError } from './logger';
import { getLibraryDir } from './paths';

/** 最多扫多少个文件，防止书库特别大时卡死 */
const MAX_FILES = 3000;
/** 最多返回多少条命中 */
const MAX_HITS = 60;
/** 每段摘要前后取多少字 */
const SNIPPET_PADDING = 40;
/** 递归深度上限 */
const MAX_DEPTH = 8;

/** 收集到的文件 */
interface CollectedFile {
    absolute: string;
    /** 相对书根的路径 */
    relative: string;
}

/**
 * 递归收集一本书里的 Markdown
 * @param root 书根目录
 * @param base 用于计算相对路径的基准
 * @param depth 当前深度
 * @returns 文件列表
 */
async function collectMarkdown(root: string, base: string, depth: number): Promise<CollectedFile[]> {
    if (depth > MAX_DEPTH || !existsSync(root)) {
        return [];
    }

    const result: CollectedFile[] = [];
    let entries;
    try {
        entries = await readdir(root, { withFileTypes: true });
    } catch {
        return [];
    }

    for (const entry of entries) {
        // 版本和回收站里的内容不该出现在搜索结果里
        if (entry.name === '版本' || entry.name === '回收站' || entry.name === 'node_modules') {
            continue;
        }
        const absolute = join(root, entry.name);
        if (entry.isDirectory()) {
            result.push(...(await collectMarkdown(absolute, base, depth + 1)));
            continue;
        }
        if (entry.name.endsWith('.md')) {
            result.push({ absolute, relative: relative(base, absolute) });
        }
    }

    return result;
}

/**
 * 从内容里截一段命中上下文
 * @param content 全文
 * @param offset 命中位置
 * @param length 关键词长度
 * @returns 摘要
 */
function buildSnippet(content: string, offset: number, length: number): string {
    const start = Math.max(0, offset - SNIPPET_PADDING);
    const end = Math.min(content.length, offset + length + SNIPPET_PADDING);
    const prefix = start > 0 ? '…' : '';
    const suffix = end < content.length ? '…' : '';
    return `${prefix}${content.slice(start, end).replace(/\s+/g, ' ').trim()}${suffix}`;
}

/**
 * 全库搜索
 * @param query 关键词
 * @returns 命中列表与统计
 */
export async function searchAll(query: string): Promise<SearchResult> {
    const keyword = query.trim();
    if (keyword.length === 0) {
        return { hits: [], scanned: 0, truncated: false };
    }

    const libraryDir = getLibraryDir();
    if (!existsSync(libraryDir)) {
        return { hits: [], scanned: 0, truncated: false };
    }

    const lowerKeyword = keyword.toLowerCase();
    const hits: SearchHit[] = [];
    let scanned = 0;
    let truncated = false;

    const books = await readdir(libraryDir, { withFileTypes: true });
    for (const book of books) {
        if (!book.isDirectory()) {
            continue;
        }

        const bookRoot = join(libraryDir, book.name);
        let metaKind: ProjectKind | undefined;
        try {
            const meta = JSON.parse(await readFile(join(bookRoot, 'book.json'), 'utf-8')) as {
                title?: string;
                kind?: ProjectKind;
            };
            metaKind = meta.kind;
        } catch {
            // 没有 book.json 的目录不是项目，跳过
            continue;
        }

        const bookTitle = await readBookTitle(bookRoot, book.name);

        // 只扫内容目录，人设/报告/大纲这些不参与搜索，否则跳转会找不到对应文档
        const features = getProjectFeatures(metaKind);
        const contentRoot = join(bookRoot, features.contentDir);
        const files = await collectMarkdown(contentRoot, contentRoot, 0);
        if (features.beatSheet) {
            const beatRoot = join(bookRoot, '细纲');
            files.push(...(await collectMarkdown(beatRoot, bookRoot, 0)));
        }

        for (const file of files) {
            if (scanned >= MAX_FILES || hits.length >= MAX_HITS) {
                truncated = true;
                break;
            }
            scanned += 1;

            try {
                const content = await readFile(file.absolute, 'utf-8');
                const offset = content.toLowerCase().indexOf(lowerKeyword);
                if (offset === -1) {
                    continue;
                }
                const { body } = parseFrontMatter(content);
                const normalized = file.relative.replace(/\\/g, '/');
                // 第一段是"细纲"就归到细纲区，其余都算正文/文档
                const section = normalized.startsWith('细纲/') ? 'xigang' : 'zhengwen';
                const withoutSection = normalized.startsWith('细纲/')
                    ? normalized.slice('细纲/'.length)
                    : normalized;
                const path = withoutSection.replace(/\.md$/, '');
                hits.push({
                    bookId: book.name,
                    bookTitle,
                    section,
                    path,
                    title: pickDocumentTitle(content, path.split('/').pop() ?? path),
                    snippet: buildSnippet(content, offset, keyword.length),
                    lineNumber: content.slice(0, Math.max(offset, 0)).split('\n').length,
                    offset: Math.max(0, offset - (content.length - body.length)),
                });
            } catch (error) {
                logError(`搜索读取失败：${file.absolute}`, error);
            }
        }

        if (truncated) {
            break;
        }
        // 笔记项目的类型不影响搜索，这里只是为了将来按类型过滤留口子
        void metaKind;
    }

    return { hits, scanned, truncated };
}

/**
 * 读项目标题，读不到就用目录名
 * @param bookRoot 书根目录
 * @param fallback 目录名
 * @returns 标题
 */
async function readBookTitle(bookRoot: string, fallback: string): Promise<string> {
    try {
        const meta = JSON.parse(await readFile(join(bookRoot, 'book.json'), 'utf-8')) as {
            title?: string;
        };
        return meta.title && meta.title.length > 0 ? meta.title : fallback;
    } catch {
        return fallback;
    }
}
