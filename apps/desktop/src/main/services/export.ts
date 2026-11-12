/**
 * 整本导出
 * 四种格式：txt / 按章 Markdown / docx / epub。
 * 目标路径一律由系统对话框选，渲染进程传不进任意路径。
 */

import {
    app,
    dialog,
    type BrowserWindow,
    type OpenDialogOptions,
    type OpenDialogReturnValue,
    type SaveDialogOptions,
    type SaveDialogReturnValue,
} from 'electron';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { listChapters, listFiles, readChapter, readTextFile } from './content';
import {
    buildDocx,
    buildEpub,
    buildPlainText,
    markdownToBlocks,
    pickChapterTitle,
    type ExportChapter,
} from './export-format';
import { logError, logInfo } from './logger';
import { readBookMeta } from './library';
import { assertBookId } from './paths';
import type { ExportFormat, ExportResult } from '../../shared/types';

/** 加载后的一章，保留原始 Markdown 供"按章导出"使用 */
interface LoadedChapter extends ExportChapter {
    markdown: string;
}

/**
 * 弹保存对话框，有父窗口就挂到父窗口上
 * @param window 父窗口
 * @param options 选项
 * @returns 对话框结果
 */
async function showSaveDialog(
    window: BrowserWindow | null,
    options: SaveDialogOptions,
): Promise<SaveDialogReturnValue> {
    return window ? dialog.showSaveDialog(window, options) : dialog.showSaveDialog(options);
}

/**
 * 弹目录选择对话框
 * @param window 父窗口
 * @param options 选项
 * @returns 对话框结果
 */
async function showOpenDialog(
    window: BrowserWindow | null,
    options: OpenDialogOptions,
): Promise<OpenDialogReturnValue> {
    return window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options);
}

/**
 * 清掉文件名里的非法字符
 * @param name 原始名字
 * @returns 可用作文件名的名字
 */
function safeFileName(name: string): string {
    const cleaned = name
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned.length > 0 ? cleaned.slice(0, 60) : '未命名';
}

/**
 * 章节号补零
 * @param index 序号
 * @returns 三位字符串
 */
function padIndex(index: number): string {
    return String(index).padStart(3, '0');
}

/**
 * 读出全书正文
 * @param bookId 书 id
 * @returns 章节列表，空章会被跳过
 */
async function loadChapters(bookId: string): Promise<LoadedChapter[]> {
    const summaries = await listChapters(bookId, 'zhengwen');
    const chapters: LoadedChapter[] = [];

    for (const summary of summaries) {
        const markdown = await readChapter(bookId, 'zhengwen', summary.id);
        if (markdown.trim().length === 0) {
            continue;
        }
        const blocks = markdownToBlocks(markdown);
        chapters.push({
            index: summary.index,
            title: pickChapterTitle(blocks, summary.index),
            blocks,
            markdown,
        });
    }

    return chapters;
}

/**
 * 导出 txt
 * @param meta 书信息
 * @param chapters 章节
 * @param window 父窗口
 * @returns 结果
 */
async function exportTxt(
    meta: { title: string; genre: string },
    chapters: LoadedChapter[],
    window: BrowserWindow | null,
): Promise<ExportResult> {
    const target = await showSaveDialog(window, {
        title: '导出为 txt',
        defaultPath: join(app.getPath('documents'), `${safeFileName(meta.title)}.txt`),
        filters: [{ name: '文本文件', extensions: ['txt'] }],
    });
    if (target.canceled || !target.filePath) {
        return { ok: false, message: '已取消' };
    }

    const text = buildPlainText({ title: meta.title, genre: meta.genre, author: '' }, chapters);
    // 加 BOM，记事本打开才不会把中文认成乱码
    await writeFile(target.filePath, Buffer.from(`\uFEFF${text}`, 'utf8'));
    return { ok: true, path: target.filePath, message: '导出完成' };
}

/**
 * 导出 docx
 * @param meta 书信息
 * @param chapters 章节
 * @param window 父窗口
 * @returns 结果
 */
async function exportDocx(
    meta: { title: string; genre: string },
    chapters: LoadedChapter[],
    window: BrowserWindow | null,
): Promise<ExportResult> {
    const target = await showSaveDialog(window, {
        title: '导出为 docx',
        defaultPath: join(app.getPath('documents'), `${safeFileName(meta.title)}.docx`),
        filters: [{ name: 'Word 文档', extensions: ['docx'] }],
    });
    if (target.canceled || !target.filePath) {
        return { ok: false, message: '已取消' };
    }

    const buffer = buildDocx({ title: meta.title, genre: meta.genre, author: '' }, chapters);
    await writeFile(target.filePath, buffer);
    return { ok: true, path: target.filePath, message: '导出完成' };
}

/**
 * 导出 epub
 * @param meta 书信息
 * @param chapters 章节
 * @param window 父窗口
 * @returns 结果
 */
async function exportEpub(
    meta: { title: string; genre: string },
    chapters: LoadedChapter[],
    window: BrowserWindow | null,
): Promise<ExportResult> {
    const target = await showSaveDialog(window, {
        title: '导出为 epub',
        defaultPath: join(app.getPath('documents'), `${safeFileName(meta.title)}.epub`),
        filters: [{ name: 'EPUB 电子书', extensions: ['epub'] }],
    });
    if (target.canceled || !target.filePath) {
        return { ok: false, message: '已取消' };
    }

    const buffer = buildEpub({ title: meta.title, genre: meta.genre, author: '' }, chapters);
    await writeFile(target.filePath, buffer);
    return { ok: true, path: target.filePath, message: '导出完成' };
}

/**
 * 把书里的某个子目录原样复制到目标目录
 * @param bookId 书 id
 * @param relativeDir 书内相对目录
 * @param targetDir 目标目录
 */
async function copyDirectory(bookId: string, relativeDir: string, targetDir: string): Promise<void> {
    const files = await listFiles(bookId, relativeDir, '.md');
    if (files.length === 0) {
        return;
    }
    const destination = join(targetDir, relativeDir);
    await mkdir(destination, { recursive: true });
    for (const file of files) {
        const content = await readTextFile(bookId, `${relativeDir}/${file}`);
        await writeFile(join(destination, file), content, 'utf8');
    }
}

/**
 * 导出为"按章 Markdown"目录
 * @param bookId 书 id
 * @param meta 书信息
 * @param chapters 章节
 * @param window 父窗口
 * @returns 结果
 */
async function exportMarkdownDirectory(
    bookId: string,
    meta: { title: string },
    chapters: LoadedChapter[],
    window: BrowserWindow | null,
): Promise<ExportResult> {
    const target = await showOpenDialog(window, {
        title: '选择导出到哪里',
        properties: ['openDirectory', 'createDirectory'],
        buttonLabel: '导出到这里',
    });
    if (target.canceled || target.filePaths.length === 0) {
        return { ok: false, message: '已取消' };
    }

    const root = join(target.filePaths[0], safeFileName(meta.title));
    const contentDir = join(root, '正文');
    await mkdir(contentDir, { recursive: true });

    for (const chapter of chapters) {
        await writeFile(join(contentDir, `${padIndex(chapter.index)}.md`), chapter.markdown, 'utf8');
    }

    // 设定和状态文件一起带走，别人拿到这个目录也能直接接着写
    await copyDirectory(bookId, '细纲', root);
    await copyDirectory(bookId, '人设', root);

    for (const fileName of ['大纲.md', '账本.json', '伏笔.json', '基线.json', '锚段.md']) {
        const content = await readTextFile(bookId, fileName);
        if (content.length > 0) {
            await writeFile(join(root, fileName), content, 'utf8');
        }
    }

    return { ok: true, path: root, message: '导出完成' };
}

/**
 * 导出整本书
 * @param bookId 书 id
 * @param format 格式
 * @param window 父窗口，用于把对话框挂到应用上
 * @returns 结果
 */
export async function exportBook(
    bookId: string,
    format: ExportFormat,
    window: BrowserWindow | null,
): Promise<ExportResult> {
    try {
        const id = assertBookId(bookId);
        const meta = readBookMeta(id);
        if (!meta) {
            return { ok: false, message: '读不到 book.json，这本书可能已经损坏' };
        }

        const chapters = await loadChapters(id);
        if (chapters.length === 0) {
            return { ok: false, message: '这本书还没有正文，没什么可导出的' };
        }

        let result: ExportResult;
        if (format === 'txt') {
            result = await exportTxt(meta, chapters, window);
        } else if (format === 'docx') {
            result = await exportDocx(meta, chapters, window);
        } else if (format === 'epub') {
            result = await exportEpub(meta, chapters, window);
        } else if (format === 'markdown') {
            result = await exportMarkdownDirectory(id, meta, chapters, window);
        } else {
            return { ok: false, message: '不支持的导出格式' };
        }

        if (result.ok) {
            logInfo('导出完成', { bookId: id, format, path: result.path, chapters: chapters.length });
        }
        return result;
    } catch (error) {
        logError('导出失败', error);
        return {
            ok: false,
            message: error instanceof Error ? `导出失败：${error.message}` : '导出失败',
        };
    }
}
