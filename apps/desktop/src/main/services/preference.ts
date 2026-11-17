/**
 * 偏好蒸馏的落盘层
 *
 * 两个文件，职责分开：
 * - 示范.json：学到的「AI 原文 → 作者定稿」对照，注入 prompt 用
 * - 待验证.json：AI 文本刚落到正文时先记一笔，等作者下次保存时再对齐
 *
 * 为什么要"等保存"：AI 写出来的时候作者还没改，只有保存那一刻的正文才是定稿。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
    addPreferencePairs,
    emptyPreferenceFile,
    isPreferenceModule,
    pairAiSegments,
    parsePreferenceFile,
    type PreferenceFile,
    type PreferenceModule,
} from '@mojiang/core';
import { getPreferenceDir } from './paths';
import { logError, logInfo } from './logger';

/** 一条等待验证的 AI 文本 */
interface PendingAiText {
    /** 稳定 id */
    id: string;
    /** 项目类型 */
    module: PreferenceModule;
    /** 哪本书 */
    bookId: string;
    /** 哪一章 */
    chapterId: string;
    /** AI 当时给的原文（整段回复） */
    text: string;
    /** 记录时间，ISO 字符串 */
    at: string;
}

/** 最多挂多少条待验证：挂太多说明作者一直没保存，留着也没意义 */
const MAX_PENDING = 20;
/** 待验证超过这个时间就丢：一周没保存的段落，对齐出来也不可信 */
const PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * 冷却期：AI 文本落地后这么久的保存先不对齐
 *
 * 编辑器是边写边存的，AI 刚贴进去那一秒的正文几乎就是原文。
 * 如果那时候就对齐，只会得到一堆"原样保留"，而作者真正改了什么反而学不到。
 * 留一分钟让作者动手改，再对齐拿到的才是定稿。
 */
const RECONCILE_COOLDOWN_MS = 60 * 1000;

/**
 * 示范文件路径
 * @returns 绝对路径
 */
function preferenceFilePath(): string {
    return join(getPreferenceDir(), '示范.json');
}

/**
 * 待验证文件路径
 * @returns 绝对路径
 */
function pendingFilePath(): string {
    return join(getPreferenceDir(), '待验证.json');
}

/**
 * 确保偏好目录存在
 */
function ensurePreferenceDir(): void {
    const dir = getPreferenceDir();
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
}

/**
 * 写 JSON，失败只记日志
 * 偏好学不到是小事，不能让作者保存正文失败
 * @param path 目标路径
 * @param data 内容
 */
function writeJson(path: string, data: unknown): void {
    try {
        ensurePreferenceDir();
        writeFileSync(path, JSON.stringify(data, null, 4), 'utf-8');
    } catch (error) {
        logError('写偏好文件失败', error);
    }
}

/**
 * 读示范
 * @returns 示范数据，读坏了返回空结构
 */
export function readPreference(): PreferenceFile {
    try {
        if (!existsSync(preferenceFilePath())) {
            return emptyPreferenceFile();
        }
        return parsePreferenceFile(JSON.parse(readFileSync(preferenceFilePath(), 'utf-8')));
    } catch (error) {
        logError('读偏好文件失败', error);
        return emptyPreferenceFile();
    }
}

/**
 * 读待验证，顺手清掉过期的
 * @returns 待验证列表
 */
function readPending(): PendingAiText[] {
    let raw: unknown;
    try {
        if (!existsSync(pendingFilePath())) {
            return [];
        }
        raw = JSON.parse(readFileSync(pendingFilePath(), 'utf-8'));
    } catch (error) {
        logError('读待验证清单失败', error);
        return [];
    }
    if (!Array.isArray(raw)) {
        return [];
    }

    const now = Date.now();
    const result: PendingAiText[] = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object') {
            continue;
        }
        const entry = item as Record<string, unknown>;
        const at = typeof entry.at === 'string' ? entry.at : '';
        const time = Date.parse(at);
        // 时间坏了或者过期了，都不再对齐
        if (!Number.isFinite(time) || now - time > PENDING_TTL_MS) {
            continue;
        }
        if (
            typeof entry.id !== 'string' ||
            typeof entry.text !== 'string' ||
            typeof entry.bookId !== 'string' ||
            typeof entry.chapterId !== 'string' ||
            !isPreferenceModule(entry.module)
        ) {
            continue;
        }
        result.push({
            id: entry.id,
            module: entry.module,
            bookId: entry.bookId,
            chapterId: entry.chapterId,
            text: entry.text,
            at,
        });
    }
    return result;
}

/**
 * 记一笔"这段是 AI 写的，等着看作者怎么改"
 * @param input 记录内容
 * @returns 当前挂着的条数
 */
export function markAiText(input: {
    /** 项目类型 */
    module: PreferenceModule;
    /** 书 id */
    bookId: string;
    /** 章节 id */
    chapterId: string;
    /** AI 原文 */
    text: string;
}): number {
    const text = input.text.trim();
    if (text.length === 0 || !isPreferenceModule(input.module)) {
        return readPending().length;
    }

    const pending = readPending();
    // 同一本书同一章同一段内容重复记录没有意义：作者可能连点两次"用到正文"
    // 必须带上 bookId：两本书的章节 id 都从 001 开始，只比章节会漏记第二本
    const exists = pending.some(
        (item) =>
            item.bookId === input.bookId &&
            item.chapterId === input.chapterId &&
            item.text === text,
    );
    if (exists) {
        return pending.length;
    }

    pending.unshift({
        id: `w-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        module: input.module,
        bookId: input.bookId,
        chapterId: input.chapterId,
        text,
        at: new Date().toISOString(),
    });
    const trimmed = pending.slice(0, MAX_PENDING);
    writeJson(pendingFilePath(), trimmed);
    return trimmed.length;
}

/**
 * 列出某章挂着的 AI 原文
 *
 * 我的笔感采样要用这份数据判定"哪些段落是模型的话"，
 * 所以必须在 reconcileChapter 之前读——对齐完这些记录就被消费掉了。
 * @param bookId 书 id
 * @param chapterId 章节 id
 * @returns AI 原文列表
 */
export function listPendingAiTexts(bookId: string, chapterId: string): string[] {
    return readPending()
        .filter((item) => item.bookId === bookId && item.chapterId === chapterId)
        .map((item) => item.text);
}

/**
 * 保存正文时对齐：把该章挂着的 AI 原文和这份定稿比一遍
 *
 * 逐段比而不是整章比，是因为作者通常只改其中一段，
 * 原样留下的段落恰恰证明"这样写是对的"，不该混进示范里。
 * @param bookId 书 id
 * @param chapterId 章节 id
 * @param finalText 保存后的正文全文
 * @returns 本次新学到的示范条数
 */
export function reconcileChapter(bookId: string, chapterId: string, finalText: string): number {
    const pending = readPending();
    const now = Date.now();
    const targets = pending.filter((item) => {
        if (item.bookId !== bookId || item.chapterId !== chapterId) {
            return false;
        }
        // 还在冷却期：作者可能正在改，这时候对齐只会学到"原样保留"
        return now - Date.parse(item.at) >= RECONCILE_COOLDOWN_MS;
    });
    if (targets.length === 0) {
        return 0;
    }

    let file = readPreference();
    let learned = 0;
    for (const item of targets) {
        const outcome = pairAiSegments({
            aiText: item.text,
            finalText,
            module: item.module,
            bookId,
            chapterId,
            at: item.at,
        });
        if (outcome.segments === 0) {
            continue;
        }
        const before = file.pairs.length;
        file = addPreferencePairs(file, outcome.pairs, {
            segments: outcome.segments,
            accepted: outcome.accepted,
        });
        // 去重后可能一条都没加进去，只有真多了才算学到
        learned += Math.max(0, file.pairs.length - before);
    }

    writeJson(preferenceFilePath(), file);
    // 只移除这次真处理过的，冷却期内的继续挂着等作者改完
    const handled = new Set(targets.map((item) => item.id));
    writeJson(
        pendingFilePath(),
        pending.filter((item) => !handled.has(item.id)),
    );
    if (learned > 0) {
        logInfo('偏好蒸馏学到了新示范', { bookId, chapterId, learned });
    }
    return learned;
}

/**
 * 偏好概览：给设置页看
 * @returns 示范、统计与待验证条数
 */
export function preferenceOverview(): {
    pairs: PreferenceFile['pairs'];
    stats: PreferenceFile['stats'];
    pending: number;
} {
    const file = readPreference();
    return { pairs: file.pairs, stats: file.stats, pending: readPending().length };
}

/**
 * 删一条示范
 * @param id 示范 id
 * @returns 删除后的概览
 */
export function removePreferencePair(id: string): ReturnType<typeof preferenceOverview> {
    const file = readPreference();
    file.pairs = file.pairs.filter((pair) => pair.id !== id);
    writeJson(preferenceFilePath(), file);
    return preferenceOverview();
}

/**
 * 清空所有示范与待验证
 * 统计一起归零：作者点"全部清空"通常是想重新开始学
 */
export function clearPreference(): void {
    writeJson(preferenceFilePath(), emptyPreferenceFile());
    writeJson(pendingFilePath(), []);
}
