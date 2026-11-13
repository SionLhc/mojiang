/**
 * 导入已有稿件
 * 一个文件导入成一本新书，按章节标题自动拆分。
 *
 * 分章策略偏保守：只在"整行像章节标题"时切，
 * 宁可少切一章，也不要把正文中间的一句话切成标题。
 */

import { readFile } from 'fs/promises';
import { basename, extname } from 'path';
import type { ImportResult } from '../../shared/types';
import { createBook } from './library';
import { writeChapter } from './content';
import { logInfo } from './logger';

/** 中文数字章节标题：第一章、第 12 回、第三节、第1卷 */
const CN_CHAPTER = /^\s*第\s*[0-9零一二三四五六七八九十百千两]{1,6}\s*[章节回卷][\s、.:：]*(.*)$/;

/** 英文章节标题：Chapter 12 */
const EN_CHAPTER = /^\s*chapter\s+\d{1,4}[\s.:：]*(.*)$/i;

/** Markdown 一级/二级标题 */
const MD_HEADING = /^\s{0,3}#{1,2}\s+(.+?)\s*#*\s*$/;

/** 单行最长多少字就不当标题了（标题不会是长句） */
const MAX_TITLE_LENGTH = 40;

/**
 * 解码文本：处理 BOM 和 GBK
 * 国内老稿件很多是 GBK，直接按 UTF-8 读会全是乱码
 * @param buffer 原始字节
 * @returns 文本
 */
function decodeText(buffer: Buffer): string {
    if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
        return buffer.subarray(3).toString('utf-8');
    }
    const utf8 = buffer.toString('utf-8');
    // 出现多个替换字符说明大概率不是 UTF-8
    const broken = (utf8.match(/\uFFFD/g) ?? []).length;
    if (broken > 3) {
        try {
            return new TextDecoder('gbk').decode(buffer);
        } catch {
            return utf8;
        }
    }
    return utf8;
}

/**
 * 判断这一行是不是章节标题
 * @param line 行文本
 * @param isMarkdown 是否 Markdown 文件
 * @returns 命中返回标题文本，否则 null
 */
function matchHeading(line: string, isMarkdown: boolean): string | null {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_TITLE_LENGTH) {
        return null;
    }

    if (isMarkdown) {
        // Markdown 里 # 才是权威标题，优先认它
        const md = trimmed.match(MD_HEADING);
        if (md) {
            return md[1].trim();
        }
    }

    if (CN_CHAPTER.test(trimmed) || EN_CHAPTER.test(trimmed)) {
        return trimmed;
    }

    return null;
}

/**
 * 把整篇文本切成章节
 * 第一个标题之前的内容如果有正文，作为「开篇」并入第一章
 * @param text 全文
 * @param isMarkdown 是否 Markdown
 * @returns 章节列表
 */
export function splitChapters(
    text: string,
    isMarkdown: boolean,
): Array<{ title: string; content: string }> {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const chapters: Array<{ title: string; content: string }> = [];

    let currentTitle = '';
    let buffer: string[] = [];

    const flush = (): void => {
        const body = buffer.join('\n').trim();
        if (body.length === 0 && currentTitle.length === 0) {
            buffer = [];
            return;
        }
        chapters.push({
            title: currentTitle.length > 0 ? currentTitle : `第 ${chapters.length + 1} 章`,
            content: body,
        });
        buffer = [];
    };

    for (const line of lines) {
        const heading = matchHeading(line, isMarkdown);
        if (heading !== null) {
            // 前面攒的内容收口（可能是一本书开头的说明文字）
            if (buffer.join('').trim().length > 0) {
                flush();
            }
            currentTitle = heading;
            buffer = [line.trim()];
            continue;
        }
        buffer.push(line);
    }
    flush();

    // 一个字都没有的文件
    return chapters.filter((chapter) => chapter.content.trim().length > 0);
}

/**
 * 从文件名推书名
 * @param fileName 文件名
 * @returns 书名
 */
function titleFromFileName(fileName: string): string {
    return basename(fileName, extname(fileName)).trim() || '未命名';
}

/**
 * 导入一个文件成一本新书
 * @param filePath 文件绝对路径
 * @returns 导入结果
 */
export async function importOneFile(filePath: string): Promise<ImportResult> {
    const fileName = basename(filePath);
    const title = titleFromFileName(filePath);

    try {
        const buffer = await readFile(filePath);
        const text = decodeText(buffer);
        const isMarkdown = extname(filePath).toLowerCase() === '.md';
        const chapters = splitChapters(text, isMarkdown);

        if (chapters.length === 0) {
            return {
                ok: false,
                title,
                fileName,
                chapters: 0,
                charCount: 0,
                error: '文件里没有可导入的文字',
            };
        }

        const book = createBook({
            title,
            genre: '',
            chapterWordTarget: 3000,
            kind: 'novel',
        });

        let charCount = 0;
        for (let index = 0; index < chapters.length; index += 1) {
            const chapter = chapters[index];
            const id = String(index + 1).padStart(3, '0');
            const body = chapter.content.startsWith(chapter.title)
                ? chapter.content
                : `${chapter.title}\n\n${chapter.content}`;
            // 新书没有旧内容，不需要为导入生成快照
            await writeChapter(book.id, 'zhengwen', id, body, { autoSnapshot: false, keep: 0 });
            charCount += body.replace(/\s/g, '').length;
        }

        logInfo('导入稿件', { filePath, bookId: book.id, chapters: chapters.length, charCount });
        return { ok: true, title: book.title, fileName, chapters: chapters.length, charCount };
    } catch (error) {
        return {
            ok: false,
            title,
            fileName,
            chapters: 0,
            charCount: 0,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
