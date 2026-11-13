/**
 * 码字统计读写
 * 跨项目汇总，存在数据根目录 统计.json，和设置文件同一层。
 */

import {
    DEFAULT_WRITING_STATS,
    recordWritingDay,
    type WritingStats,
} from '@mojiang/core';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { ensureRootDirs, getRootDir } from './paths';
import { logError, logInfo } from './logger';

/**
 * 统计文件的绝对路径
 * @returns 路径
 */
function statsPath(): string {
    return join(getRootDir(), '统计.json');
}

/**
 * 读统计，文件缺失或损坏时返回默认值
 * @returns 统计
 */
export function readStats(): WritingStats {
    try {
        const path = statsPath();
        if (!existsSync(path)) {
            return { ...DEFAULT_WRITING_STATS };
        }
        const raw = JSON.parse(readFileSync(path, 'utf8')) as WritingStats | null;
        if (!raw || typeof raw !== 'object' || typeof raw.dailyGoal !== 'number') {
            return { ...DEFAULT_WRITING_STATS };
        }
        return {
            dailyGoal: raw.dailyGoal,
            days: raw.days ?? {},
        };
    } catch (error) {
        // 文件坏了就当没有，不拦住写作
        logError('读统计文件失败，按默认值处理', error);
        return { ...DEFAULT_WRITING_STATS };
    }
}

/**
 * 写统计
 * @param stats 统计
 */
export function writeStats(stats: WritingStats): void {
    try {
        ensureRootDirs();
        writeFileSync(statsPath(), JSON.stringify(stats, null, 4), 'utf8');
    } catch (error) {
        logError('写统计文件失败', error);
    }
}

/**
 * 记一次写作增量（不记负数）
 * @param deltaChars 新增字数
 * @param deltaSeconds 新增活跃秒数
 * @returns 更新后的统计
 */
export function recordWriting(deltaChars: number, deltaSeconds: number): WritingStats {
    const stats = readStats();
    const next = recordWritingDay(stats, deltaChars, deltaSeconds);
    writeStats(next);
    logInfo('记一笔写作', { deltaChars, deltaSeconds });
    return next;
}

/**
 * 改每日字数目标
 * @param goal 目标字数，非正数忽略
 * @returns 更新后的统计
 */
export function setDailyGoal(goal: number): WritingStats {
    const stats = readStats();
    const safeGoal = Number.isFinite(goal) && goal > 0 ? Math.round(goal) : stats.dailyGoal;
    const next = { ...stats, dailyGoal: safeGoal };
    writeStats(next);
    return next;
}
