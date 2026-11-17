/**
 * 偏好蒸馏（A1）
 *
 * 做的事只有一件：把"AI 写的"和"作者最后定成的"对齐成示范对。
 * 不做模型微调、不上传任何内容，学的就是作者自己的改法，存在本机。
 *
 * 对齐逻辑放在 core：不碰文件和网络，主进程和渲染进程都能用，也方便单测。
 */

import { splitProseBlocks } from './text/blocks';
import { bestMatch, similarity } from './text/similarity';

/** 偏好按项目类型分开学：小说的写法不该影响周报 */
export type PreferenceModule = 'novel' | 'docs' | 'notes';

/** 一条示范：同一个意思，AI 这么写，作者改成了那样 */
export interface PreferencePair {
    /** 稳定 id，删除单条时用 */
    id: string;
    /** 属于哪类项目 */
    module: PreferenceModule;
    /** AI 原文 */
    ai: string;
    /** 作者定稿 */
    author: string;
    /** 来源：哪本书的哪一章 */
    bookId: string;
    chapterId: string;
    /** 学到时间，ISO 字符串 */
    at: string;
}

/** 累计计数，用来判断"到底学到了东西没有" */
export interface PreferenceStats {
    /** 一共比对过多少 AI 段落 */
    segments: number;
    /** 原样留下的段落数：说明这样写是对的 */
    accepted: number;
    /** 被改写的段落数：产生了示范 */
    revised: number;
}

/** 落盘结构 */
export interface PreferenceFile {
    /** 结构版本，将来改格式用 */
    version: 1;
    /** 示范对，按时间从新到旧 */
    pairs: PreferencePair[];
    /** 统计 */
    stats: PreferenceStats;
}

/** 最多留多少条：多了没用还占 prompt */
export const MAX_PREFERENCE_PAIRS = 200;
/** 太短的段落不学："好的。""嗯。"没有信息量 */
export const MIN_PAIR_LENGTH = 12;
/** 单条示范最长存多少字：超了就是整章重写，不是"改法" */
export const MAX_PAIR_LENGTH = 400;
/** 一次注入最多几条示范 */
export const MAX_PROMPT_PAIRS = 4;

/** 相似度到这个程度当"没改"（只差标点或补了个字） */
const SAME_THRESHOLD = 0.92;
/**
 * 低于这个分数就认为"不是同一段了"（换了话题、或整段删掉重写），无从对齐。
 * 定得比较低：作者真改稿时往往一句里改掉一半的字，
 * 实测这类改写相似度在 0.28 上下，阈值太高会把最该学的样本全挡掉。
 */
const RELATED_THRESHOLD = 0.25;

/**
 * 空文件
 * @returns 初始结构
 */
export function emptyPreferenceFile(): PreferenceFile {
    return { version: 1, pairs: [], stats: { segments: 0, accepted: 0, revised: 0 } };
}

/**
 * 判断是不是合法模块
 * @param value 待判定值
 * @returns 是否合法
 */
export function isPreferenceModule(value: unknown): value is PreferenceModule {
    return value === 'novel' || value === 'docs' || value === 'notes';
}

/**
 * 解析落盘数据
 * 读坏了不抛异常：偏好丢了是小事，不能连带打不开设置页
 * @param raw 已解析的 JSON
 * @returns 结构，非法输入返回空文件
 */
export function parsePreferenceFile(raw: unknown): PreferenceFile {
    const fallback = emptyPreferenceFile();
    if (!raw || typeof raw !== 'object') {
        return fallback;
    }
    const record = raw as Record<string, unknown>;
    const rawPairs = Array.isArray(record.pairs) ? record.pairs : [];
    const pairs: PreferencePair[] = [];

    for (const item of rawPairs) {
        if (!item || typeof item !== 'object') {
            continue;
        }
        const entry = item as Record<string, unknown>;
        const ai = typeof entry.ai === 'string' ? entry.ai.trim() : '';
        const author = typeof entry.author === 'string' ? entry.author.trim() : '';
        const id = typeof entry.id === 'string' ? entry.id : '';
        // 缺任何一个字段这条就没有对照价值，直接丢
        if (id.length === 0 || ai.length === 0 || author.length === 0) {
            continue;
        }
        if (!isPreferenceModule(entry.module)) {
            continue;
        }
        pairs.push({
            id,
            module: entry.module,
            ai,
            author,
            bookId: typeof entry.bookId === 'string' ? entry.bookId : '',
            chapterId: typeof entry.chapterId === 'string' ? entry.chapterId : '',
            at: typeof entry.at === 'string' ? entry.at : '',
        });
    }

    const rawStats = record.stats && typeof record.stats === 'object' ? (record.stats as Record<string, unknown>) : {};
    const toCount = (value: unknown): number =>
        typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;

    return {
        version: 1,
        pairs: pairs.slice(0, MAX_PREFERENCE_PAIRS),
        stats: {
            segments: toCount(rawStats.segments),
            accepted: toCount(rawStats.accepted),
            revised: toCount(rawStats.revised),
        },
    };
}

/**
 * 截断过长的示范
 * @param text 文本
 * @returns 不超过上限的文本
 */
function clip(text: string): string {
    return text.length > MAX_PAIR_LENGTH ? `${text.slice(0, MAX_PAIR_LENGTH)}…` : text;
}

/**
 * 对齐 AI 段落与作者定稿
 *
 * 逐段处理：作者可能只改了其中一段，其余原样留下了——
 * 原样留下的说明这样写对，改过的那段才是要学的示范。
 * @param options 参数
 * @returns 新产出的示范对与计数
 */
export function pairAiSegments(options: {
    /** AI 给出的整段文本 */
    aiText: string;
    /** 作者保存后的正文 */
    finalText: string;
    /** 项目类型 */
    module: PreferenceModule;
    /** 书 id */
    bookId: string;
    /** 章节 id */
    chapterId: string;
    /** 时间，默认取当前 */
    at?: string;
}): { pairs: PreferencePair[]; accepted: number; segments: number } {
    const aiSegments = splitProseBlocks(options.aiText).filter(
        (segment) => segment.length >= MIN_PAIR_LENGTH,
    );
    if (aiSegments.length === 0) {
        return { pairs: [], accepted: 0, segments: 0 };
    }

    const finalSegments = splitProseBlocks(options.finalText).filter(
        (segment) => segment.length >= MIN_PAIR_LENGTH,
    );
    const at = options.at ?? new Date().toISOString();
    const used = new Set<number>();
    const pairs: PreferencePair[] = [];
    let accepted = 0;

    aiSegments.forEach((aiSegment, order) => {
        // 先找完全一样的：作者原样留下了
        const exactIndex = finalSegments.findIndex(
            (segment, index) => !used.has(index) && similarity(segment, aiSegment) >= SAME_THRESHOLD,
        );
        if (exactIndex >= 0) {
            used.add(exactIndex);
            accepted += 1;
            return;
        }

        // 再找最像的：像到一定程度就是"这段被改过"
        // 记下"剩下的段落在原数组里的下标"，避免用 indexOf 找回时撞上内容相同的段落
        const restIndexes = finalSegments
            .map((_, index) => index)
            .filter((index) => !used.has(index));
        const unfinished = restIndexes.map((index) => finalSegments[index]);
        const { score, index } = bestMatch(aiSegment, unfinished);
        if (score < RELATED_THRESHOLD || index < 0) {
            // 整段被删了，或改到认不出来，学不了
            return;
        }
        const realIndex = restIndexes[index];
        const target = unfinished[index];
        if (realIndex !== undefined) {
            used.add(realIndex);
        }
        pairs.push({
            id: `p-${Date.parse(at) || Date.now()}-${order}-${pairs.length}`,
            module: options.module,
            ai: clip(aiSegment),
            author: clip(target),
            bookId: options.bookId,
            chapterId: options.chapterId,
            at,
        });
    });

    return { pairs, accepted, segments: aiSegments.length };
}

/**
 * 合并新示范
 * 去重（同一对改法只留一条）、限总量、新的排前面
 * @param file 现有数据
 * @param incoming 新学到的示范
 * @param batch 本轮的比对计数
 * @returns 新数据
 */
export function addPreferencePairs(
    file: PreferenceFile,
    incoming: PreferencePair[],
    batch?: { segments: number; accepted: number },
): PreferenceFile {
    const seen = new Set(file.pairs.map((pair) => `${pair.ai}\u0000${pair.author}`));
    const fresh: PreferencePair[] = [];
    for (const pair of incoming) {
        const key = `${pair.ai}\u0000${pair.author}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        fresh.push(pair);
    }

    return {
        version: 1,
        pairs: [...fresh, ...file.pairs].slice(0, MAX_PREFERENCE_PAIRS),
        stats: {
            segments: file.stats.segments + (batch?.segments ?? 0),
            accepted: file.stats.accepted + (batch?.accepted ?? 0),
            // 只算真的新增的，去重掉的不算
            revised: file.stats.revised + fresh.length,
        },
    };
}

/**
 * 取给当前项目用的示范
 * @param pairs 全部示范
 * @param module 当前项目类型
 * @param limit 最多几条
 * @returns 示范列表
 */
export function pickPreferencePairs(
    pairs: PreferencePair[],
    module: PreferenceModule,
    limit = MAX_PROMPT_PAIRS,
): PreferencePair[] {
    return pairs.filter((pair) => pair.module === module).slice(0, limit);
}

/**
 * 拼成注入给模型的提示块
 * 写法和技能示范保持一致：给"原文 → 定稿"的对照，让模型学改法而不是抄内容
 * @param pairs 示范（已经按模块和条数筛过）
 * @returns 提示块，没有示范时返回空串
 */
export function preferencePromptBlock(pairs: PreferencePair[]): string {
    if (pairs.length === 0) {
        return '';
    }

    const lines: string[] = [
        '作者的真实改法（下面是 AI 原文和作者最终定稿，学作者的用词、句长和节奏，不要照抄内容）：',
    ];
    pairs.forEach((pair, index) => {
        lines.push(`改法 ${index + 1}`);
        lines.push(`AI 原文：${pair.ai}`);
        lines.push(`作者定稿：${pair.author}`);
    });

    return lines.join('\n');
}
