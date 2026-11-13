/**
 * 码字统计的纯计算
 * 数据本身存在主进程的 统计.json，这里只管"怎么算"，不碰文件。
 */

/** 一天的写作记录 */
export interface WritingDay {
    /** 当天净增字数（删掉的不倒扣，只记新增） */
    chars: number;
    /** 当天活跃写作秒数 */
    seconds: number;
}

/** 统计文件结构 */
export interface WritingStats {
    /** 每日字数目标 */
    dailyGoal: number;
    /** 按日期索引的记录，键形如 2026-11-13 */
    days: Record<string, WritingDay>;
}

/** 默认统计：每天 2000 字 */
export const DEFAULT_WRITING_STATS: WritingStats = {
    dailyGoal: 2000,
    days: {},
};

/**
 * 生成本地时区的日期键
 * @param date 时间，默认现在
 * @returns 形如 2026-11-13
 */
export function toDateKey(date: Date = new Date()): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * 日期键平移若干天
 * @param key 日期键
 * @param deltaDays 平移天数，负数往回
 * @returns 新的日期键
 */
export function shiftDateKey(key: string, deltaDays: number): string {
    const [year, month, day] = key.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    date.setDate(date.getDate() + deltaDays);
    return toDateKey(date);
}

/**
 * 把一次写作增量记到某一天上（不改原对象）
 * @param stats 原统计
 * @param deltaChars 新增字数，负数按 0 处理
 * @param deltaSeconds 新增活跃秒数，负数按 0 处理
 * @param dateKey 记到哪天，默认今天
 * @returns 新的统计
 */
export function recordWritingDay(
    stats: WritingStats,
    deltaChars: number,
    deltaSeconds: number,
    dateKey: string = toDateKey(),
): WritingStats {
    const previous = stats.days[dateKey] ?? { chars: 0, seconds: 0 };
    return {
        dailyGoal: stats.dailyGoal,
        days: {
            ...stats.days,
            [dateKey]: {
                chars: previous.chars + Math.max(0, deltaChars),
                seconds: previous.seconds + Math.max(0, deltaSeconds),
            },
        },
    };
}

/**
 * 算连续写作天数：从今天往回数，每天都得有新增字数
 * 今天还没动笔就从昨天起算，避免零点一过连续记录就断
 * @param days 按日期索引的记录
 * @param todayKey 今天日期键，默认系统时间
 * @returns 连续天数
 */
export function computeStreak(days: Record<string, WritingDay>, todayKey: string = toDateKey()): number {
    let key = todayKey;
    if (!(days[key]?.chars > 0)) {
        key = shiftDateKey(key, -1);
    }
    let streak = 0;
    while (days[key]?.chars > 0) {
        streak += 1;
        key = shiftDateKey(key, -1);
    }
    return streak;
}
