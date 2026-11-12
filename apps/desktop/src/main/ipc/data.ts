/**
 * 账本 / 伏笔 / 基线 / 体检 IPC
 * 体检全部在本地算，不发网络请求，不花 token。
 */

import { ipcMain } from 'electron';
import {
    buildChapterReport,
    computeBaseline,
    computeTextMetrics,
    type Baseline,
    type ForeshadowFile,
    type LedgerFile,
    type MetricSample,
} from '@mojiang/core';
import type { ChapterSection } from '../../shared/types';
import { readChapter, readJsonFile, writeJsonFile } from '../services/content';
import { logError } from '../services/logger';
import { assertBookId } from '../services/paths';

/** 账本文件相对路径 */
const LEDGER_FILE = '账本.json';
/** 伏笔文件相对路径 */
const FORESHADOW_FILE = '伏笔.json';
/** 基线文件相对路径 */
const BASELINE_FILE = '基线.json';

/** 空的账本 */
const EMPTY_LEDGER: LedgerFile = { tree: {}, history: [] };
/** 空的伏笔文件 */
const EMPTY_FORESHADOW: ForeshadowFile = { items: [] };

/**
 * 统一错误包装
 * @param action 动作
 * @param error 错误
 * @returns 可读错误
 */
function wrapError(action: string, error: unknown): Error {
    logError(`${action} 失败`, error);
    return new Error(error instanceof Error ? error.message : `${action}失败`);
}

/**
 * 注册数据与体检 IPC
 */
export function registerDataIpc(): void {
    ipcMain.handle('data:readLedger', async (_event, bookId: string) => {
        try {
            return await readJsonFile<LedgerFile>(assertBookId(bookId), LEDGER_FILE, EMPTY_LEDGER);
        } catch (error) {
            throw wrapError('读账本', error);
        }
    });

    ipcMain.handle('data:writeLedger', async (_event, bookId: string, ledger: LedgerFile) => {
        try {
            await writeJsonFile(assertBookId(bookId), LEDGER_FILE, ledger);
        } catch (error) {
            throw wrapError('写账本', error);
        }
    });

    ipcMain.handle('data:readForeshadow', async (_event, bookId: string) => {
        try {
            return await readJsonFile<ForeshadowFile>(
                assertBookId(bookId),
                FORESHADOW_FILE,
                EMPTY_FORESHADOW,
            );
        } catch (error) {
            throw wrapError('读伏笔', error);
        }
    });

    ipcMain.handle('data:writeForeshadow', async (_event, bookId: string, file: ForeshadowFile) => {
        try {
            await writeJsonFile(assertBookId(bookId), FORESHADOW_FILE, file);
        } catch (error) {
            throw wrapError('写伏笔', error);
        }
    });

    ipcMain.handle('data:readBaseline', async (_event, bookId: string) => {
        try {
            const baseline = await readJsonFile<Baseline | null>(
                assertBookId(bookId),
                BASELINE_FILE,
                null,
            );
            return baseline;
        } catch (error) {
            throw wrapError('读基线', error);
        }
    });

    ipcMain.handle('data:writeBaseline', async (_event, bookId: string, baseline: Baseline) => {
        try {
            await writeJsonFile(assertBookId(bookId), BASELINE_FILE, baseline);
        } catch (error) {
            throw wrapError('写基线', error);
        }
    });

    ipcMain.handle(
        'health:check',
        async (
            _event,
            request: { bookId: string; chapterId: string; title: string; text: string; properNouns: string[] },
        ) => {
            try {
                if (!request || typeof request.text !== 'string') {
                    throw new Error('体检参数不完整');
                }
                const baseline = await readJsonFile<Baseline | null>(
                    assertBookId(request.bookId),
                    BASELINE_FILE,
                    null,
                );
                return buildChapterReport({
                    chapterId: request.chapterId,
                    title: request.title,
                    text: request.text,
                    baseline,
                    lexiconOptions: { properNouns: request.properNouns ?? [] },
                });
            } catch (error) {
                throw wrapError('体检', error);
            }
        },
    );

    ipcMain.handle(
        'health:rebuildBaseline',
        async (_event, bookId: string, chapterIds: string[]) => {
            try {
                const id = assertBookId(bookId);
                if (!Array.isArray(chapterIds) || chapterIds.length === 0) {
                    throw new Error('至少选一章来建基线');
                }
                const samples: MetricSample[] = [];
                for (const chapterId of chapterIds) {
                    const section: ChapterSection = 'zhengwen';
                    const content = await readChapter(id, section, chapterId);
                    if (content.trim().length === 0) {
                        continue;
                    }
                    samples.push({
                        chapterId,
                        metrics: computeTextMetrics(content),
                    });
                }
                if (samples.length === 0) {
                    throw new Error('选中的章节都是空的，没法建基线');
                }
                const baseline = computeBaseline(samples);
                await writeJsonFile(id, BASELINE_FILE, baseline);
                return baseline;
            } catch (error) {
                throw wrapError('建基线', error);
            }
        },
    );
}
