/**
 * 工作区 IPC：目录树、文件夹、标签、全局搜索、快速记录
 * 这些是通用能力，小说和笔记都用得上。
 */

import { ipcMain } from 'electron';
import { createFolder, listTree, setDocumentTags } from '../services/content';
import { logError } from '../services/logger';
import { assertBookId } from '../services/paths';
import { createQuickNote } from '../services/quick-note';
import { searchAll } from '../services/search';
import type { ChapterSection } from '../../shared/types';

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
 * 统一错误包装
 * @param action 动作名
 * @param error 原始错误
 * @returns 可读错误
 */
function wrapError(action: string, error: unknown): Error {
    logError(`${action} 失败`, error);
    return new Error(error instanceof Error ? error.message : `${action}失败`);
}

/**
 * 注册工作区 IPC
 */
export function registerWorkspaceIpc(): void {
    ipcMain.handle('tree:list', async (_event, bookId: string, section: ChapterSection) => {
        try {
            return await listTree(assertBookId(bookId), assertSection(section));
        } catch (error) {
            throw wrapError('读取目录树', error);
        }
    });

    ipcMain.handle(
        'folder:create',
        async (_event, bookId: string, section: ChapterSection, name: string, parentPath?: string) => {
            try {
                return await createFolder(
                    assertBookId(bookId),
                    assertSection(section),
                    String(name ?? ''),
                    typeof parentPath === 'string' ? parentPath : undefined,
                );
            } catch (error) {
                throw wrapError('新建文件夹', error);
            }
        },
    );

    ipcMain.handle(
        'chapter:setTags',
        async (
            _event,
            bookId: string,
            section: ChapterSection,
            chapterId: string,
            tags: string[],
        ) => {
            try {
                if (!Array.isArray(tags)) {
                    throw new Error('标签参数非法');
                }
                return await setDocumentTags(
                    assertBookId(bookId),
                    assertSection(section),
                    chapterId,
                    tags.map((tag) => String(tag)),
                );
            } catch (error) {
                throw wrapError('保存标签', error);
            }
        },
    );

    ipcMain.handle('search:all', async (_event, query: string) => {
        try {
            return await searchAll(typeof query === 'string' ? query : '');
        } catch (error) {
            throw wrapError('搜索', error);
        }
    });

    ipcMain.handle('note:quick', async (_event, text: string) => {
        try {
            if (typeof text !== 'string') {
                throw new Error('内容参数非法');
            }
            return await createQuickNote(text);
        } catch (error) {
            throw wrapError('快速记录', error);
        }
    });
}
