/**
 * 上下文预算
 * 把"模型能装多少"折算成"这次带多少字"，各块按比例分。
 * 默认档与老版本一致，作者在设置里填了上下文窗口才放大。
 */

/** 各块的预算，单位字 */
export interface ContextBudget {
    /** 整块上限，超出后按块顺序截断 */
    totalChars: number;
    /** 当前章正文 */
    body: number;
    /** 本章细纲 */
    outline: number;
    /** 剧情画板 */
    plot: number;
    /** 前情提要 */
    recap: number;
    /** 开写包单项 */
    packItem: number;
    /** 对话历史，单独算，不进上下文块 */
    history: number;
    /** 是否按作者填的窗口放大过 */
    scaled: boolean;
}

/** 中文估算：1 字约 0.7 token，与 llm 包的 estimateTokens 同一口径 */
const CHARS_PER_TOKEN = 1 / 0.7;

/** 总字数硬上限：填 1M 也不把整本书灌进去 */
export const MAX_BUDGET_CHARS = 300_000;

/** 窗口低于这个数就当没填，免得算出一堆零头 */
const MIN_USEFUL_WINDOW = 32_000;

/** 默认预算，与 2.10.0 的行为对齐 */
export const DEFAULT_BUDGET: ContextBudget = {
    totalChars: 6000,
    body: 2500,
    outline: 1000,
    plot: 800,
    recap: 600,
    packItem: 400,
    history: 20_000,
    scaled: false,
};

/**
 * 按上下文窗口算预算
 * @param contextWindow 模型窗口（token），0 或空表示没填
 * @returns 各块预算
 */
export function computeContextBudget(contextWindow?: number | null): ContextBudget {
    const window = Math.floor(Number(contextWindow) || 0);
    if (!Number.isFinite(window) || window < MIN_USEFUL_WINDOW) {
        return { ...DEFAULT_BUDGET };
    }

    // 留 15% 给输出和系统提示，再按 0.7 token/字 折算成字数
    const totalChars = Math.min(
        Math.floor(window * 0.85 * CHARS_PER_TOKEN),
        MAX_BUDGET_CHARS,
    );
    const ratio = totalChars / DEFAULT_BUDGET.totalChars;

    /**
     * 按比例放大，可设上限
     * @param base 默认档数值
     * @param cap 放大后的天花板，不传表示不设
     * @returns 放大后的数值
     */
    const grow = (base: number, cap?: number): number => {
        const value = Math.round(base * ratio);
        return cap === undefined ? value : Math.min(value, cap);
    };

    return {
        totalChars,
        // 正文最多吃一半，剩下的留给细纲、画板、前情和开写包
        body: grow(DEFAULT_BUDGET.body, Math.floor(totalChars * 0.5)),
        outline: grow(DEFAULT_BUDGET.outline, 20_000),
        plot: grow(DEFAULT_BUDGET.plot, 20_000),
        recap: grow(DEFAULT_BUDGET.recap, 20_000),
        // 单项封顶 4000，否则 15 项就能把整块预算吃光
        packItem: grow(DEFAULT_BUDGET.packItem, 4000),
        history: Math.floor(totalChars * 0.25),
        scaled: true,
    };
}

/**
 * 把窗口折算成大概能带多少字，设置页用来给作者一个直观数字
 * @param contextWindow 窗口（token）
 * @returns 字数上限
 */
export function describeBudgetChars(contextWindow?: number | null): number {
    return computeContextBudget(contextWindow).totalChars;
}

/**
 * 把 token 数量写成 1M / 128K 这样的短形式
 * @param tokens token 数
 * @returns 短形式
 */
export function formatWindowTokens(tokens: number): string {
    if (tokens >= 1_000_000) {
        return `${Math.round(tokens / 1_000_000)}M`;
    }
    if (tokens >= 1000) {
        return `${Math.round(tokens / 1000)}K`;
    }
    return String(tokens);
}
