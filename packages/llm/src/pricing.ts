/**
 * 成本估算
 * 价格表是可配置的近似值：服务商随时调价，所以设置页允许覆盖。
 * 估算只用于"调用前吓一跳提醒"，不用于对账。
 */

import type { ProviderId, TokenUsage } from './types';

/** 价格规则：按 provider + 模型前缀匹配 */
export interface PriceRule {
    providerId: ProviderId;
    /** 模型名前缀，如 deepseek-chat */
    modelPrefix: string;
    /** 每百万输入 token 的价格，单位人民币元 */
    inputPerMillion: number;
    /** 每百万输出 token 的价格，单位人民币元 */
    outputPerMillion: number;
}

/**
 * 默认价格表
 * 单位：元 / 百万 token。价格会变，这只是量级参考。
 */
export const DEFAULT_PRICES: PriceRule[] = [
    { providerId: 'deepseek', modelPrefix: 'deepseek-chat', inputPerMillion: 2, outputPerMillion: 8 },
    { providerId: 'deepseek', modelPrefix: 'deepseek-reasoner', inputPerMillion: 4, outputPerMillion: 16 },
    // 兜底：DeepSeek 出新模型（如 v4 系列）时价格表里还没有，
    // 按 chat 档估算。宁可估高，也不能返回 0 —— 显示 ¥0 会让预算拦截失效。
    { providerId: 'deepseek', modelPrefix: '', inputPerMillion: 2, outputPerMillion: 8 },
    { providerId: 'openai', modelPrefix: 'gpt-4o-mini', inputPerMillion: 1.1, outputPerMillion: 4.3 },
    { providerId: 'openai', modelPrefix: 'gpt-4o', inputPerMillion: 18, outputPerMillion: 72 },
    { providerId: 'anthropic', modelPrefix: 'claude-3-5-haiku', inputPerMillion: 5.8, outputPerMillion: 29 },
    { providerId: 'anthropic', modelPrefix: 'claude-3-5-sonnet', inputPerMillion: 21.6, outputPerMillion: 108 },
    { providerId: 'anthropic', modelPrefix: 'claude-sonnet-4', inputPerMillion: 21.6, outputPerMillion: 108 },
    { providerId: 'ollama', modelPrefix: '', inputPerMillion: 0, outputPerMillion: 0 },
    { providerId: 'custom', modelPrefix: '', inputPerMillion: 0, outputPerMillion: 0 },
];

/**
 * 粗略估算一段文本的 token 数
 * 中文按 0.7 token/字，英文按 4 字符/token，误差约 ±20%
 * @param text 文本
 * @returns token 估算值
 */
export function estimateTokens(text: string): number {
    if (text.length === 0) {
        return 0;
    }
    // 中文与全角标点占多数时用中文字符系数
    const chineseChars = (text.match(/[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/g) ?? []).length;
    const otherChars = text.length - chineseChars;
    return Math.ceil(chineseChars * 0.7 + otherChars / 4);
}

/**
 * 估算消息数组的总输入 token
 * @param contents 各条消息内容
 * @returns token 估算值
 */
export function estimatePromptTokens(contents: string[]): number {
    // 每条消息有约 4 token 的格式开销
    return contents.reduce((sum, content) => sum + estimateTokens(content) + 4, 0);
}

/**
 * 找出匹配的价格规则
 * @param providerId provider
 * @param model 模型名
 * @param prices 价格表
 * @returns 命中的规则，找不到返回 null
 */
export function findPriceRule(
    providerId: ProviderId,
    model: string,
    prices: PriceRule[] = DEFAULT_PRICES,
): PriceRule | null {
    const candidates = prices.filter((rule) => rule.providerId === providerId);
    if (candidates.length === 0) {
        return null;
    }
    // 前缀越长的越精确，先匹配最长的
    const sorted = [...candidates].sort((left, right) => right.modelPrefix.length - left.modelPrefix.length);
    for (const rule of sorted) {
        if (rule.modelPrefix.length === 0 || model.startsWith(rule.modelPrefix)) {
            return rule;
        }
    }
    return null;
}

/**
 * 按用量算钱
 * @param providerId provider
 * @param model 模型名
 * @param usage token 用量
 * @param prices 价格表
 * @returns 人民币金额
 */
export function estimateCost(
    providerId: ProviderId,
    model: string,
    usage: TokenUsage,
    prices: PriceRule[] = DEFAULT_PRICES,
): number {
    const rule = findPriceRule(providerId, model, prices);
    if (!rule) {
        return 0;
    }
    const input = (usage.promptTokens / 1_000_000) * rule.inputPerMillion;
    const output = (usage.completionTokens / 1_000_000) * rule.outputPerMillion;
    return Math.round((input + output) * 10000) / 10000;
}

/**
 * 金额格式化，界面上显示 ¥0.03 这种
 * @param amount 金额
 * @returns 展示文本
 */
export function formatCost(amount: number): string {
    if (amount <= 0) {
        return '¥0';
    }
    if (amount < 0.01) {
        return `¥${amount.toFixed(4)}`;
    }
    return `¥${amount.toFixed(2)}`;
}
