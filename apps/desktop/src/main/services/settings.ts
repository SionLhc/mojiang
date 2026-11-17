/**
 * 设置读写
 * 这里只存"用了哪个 provider、哪个模型、界面偏好"，绝不存 API Key。
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import type { PriceRule, ProviderId } from '@mojiang/llm';
import { ensureRootDirs, getSettingsPath } from './paths';
import { logError } from './logger';

/** 当前选择的 provider（不含 Key） */
export interface ProviderPreference {
    id: ProviderId;
    baseUrl: string;
    model: string;
    /** 模型上下文窗口（token），0 表示没填、按默认档带上下文 */
    contextWindow: number;
}

/** 写作相关设置 */
export interface WritingSettings {
    /** 单章字数目标 */
    chapterWordTarget: number;
    /** 禁用词 */
    forbiddenWords: string[];
    /** 开写清单 */
    checklist: string[];
    /** 叙事人称 */
    perspective: 'first' | 'third';
}

/** 界面主题 */
export type ThemeId = 'mist' | 'dusk' | 'paper' | 'snow' | 'green' | 'night';

/** 正文字体 */
export type BodyFont = 'system' | 'song' | 'kai' | 'hei';

/** 界面设置 */
export interface UiSettings {
    rightPanelOpen: boolean;
    focusMode: boolean;
    /** 正文/预览字号 */
    fontSize: number;
    autoSnapshot: boolean;
    /** 每章保留多少个快照 */
    snapshotKeep: number;
    /** 配色主题 */
    theme: ThemeId;
    /** 界面缩放，1 表示 100% */
    uiScale: number;
    /** 正文字体 */
    bodyFont: BodyFont;
}

/** AI 行为设置 */
export interface AiSettings {
    /** 小说项目的附加写作指令（拼在小说内置规则后面） */
    novelStyleGuide: string;
    /** 工作文档项目的附加指令（技术文档、方案规划等） */
    docsStyleGuide: string;
    /** 笔记项目的附加指令 */
    notesStyleGuide: string;
    /** 学作者的改法（偏好蒸馏）：关掉就不再记录、不再新增示范 */
    preferenceLearn: boolean;
    /** 把学到的改法注入提示：关掉只停注入，已有的示范留着 */
    preferenceInject: boolean;
    /** 记录我的笔感（自蒸馏）：关掉后保存正文不再采样，已有画像留着 */
    personalTraceLearn: boolean;
    /** 把我的笔感注入提示：关掉只停注入，画像照样继续攒 */
    personalTraceInject: boolean;
}

/** 技能商店设置 */
export interface SkillSettings {
    /** 外部清单地址，空字符串表示只用内置精选 */
    marketIndexUrl: string;
}

/** 预算设置 */
export interface BudgetSettings {
    /** 单章花费上限，超过先问 */
    perChapterLimitCny: number;
    /** 月度上限 */
    monthlyLimitCny: number;
}

/** 用量统计，按月累加 */
export interface UsageStats {
    monthKey: string;
    costCny: number;
    calls: number;
    promptTokens: number;
    completionTokens: number;
}

/** AI 建议命中统计（全局累计，用来算采纳率） */
export interface AiStats {
    /** AI 给出建议（完成回复）的次数 */
    suggestions: number;
    /** 被采纳（用到正文 / 替换选中 / 点选项）的次数 */
    adopted: number;
}

/** 完整设置 */
export interface AppSettings {
    version: number;
    firstRunDone: boolean;
    provider: ProviderPreference;
    writing: WritingSettings;
    ui: UiSettings;
    ai: AiSettings;
    /** 技能商店 */
    skill: SkillSettings;
    budget: BudgetSettings;
    usage: UsageStats;
    /** AI 建议命中统计（采纳率） */
    aiStats: AiStats;
    /** 自定义价格表，覆盖内置默认值 */
    prices?: PriceRule[];
}

/**
 * 当前月份键，形如 2026-11
 * @returns 月份键
 */
function currentMonthKey(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * 默认设置
 * @returns 一份全新的设置对象
 */
export function defaultSettings(): AppSettings {
    return {
        version: 1,
        firstRunDone: false,
        provider: {
            id: 'deepseek',
            baseUrl: 'https://api.deepseek.com/v1',
            model: 'deepseek-chat',
            // 0 表示没填：按默认档带上下文，跟老版本行为一致
            contextWindow: 0,
        },
        writing: {
            chapterWordTarget: 3000,
            forbiddenWords: [],
            checklist: ['本章有没有推进主线', '主角有没有做选择', '章末有没有留钩子'],
            perspective: 'third',
        },
        ui: {
            rightPanelOpen: true,
            focusMode: false,
            fontSize: 17,
            autoSnapshot: true,
            snapshotKeep: 50,
            theme: 'mist',
            uiScale: 1.05,
            bodyFont: 'system',
        },
        ai: {
            novelStyleGuide: '',
            docsStyleGuide: '',
            notesStyleGuide: '',
            // 默认打开：这是"越用越像你"的基础，作者可以在设置里随时关掉
            preferenceLearn: true,
            preferenceInject: true,
            // 默认打开：不采样就永远攒不出自己的画像
            personalTraceLearn: true,
            // 默认打开：攒出来的画像只有注入才起作用
            personalTraceInject: true,
        },
        skill: {
            marketIndexUrl: '',
        },
        budget: {
            perChapterLimitCny: 1,
            monthlyLimitCny: 30,
        },
        usage: {
            monthKey: currentMonthKey(),
            costCny: 0,
            calls: 0,
            promptTokens: 0,
            completionTokens: 0,
        },
        aiStats: {
            suggestions: 0,
            adopted: 0,
        },
    };
}

/**
 * 合并 AI 指令设置
 * 老版本只有一个全局 styleGuide，自动迁移到小说那一栏
 * @param rawAi 读到的 ai 段
 * @param base 默认 ai 段
 * @returns 完整 ai 段
 */
function mergeAiSettings(rawAi: Partial<AiSettings> | undefined, base: AiSettings): AiSettings {
    const legacy = (rawAi as { styleGuide?: string } | undefined)?.styleGuide ?? '';
    return {
        novelStyleGuide: rawAi?.novelStyleGuide ?? legacy,
        docsStyleGuide: rawAi?.docsStyleGuide ?? base.docsStyleGuide,
        notesStyleGuide: rawAi?.notesStyleGuide ?? base.notesStyleGuide,
        preferenceLearn: rawAi?.preferenceLearn ?? base.preferenceLearn,
        preferenceInject: rawAi?.preferenceInject ?? base.preferenceInject,
        personalTraceLearn: rawAi?.personalTraceLearn ?? base.personalTraceLearn,
        personalTraceInject: rawAi?.personalTraceInject ?? base.personalTraceInject,
    };
}

/**
 * 把读到的设置和默认值合并
 * 逐层合并而不是整体替换，这样以后加字段老用户不会崩
 * @param raw 读到的原始对象
 * @returns 完整设置
 */
function mergeWithDefaults(raw: Partial<AppSettings>): AppSettings {
    const base = defaultSettings();
    return {
        ...base,
        ...raw,
        provider: { ...base.provider, ...(raw.provider ?? {}) },
        writing: { ...base.writing, ...(raw.writing ?? {}) },
        ui: { ...base.ui, ...(raw.ui ?? {}) },
        ai: mergeAiSettings(raw.ai, base.ai),
        skill: { ...base.skill, ...(raw.skill ?? {}) },
        budget: { ...base.budget, ...(raw.budget ?? {}) },
        usage: { ...base.usage, ...(raw.usage ?? {}) },
        aiStats: { ...base.aiStats, ...(raw.aiStats ?? {}) },
        prices: raw.prices ?? base.prices,
    };
}

/**
 * 读取设置，文件损坏时返回默认值并留日志
 * @returns 设置
 */
export function loadSettings(): AppSettings {
    const path = getSettingsPath();
    if (!existsSync(path)) {
        return defaultSettings();
    }
    try {
        const raw = JSON.parse(readFileSync(path, 'utf-8')) as Partial<AppSettings>;
        return mergeWithDefaults(raw);
    } catch (error) {
        logError('设置文件读取失败，已回退到默认设置', error);
        return defaultSettings();
    }
}

/**
 * 保存设置（整体覆盖，调用方传完整对象）
 * @param settings 设置
 */
export function saveSettings(settings: AppSettings): void {
    ensureRootDirs();
    writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 4), 'utf-8');
}

/**
 * 首次启动时落一份默认设置
 * 这样作者打开「文档/墨匠」就能看到设置文件，知道自己能改什么
 */
export function initSettingsFile(): void {
    ensureRootDirs();
    if (!existsSync(getSettingsPath())) {
        saveSettings(defaultSettings());
    }
}

/**
 * 局部更新设置
 * @param patch 只传要改的字段
 * @returns 更新后的完整设置
 */
export function updateSettings(patch: Partial<AppSettings>): AppSettings {
    const current = loadSettings();
    const next = mergeWithDefaults({ ...current, ...patch });
    // 跨月时重置用量，避免作者看到上个月的旧数字
    if (next.usage.monthKey !== currentMonthKey()) {
        next.usage = {
            monthKey: currentMonthKey(),
            costCny: 0,
            calls: 0,
            promptTokens: 0,
            completionTokens: 0,
        };
    }
    saveSettings(next);
    return next;
}

/**
 * 记一次调用用量
 * @param costCny 本次花费
 * @param promptTokens 输入 token
 * @param completionTokens 输出 token
 * @returns 更新后的设置
 */
export function recordUsage(costCny: number, promptTokens: number, completionTokens: number): AppSettings {
    const settings = loadSettings();
    const monthKey = currentMonthKey();
    const usage: UsageStats =
        settings.usage.monthKey === monthKey
            ? settings.usage
            : { monthKey, costCny: 0, calls: 0, promptTokens: 0, completionTokens: 0 };
    return updateSettings({
        usage: {
            monthKey,
            costCny: Math.round((usage.costCny + costCny) * 10000) / 10000,
            calls: usage.calls + 1,
            promptTokens: usage.promptTokens + promptTokens,
            completionTokens: usage.completionTokens + completionTokens,
        },
    });
}
