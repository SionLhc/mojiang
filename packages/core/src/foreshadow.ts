/**
 * 伏笔：登记、提及、回收、超期扫描
 * 全部按章节号比较，不依赖任何模型判断。
 */

import type { Foreshadow, ForeshadowAlert, ForeshadowFile } from './types';

/** 默认超期阈值：多少章没动就标黄 */
export const DEFAULT_STALE_CHAPTERS = 20;

/**
 * 生成一个短 id，够用且可读
 * @returns id 字符串
 */
function createId(): string {
    return `fs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * 登记一条新伏笔
 * @param content 伏笔内容
 * @param plantedChapter 埋设章节号
 * @param plannedChapter 计划回收章节号
 * @returns 伏笔条目
 */
export function createForeshadow(
    content: string,
    plantedChapter: number,
    plannedChapter: number | null = null,
): Foreshadow {
    return {
        id: createId(),
        content,
        plantedChapter,
        plannedChapter,
        mentions: [plantedChapter],
        payoffChapter: null,
        createdAt: new Date().toISOString(),
    };
}

/**
 * 记录一次提及，章节号去重
 * @param item 伏笔条目
 * @param chapter 章节号
 * @returns 新条目
 */
export function touchForeshadow(item: Foreshadow, chapter: number): Foreshadow {
    const mentions = item.mentions.includes(chapter)
        ? item.mentions
        : [...item.mentions, chapter].sort((left, right) => left - right);
    return { ...item, mentions };
}

/**
 * 标记回收
 * @param item 伏笔条目
 * @param chapter 回收章节号
 * @returns 新条目
 */
export function payoffForeshadow(item: Foreshadow, chapter: number): Foreshadow {
    return { ...item, payoffChapter: chapter };
}

/**
 * 取最后一次被碰到的章节
 * @param item 伏笔条目
 * @returns 章节号
 */
export function lastTouchedChapter(item: Foreshadow): number {
    const last = item.mentions.length > 0 ? item.mentions[item.mentions.length - 1] : item.plantedChapter;
    return item.payoffChapter !== null && item.payoffChapter > last ? item.payoffChapter : last;
}

/**
 * 超期扫描：超过 N 章没有新提及且未回收的标黄
 * @param file 伏笔文件
 * @param currentChapter 当前写作章
 * @param staleThreshold 超期阈值
 * @returns 告警列表，按严重程度排序
 */
export function scanForeshadow(
    file: ForeshadowFile,
    currentChapter: number,
    staleThreshold: number = DEFAULT_STALE_CHAPTERS,
): ForeshadowAlert[] {
    const alerts: ForeshadowAlert[] = [];

    for (const item of file.items) {
        if (item.payoffChapter !== null) {
            continue;
        }
        const touched = lastTouchedChapter(item);
        const gap = currentChapter - touched;

        // 计划回收章已过，优先报计划超期
        if (item.plannedChapter !== null && currentChapter > item.plannedChapter) {
            alerts.push({
                id: item.id,
                content: item.content,
                lastTouchedChapter: touched,
                gap,
                level: 'error',
                message: `计划在第 ${item.plannedChapter} 章回收，现在已经到第 ${currentChapter} 章`,
            });
            continue;
        }

        if (gap > staleThreshold) {
            alerts.push({
                id: item.id,
                content: item.content,
                lastTouchedChapter: touched,
                gap,
                level: gap > staleThreshold * 2 ? 'error' : 'warn',
                message: `已经 ${gap} 章没提过这条伏笔（第 ${touched} 章最后一次出现）`,
            });
        }
    }

    const levelWeight = { error: 0, warn: 1, info: 2 };
    return alerts.sort((left, right) => levelWeight[left.level] - levelWeight[right.level]);
}

/**
 * 生成给 AI 用的"待回收伏笔"清单
 * @param file 伏笔文件
 * @param currentChapter 当前章
 * @param limit 最多几条
 * @returns 文本
 */
export function summarizePendingForeshadows(
    file: ForeshadowFile,
    currentChapter: number,
    limit: number = 10,
): string {
    const pending = file.items
        .filter((item) => item.payoffChapter === null)
        .map((item) => ({ item, gap: currentChapter - lastTouchedChapter(item) }))
        .sort((left, right) => right.gap - left.gap)
        .slice(0, limit);

    if (pending.length === 0) {
        return '（没有待回收的伏笔）';
    }

    return pending
        .map(({ item, gap }) => {
            const plan = item.plannedChapter === null ? '未规划回收' : `计划第 ${item.plannedChapter} 章回收`;
            return `- [${item.id}] ${item.content}（第 ${item.plantedChapter} 章埋下，${gap} 章没提，${plan}）`;
        })
        .join('\n');
}
