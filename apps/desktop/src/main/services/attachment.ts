/**
 * AI 对话附件提取
 * 把作者上传的文档变成纯文本，作为上下文交给 AI。
 * 支持纯文本类（txt/md/json/csv/log/代码）和 Word（docx）。
 * 图片和 PDF 暂不支持（当前模型是文本模型，传上去 AI 也看不见）。
 */

import { readFile } from 'fs/promises';
import { basename, extname } from 'path';
import * as mammoth from 'mammoth';

/** 提取后的附件 */
export interface ExtractedAttachment {
    /** 文件名 */
    name: string;
    /** 扩展名（小写，不带点） */
    ext: string;
    /** 提取的文本（超长会截断） */
    text: string;
    /** 原文总字数（截断前） */
    chars: number;
    /** 是否被截断 */
    truncated: boolean;
}

/** 文本类扩展名：直接按 UTF-8 读 */
const TEXT_EXTS = new Set([
    'txt',
    'md',
    'markdown',
    'json',
    'csv',
    'tsv',
    'log',
    'yaml',
    'yml',
    'ini',
    'conf',
    'xml',
    'html',
    'htm',
    'ts',
    'tsx',
    'js',
    'jsx',
    'py',
    'java',
    'go',
    'rs',
    'sql',
    'sh',
    'bat',
    'ps1',
    'c',
    'h',
    'cpp',
    'css',
]);

/** 单个附件最多带多少字进上下文 */
const MAX_ATTACHMENT_CHARS = 4000;

/** 文件选择框可选的扩展名（不含点） */
export const ATTACHMENT_EXTENSIONS = [...TEXT_EXTS, 'docx'];

/**
 * 提取一个文件为纯文本
 * @param filePath 绝对路径
 * @returns 附件内容
 */
export async function extractAttachment(filePath: string): Promise<ExtractedAttachment> {
    const ext = extname(filePath).replace('.', '').toLowerCase();
    const name = basename(filePath);

    let fullText = '';
    if (ext === 'docx') {
        const buffer = await readFile(filePath);
        const result = await mammoth.extractRawText({ buffer });
        fullText = result.value;
    } else if (TEXT_EXTS.has(ext)) {
        fullText = await readFile(filePath, 'utf-8');
    } else {
        throw new Error(
            `不支持 ${ext.length > 0 ? ext : '这种'} 格式。可以传 txt / md / json / csv / log / 代码文件 / Word（docx）`,
        );
    }

    // 去掉多余空行，省 token
    const cleaned = fullText
        .replace(/\r\n?/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    if (cleaned.length === 0) {
        throw new Error('文件里没有可读的文字');
    }
    const chars = cleaned.length;
    const truncated = chars > MAX_ATTACHMENT_CHARS;
    return {
        name,
        ext,
        text: truncated
            ? `${cleaned.slice(0, MAX_ATTACHMENT_CHARS)}\n……（原文共 ${chars} 字，已截断）`
            : cleaned,
        chars,
        truncated,
    };
}

/**
 * 批量提取，失败的不中断，逐条返回错误
 * @param filePaths 文件路径列表
 * @returns 提取结果与失败信息
 */
export async function extractAttachments(filePaths: string[]): Promise<{
    items: ExtractedAttachment[];
    errors: Array<{ name: string; message: string }>;
}> {
    const items: ExtractedAttachment[] = [];
    const errors: Array<{ name: string; message: string }> = [];
    // 一次最多 5 个，避免一下子把上下文撑爆
    for (const filePath of filePaths.slice(0, 5)) {
        try {
            items.push(await extractAttachment(filePath));
        } catch (error) {
            errors.push({
                name: basename(filePath),
                message: error instanceof Error ? error.message : '读取失败',
            });
        }
    }
    return { items, errors };
}
