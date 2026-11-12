/**
 * 书库与章节相关 IPC
 * 每个 handler 都要自己校验参数，不能假设渲染进程是干净的。
 */

import { ipcMain } from 'electron';
import type { BookMeta, ChapterSection, CreateBookInput } from '../../shared/types';
import { logError } from '../services/logger';
import {
    createBook,
    deleteBook,
    listBooks,
    listRecycleBin,
    readBookMeta,
    restoreFromRecycleBin,
    saveBookMeta,
} from '../services/library';
import {
    createChapter,
    deleteChapter,
    deleteFile,
    listChapters,
    listFiles,
    readChapter,
    readJsonFile,
    readTextFile,
    writeChapter,
    writeJsonFile,
    writeTextFile,
} from '../services/content';
import { loadSettings } from '../services/settings';
import { listSnapshots, readSnapshot } from '../services/snapshot';
import { assertBookId } from '../services/paths';

/**
 * 把异常统一转成可读错误，Electron 会把 message 带到渲染进程
 * @param action 动作名
 * @param error 原始错误
 * @returns 包装后的错误
 */
function wrapError(action: string, error: unknown): Error {
    logError(`${action} 失败`, error);
    const message = error instanceof Error ? error.message : '未知错误';
    return new Error(message);
}

/**
 * 校验章节区参数
 * @param section 传入值
 * @returns 合法值
 */
function assertSection(section: unknown): ChapterSection {
    if (section === 'zhengwen' || section === 'xigang') {
        return section;
    }
    throw new Error('章节区参数非法');
}

/**
 * 注册书库相关 IPC
 */
export function registerLibraryIpc(): void {
    ipcMain.handle('library:list', async () => {
        try {
            return listBooks();
        } catch (error) {
            throw wrapError('读取书列表', error);
        }
    });

    ipcMain.handle('library:create', async (_event, input: CreateBookInput) => {
        try {
            if (!input || typeof input.title !== 'string') {
                throw new Error('建书参数不完整');
            }
            return createBook(input);
        } catch (error) {
            throw wrapError('建书', error);
        }
    });

    ipcMain.handle('library:remove', async (_event, bookId: string) => {
        try {
            return deleteBook(assertBookId(bookId));
        } catch (error) {
            throw wrapError('删除书', error);
        }
    });

    ipcMain.handle('library:readMeta', async (_event, bookId: string) => {
        try {
            return readBookMeta(assertBookId(bookId));
        } catch (error) {
            throw wrapError('读取书信息', error);
        }
    });

    ipcMain.handle('library:saveMeta', async (_event, meta: BookMeta) => {
        try {
            if (!meta || typeof meta.id !== 'string') {
                throw new Error('书信息不完整');
            }
            saveBookMeta({ ...meta, id: assertBookId(meta.id), updatedAt: new Date().toISOString() });
        } catch (error) {
            throw wrapError('保存书信息', error);
        }
    });

    ipcMain.handle('library:listRecycleBin', async () => {
        try {
            return listRecycleBin();
        } catch (error) {
            throw wrapError('读取回收站', error);
        }
    });

    ipcMain.handle('library:restore', async (_event, folderName: string) => {
        try {
            return restoreFromRecycleBin(folderName);
        } catch (error) {
            throw wrapError('恢复书', error);
        }
    });
}

/**
 * 注册章节与文件相关 IPC
 */
export function registerContentIpc(): void {
    ipcMain.handle('chapter:list', async (_event, bookId: string, section: ChapterSection) => {
        try {
            return await listChapters(assertBookId(bookId), assertSection(section));
        } catch (error) {
            throw wrapError('读取章节列表', error);
        }
    });

    ipcMain.handle(
        'chapter:read',
        async (_event, bookId: string, section: ChapterSection, chapterId: string) => {
            try {
                return await readChapter(assertBookId(bookId), assertSection(section), chapterId);
            } catch (error) {
                throw wrapError('读取章节', error);
            }
        },
    );

    ipcMain.handle(
        'chapter:write',
        async (_event, bookId: string, section: ChapterSection, chapterId: string, content: string) => {
            try {
                const settings = loadSettings();
                return await writeChapter(
                    assertBookId(bookId),
                    assertSection(section),
                    chapterId,
                    content,
                    {
                        autoSnapshot: settings.ui.autoSnapshot,
                        keep: settings.ui.snapshotKeep,
                    },
                );
            } catch (error) {
                throw wrapError('保存章节', error);
            }
        },
    );

    ipcMain.handle(
        'chapter:create',
        async (
            _event,
            bookId: string,
            section: ChapterSection,
            title?: string,
            parentPath?: string,
        ) => {
            try {
                return await createChapter(
                    assertBookId(bookId),
                    assertSection(section),
                    typeof title === 'string' ? title : undefined,
                    typeof parentPath === 'string' ? parentPath : undefined,
                );
            } catch (error) {
                throw wrapError('新建章节', error);
            }
        },
    );

    ipcMain.handle(
        'chapter:remove',
        async (_event, bookId: string, section: ChapterSection, chapterId: string) => {
            try {
                await deleteChapter(assertBookId(bookId), assertSection(section), chapterId);
            } catch (error) {
                throw wrapError('删除章节', error);
            }
        },
    );

    ipcMain.handle(
        'chapter:snapshots',
        async (_event, bookId: string, section: ChapterSection, chapterId: string) => {
            try {
                return await listSnapshots(assertBookId(bookId), assertSection(section), chapterId);
            } catch (error) {
                throw wrapError('读取快照列表', error);
            }
        },
    );

    ipcMain.handle(
        'chapter:readSnapshot',
        async (_event, bookId: string, section: ChapterSection, chapterId: string, fileName: string) => {
            try {
                return await readSnapshot(assertBookId(bookId), assertSection(section), chapterId, fileName);
            } catch (error) {
                throw wrapError('读取快照', error);
            }
        },
    );

    ipcMain.handle('file:readText', async (_event, bookId: string, relativePath: string) => {
        try {
            return await readTextFile(assertBookId(bookId), relativePath);
        } catch (error) {
            throw wrapError('读文件', error);
        }
    });

    ipcMain.handle(
        'file:writeText',
        async (_event, bookId: string, relativePath: string, content: string) => {
            try {
                await writeTextFile(assertBookId(bookId), relativePath, content);
            } catch (error) {
                throw wrapError('写文件', error);
            }
        },
    );

    ipcMain.handle(
        'file:readJson',
        async (_event, bookId: string, relativePath: string, fallback: unknown) => {
            try {
                return await readJsonFile(assertBookId(bookId), relativePath, fallback);
            } catch (error) {
                throw wrapError('读数据文件', error);
            }
        },
    );

    ipcMain.handle(
        'file:writeJson',
        async (_event, bookId: string, relativePath: string, data: unknown) => {
            try {
                await writeJsonFile(assertBookId(bookId), relativePath, data);
            } catch (error) {
                throw wrapError('写数据文件', error);
            }
        },
    );

    ipcMain.handle(
        'file:list',
        async (_event, bookId: string, relativeDir: string, extension: string) => {
            try {
                return await listFiles(assertBookId(bookId), relativeDir, extension);
            } catch (error) {
                throw wrapError('列目录', error);
            }
        },
    );

    ipcMain.handle('file:remove', async (_event, bookId: string, relativePath: string) => {
        try {
            await deleteFile(assertBookId(bookId), relativePath);
        } catch (error) {
            throw wrapError('删除文件', error);
        }
    });
}
