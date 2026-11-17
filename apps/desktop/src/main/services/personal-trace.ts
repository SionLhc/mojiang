/**
 * 我的笔感的落盘层
 *
 * 人味蒸馏（style-distill.ts）学的是别人怎么想，这里学的是作者自己怎么写。
 * 采样触发点是「保存正文」，不要求作者再做任何额外动作——
 * 自己的写法是长期写出来的，软件只负责在旁边看，看到就记一笔。
 *
 * 三条纪律：
 * 1. 只采增量：和上次保存一样的段落不重复计入
 * 2. 剔除 AI 原样段落：模型的话不是作者的笔迹
 * 3. 只存数字与章节标识，不保留任何正文
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
    attributeParagraphs,
    computePersonalTrace,
    mergeTraceByWeight,
    personalTracePromptBlock,
    personalTraceStage,
    pickStyleExcerpts,
    summarizeDrift,
    PERSONAL_TRACE_FORMING_CHARS,
    PERSONAL_TRACE_STABLE_CHARS,
    type HumanTrace,
    type PersonalDriftSummary,
    type PersonalTraceStage,
    type TraceSnapshot,
} from '@mojiang/core';
import { readChapter } from './content';
import { ensureRootDirs, getStyleDir } from './paths';
import { logError, logInfo } from './logger';
import { listPendingAiTexts } from './preference';

/** 档案文件名 */
const ARCHIVE_FILE = '我的笔感.json';

/** 最多记多少章：只用于展示"采过哪些章"，不参与统计 */
const MAX_CHAPTERS = 60;

/**
 * 最多记多少个段落指纹
 *
 * 指纹只用于判重，按先进先出丢最旧的：超出上限后极老段落有可能被重采一次，
 * 但那时它早已按字数摊薄，不影响画像。
 */
const MAX_KEYS = 4000;

/** 最多留多少个时间点快照 */
const MAX_HISTORY = 24;

/**
 * 攒够多少加权字才留一份画像快照
 *
 * 每存一次就留一份太密（一天能存几十次），间隔太大又看不出变化。
 * 五千字大约是两三章的量，正好一个"写作阶段"。
 */
const SNAPSHOT_STEP_CHARS = 5000;

/** 快照的最长间隔：写得太慢也不能一直不记，否则漂移永远比不出东西 */
const SNAPSHOT_MAX_GAP_MS = 30 * 24 * 60 * 60 * 1000;

/** 最多留多少份快照 */
const MAX_SNAPSHOTS = 12;

/** 拼提示词时最多回看几章原文当示范 */
const EXCERPT_CHAPTERS = 3;

/**
 * 拼好的提示块缓存的毫秒数
 *
 * 提示块要读章节文件，而每条消息都会取一次。
 * 档案没更新时没必要重读，但也不能永久缓存——作者改完稿要能马上生效。
 */
const PROMPT_CACHE_MS = 60 * 1000;

/** 近 7 天的毫秒数 */
const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** 采过样的一章 */
export interface PersonalTraceChapter {
    /** 书 id */
    bookId: string;
    /** 章节 id */
    chapterId: string;
    /** 这次采到的字数 */
    chars: number;
    /** 时间，ISO 字符串 */
    at: string;
}

/** 段落归属的累计计数 */
export interface PersonalTraceCounts {
    /** 你自己写的段落 */
    human: number;
    /** 你重写过的段落 */
    revised: number;
    /** AI 原样留着、被剔掉的段落 */
    ai: number;
}

/**
 * 参照旧写法：作者指定的"回到从前"
 *
 * 整份画像连内容一起钉在档案里，不只记时间。
 * 因为快照上限 12 份会滚动淘汰，只存时间戳的话，
 * 几个月后那份快照被挤掉，参照就悄悄失效了——这种静默失效最难查。
 */
export interface PersonalTraceAnchor {
    /** 那份快照的时间 */
    at: string;
    /** 当时累计的加权字数 */
    effectiveChars: number;
    /** 当时的完整画像 */
    trace: HumanTrace;
    /** 什么时候设的参照 */
    pickedAt: string;
}

/** 落盘结构 */
export interface PersonalTraceFile {
    /** 结构版本 */
    version: 1;
    /** 最后更新时间 */
    updatedAt: string;
    /** 累计真实字数 */
    charCount: number;
    /** 累计加权字数：成熟度与合并权重都按这个算 */
    effectiveChars: number;
    /** 累计画像；还没有数据时各项为 0 */
    trace: HumanTrace;
    /** 参照的旧写法；没设参照时为 null */
    anchor: PersonalTraceAnchor | null;
    /** 最近采过样的章节 */
    chapters: PersonalTraceChapter[];
    /** 采过的段落指纹，用来判重（不含任何原文） */
    keys: string[];
    /** 人味分的时间点记录，面板折线用 */
    history: Array<{ at: string; humanScore: number; effectiveChars: number }>;
    /**
     * 完整画像快照
     *
     * 只留人味分看不出"变在哪"（短句变多了还是收尾变少了都算同一分），
     * 所以每隔一段字数留一份完整指标，用来比首尾。
     */
    snapshots: TraceSnapshot[];
    /** 段落归属累计 */
    counts: PersonalTraceCounts;
}

/** 拼给模型的提示块 */
export interface PersonalPromptResult {
    /** 成熟度 */
    stage: PersonalTraceStage;
    /** 提示块；还在收集阶段时是空串 */
    block: string;
    /** 用了几段作者原文当示范 */
    excerptCount: number;
}

/** 设置页要的概览 */
export interface PersonalTraceOverview {
    /** 累计字数 */
    charCount: number;
    /** 累计加权字数 */
    effectiveChars: number;
    /** 人味分（越高说明越像人自己写的） */
    humanScore: number;
    /** 成熟度 */
    stage: PersonalTraceStage;
    /** 距成型还差多少字 */
    toForming: number;
    /** 距稳定还差多少字 */
    toStable: number;
    /** 最后更新时间 */
    updatedAt: string;
    /** 采过多少章 */
    chapterCount: number;
    /** 近 7 天采到的字数 */
    recentChars: number;
    /** 段落归属累计 */
    counts: PersonalTraceCounts;
    /** 画像指标；没有任何数据时为 null */
    trace: HumanTrace | null;
    /** 人味分折线的点，按时间升序 */
    points: Array<{ at: string; humanScore: number; effectiveChars: number }>;
    /** 写法漂移总结；够两份快照且真有变化时才有 */
    drift: PersonalDriftSummary | null;
    /** 当前会不会注入（收集阶段不注入） */
    injecting: boolean;
    /** 可以选作参照的历史快照，按时间升序 */
    snapshots: Array<{ at: string; effectiveChars: number; humanScore: number }>;
    /** 当前参照的旧写法时间；没设参照时为 null */
    anchorAt: string | null;
}

/**
 * 空画像
 * @returns 初始结构
 */
function emptyPersonalTrace(): PersonalTraceFile {
    return {
        version: 1,
        updatedAt: '',
        charCount: 0,
        effectiveChars: 0,
        trace: mergeTraceByWeight([]),
        anchor: null,
        chapters: [],
        keys: [],
        history: [],
        snapshots: [],
        counts: { human: 0, revised: 0, ai: 0 },
    };
}

/**
 * 档案路径
 * @returns 绝对路径
 */
function archivePath(): string {
    return join(getStyleDir(), ARCHIVE_FILE);
}

/**
 * 取一个有限非负数，读档案时用
 * @param value 待检查值
 * @returns 合法的数字，否则 0
 */
function toNumber(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * 读档案；文件不存在或读坏了都当空档案
 * 这是作者可以手改的文件，不能假设格式正确
 * @returns 档案
 */
export function readPersonalTrace(): PersonalTraceFile {
    const empty = emptyPersonalTrace();
    try {
        if (!existsSync(archivePath())) {
            return empty;
        }
        const raw = JSON.parse(readFileSync(archivePath(), 'utf-8')) as Record<string, unknown>;
        const trace =
            raw.trace && typeof raw.trace === 'object'
                ? (raw.trace as HumanTrace)
                : empty.trace;
        const chapters = Array.isArray(raw.chapters)
            ? (raw.chapters as PersonalTraceChapter[])
                  .filter(
                      (item) =>
                          typeof item?.bookId === 'string' &&
                          typeof item?.chapterId === 'string',
                  )
                  .slice(0, MAX_CHAPTERS)
            : [];
        const history = Array.isArray(raw.history)
            ? (raw.history as Array<{ at: string; humanScore: number; effectiveChars: number }>)
                  .filter((item) => typeof item?.at === 'string')
                  .slice(-MAX_HISTORY)
            : [];
        const counts = (raw.counts ?? {}) as Record<string, unknown>;
        const keys = Array.isArray(raw.keys)
            ? (raw.keys as string[]).filter((item) => typeof item === 'string').slice(-MAX_KEYS)
            : [];
        // 老档案没有快照字段，读成空数组即可，下次采样会重新开始攒
        const snapshots = Array.isArray(raw.snapshots)
            ? (raw.snapshots as TraceSnapshot[])
                  .filter((item) => typeof item?.at === 'string' && item.trace)
                  .slice(-MAX_SNAPSHOTS)
            : [];
        // 作者可以手改这个文件，参照里的画像缺字段就整条丢掉，
        // 宁可退回"按现在的写法"，也不要拿半份画像去拼规则
        const rawAnchor = raw.anchor as Partial<PersonalTraceAnchor> | null | undefined;
        const anchor: PersonalTraceAnchor | null =
            rawAnchor &&
            typeof rawAnchor.at === 'string' &&
            rawAnchor.trace &&
            typeof rawAnchor.trace === 'object'
                ? {
                      at: rawAnchor.at,
                      effectiveChars: toNumber(rawAnchor.effectiveChars),
                      trace: rawAnchor.trace as HumanTrace,
                      pickedAt: typeof rawAnchor.pickedAt === 'string' ? rawAnchor.pickedAt : '',
                  }
                : null;
        return {
            version: 1,
            updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
            charCount: toNumber(raw.charCount),
            effectiveChars: toNumber(raw.effectiveChars),
            trace,
            anchor,
            chapters,
            keys,
            history,
            snapshots,
            counts: {
                human: toNumber(counts.human),
                revised: toNumber(counts.revised),
                ai: toNumber(counts.ai),
            },
        };
    } catch (error) {
        logError('我的笔感读取失败，当作空画像继续', error);
        return empty;
    }
}

/**
 * 写档案
 * @param file 档案
 */
function writePersonalTrace(file: PersonalTraceFile): void {
    try {
        ensureRootDirs();
        const dir = getStyleDir();
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
        writeFileSync(archivePath(), JSON.stringify(file, null, 4), 'utf-8');
    } catch (error) {
        // 画像只是留档，写不了不能让作者保存正文失败
        logError('我的笔感写入失败', error);
    }
}

/**
 * 合并一次采样进画像
 *
 * 用"老画像 + 新采样"的加权平均递推，和把所有样本一次性加权平均是等价的，
 * 这样档案不用越存越大。
 * @param file 现有档案
 * @param sample 本次采样
 * @returns 新档案
 */
function mergeSample(
    file: PersonalTraceFile,
    sample: NonNullable<ReturnType<typeof computePersonalTrace>>,
    bookId: string,
    chapterId: string,
): PersonalTraceFile {
    const at = new Date().toISOString();
    const trace =
        file.effectiveChars > 0
            ? mergeTraceByWeight([
                  { weight: file.effectiveChars, trace: file.trace },
                  { weight: sample.effectiveChars, trace: sample.trace },
              ])
            : sample.trace;

    const chapters = file.chapters.filter(
        (item) => !(item.bookId === bookId && item.chapterId === chapterId),
    );
    chapters.unshift({ bookId, chapterId, chars: sample.charCount, at });

    const effectiveChars = file.effectiveChars + sample.effectiveChars;
    // 每次采样都留一个时间点太密，只在人味分明显变动时记，方便日后看写法漂移
    const lastScore = file.history.length > 0
        ? file.history[file.history.length - 1].humanScore
        : null;
    const shouldMark = lastScore === null || Math.abs(trace.humanScore - lastScore) >= 3;
    const history = shouldMark
        ? [...file.history, { at, humanScore: trace.humanScore, effectiveChars }].slice(
              -MAX_HISTORY,
          )
        : file.history;

    // 字数跨过台阶、或者隔得太久，就留一份完整画像，日后才好比"变在哪"
    const lastSnapshot = file.snapshots[file.snapshots.length - 1];
    const lastSnapshotAt = lastSnapshot ? Date.parse(lastSnapshot.at) : Number.NaN;
    const grewEnough =
        !lastSnapshot || effectiveChars - lastSnapshot.effectiveChars >= SNAPSHOT_STEP_CHARS;
    const waitedEnough =
        Number.isFinite(lastSnapshotAt) && Date.now() - lastSnapshotAt >= SNAPSHOT_MAX_GAP_MS;
    const snapshots =
        grewEnough || waitedEnough
            ? [...file.snapshots, { at, effectiveChars, trace }].slice(-MAX_SNAPSHOTS)
            : file.snapshots;

    return {
        ...file,
        updatedAt: at,
        charCount: file.charCount + sample.charCount,
        effectiveChars,
        trace,
        chapters: chapters.slice(0, MAX_CHAPTERS),
        history,
        snapshots,
        counts: {
            human: file.counts.human + sample.humanParagraphs,
            revised: file.counts.revised + sample.revisedParagraphs,
            ai: file.counts.ai + sample.aiParagraphs,
        },
    };
}

/**
 * 保存正文时采一次样
 *
 * 顺序很重要：必须在偏好蒸馏对齐之前调用，那时候"这一章 AI 写过什么"还在。
 * @param input 采样输入
 * @returns 本次计入画像的加权字数，0 表示这次没有可用增量
 */
export function samplePersonalTrace(input: {
    /** 书 id */
    bookId: string;
    /** 章节 id */
    chapterId: string;
    /** 本次保存的正文 */
    finalText: string;
}): number {
    try {
        const file = readPersonalTrace();
        const aiTexts = listPendingAiTexts(input.bookId, input.chapterId);
        const attributed = attributeParagraphs({
            finalText: input.finalText,
            aiTexts,
            knownKeys: file.keys,
        });
        if (attributed.length === 0) {
            return 0;
        }

        // 指纹先记账：全是被剔掉的 AI 段落时也要留住"剔过"这件事，
        // 否则这些段落下次会被当成手写
        const withKeys: PersonalTraceFile = {
            ...file,
            keys: [...file.keys, ...attributed.map((item) => item.key)].slice(-MAX_KEYS),
        };
        const sample = computePersonalTrace(attributed);

        if (!sample) {
            // 没有可用痕迹，但归属计数照样要记，否则面板看不出"剔了多少"
            writePersonalTrace({
                ...withKeys,
                counts: {
                    human:
                        file.counts.human +
                        attributed.filter((item) => item.origin === 'human').length,
                    revised:
                        file.counts.revised +
                        attributed.filter((item) => item.origin === 'revised').length,
                    ai:
                        file.counts.ai +
                        attributed.filter((item) => item.origin === 'ai').length,
                },
            });
            return 0;
        }

        // 计数交给 mergeSample 统一加，这里不能提前加一遍，否则会翻倍
        const next = mergeSample(withKeys, sample, input.bookId, input.chapterId);
        writePersonalTrace(next);
        logInfo('我的笔感采到新样本', {
            bookId: input.bookId,
            chapterId: input.chapterId,
            human: sample.humanParagraphs,
            revised: sample.revisedParagraphs,
            ai: sample.aiParagraphs,
            chars: sample.charCount,
        });
        return sample.effectiveChars;
    } catch (error) {
        logError('我的笔感采样失败', error);
        return 0;
    }
}

/**
 * 看画像攒到什么程度了
 * @returns 概览；还没有任何数据时返回 null
 */
export function personalTraceOverview(): PersonalTraceOverview | null {
    const file = readPersonalTrace();
    if (file.effectiveChars <= 0) {
        return null;
    }
    const stage = personalTraceStage(file.effectiveChars);
    const now = Date.now();
    const recentChars = file.chapters
        .filter((item) => {
            const at = Date.parse(item.at);
            return Number.isFinite(at) && now - at <= RECENT_WINDOW_MS;
        })
        .reduce((sum, item) => sum + item.chars, 0);

    return {
        charCount: file.charCount,
        effectiveChars: file.effectiveChars,
        humanScore: file.trace.humanScore,
        stage,
        toForming: Math.max(0, PERSONAL_TRACE_FORMING_CHARS - file.effectiveChars),
        toStable: Math.max(0, PERSONAL_TRACE_STABLE_CHARS - file.effectiveChars),
        updatedAt: file.updatedAt,
        chapterCount: file.chapters.length,
        recentChars,
        counts: file.counts,
        trace: file.trace,
        // 折线优先用完整快照：那才是"每隔一段字数的一个点"，不会被密集保存挤成一堆
        points:
            file.snapshots.length >= 2
                ? file.snapshots.map((item) => ({
                      at: item.at,
                      humanScore: item.trace.humanScore,
                      effectiveChars: item.effectiveChars,
                  }))
                : file.history.map((item) => ({ ...item })),
        drift: summarizeDrift(file.snapshots),
        // 设了参照就是作者亲手开的闸门：哪怕现在还是收集阶段，也照样注入
        injecting: file.anchor !== null || stage !== 'collecting',
        snapshots: file.snapshots.map((item) => ({
            at: item.at,
            effectiveChars: item.effectiveChars,
            humanScore: item.trace.humanScore,
        })),
        anchorAt: file.anchor?.at ?? null,
    };
}

/**
 * 设/取消"回到从前的自己"
 *
 * 这里把当时那份画像整份抄进 anchor，之后快照怎么滚动都不影响它生效。
 * @param at 快照时间，传 null 表示取消参照
 * @returns 最新概览
 */
export function setPersonalTraceAnchor(at: string | null): PersonalTraceOverview | null {
    const file = readPersonalTrace();
    if (at === null) {
        writePersonalTrace({ ...file, anchor: null });
        promptCache = null;
        return personalTraceOverview();
    }

    const snapshot = file.snapshots.find((item) => item.at === at);
    if (!snapshot) {
        throw new Error('这个时间点的画像已经不在了，换一个试试');
    }
    // 收集阶段的画像本身就不可靠，拿来当参照等于把噪声当风格
    if (personalTraceStage(snapshot.effectiveChars) === 'collecting') {
        throw new Error('那时还没攒够一万字，画不出能用的写法');
    }

    writePersonalTrace({
        ...file,
        anchor: {
            at: snapshot.at,
            effectiveChars: snapshot.effectiveChars,
            trace: snapshot.trace,
            pickedAt: new Date().toISOString(),
        },
    });
    promptCache = null;
    logInfo('我的笔感已设参照', { at: snapshot.at, chars: snapshot.effectiveChars });
    return personalTraceOverview();
}

/** 提示块缓存：档案没动就不重复读章节文件 */
let promptCache: { key: string; value: PersonalPromptResult; at: number } | null = null;

/**
 * 从最近几章里捞作者自己写的原文当示范
 *
 * 只回看最近三章：早期的稿子可能已经被作者自己否定了，
 * 拿它当"你写的样子"会把旧习惯固化下来。
 * 章节只记 id 不记区，因为采样只发生在正文（zhengwen）保存时。
 * @param chapters 采过样的章节，最近的在前
 * @returns 原文片段，可能为空
 */
async function collectExcerpts(chapters: PersonalTraceChapter[]): Promise<string[]> {
    const sources: Array<{ name: string; text: string }> = [];
    for (const chapter of chapters.slice(0, EXCERPT_CHAPTERS)) {
        try {
            const text = await readChapter(chapter.bookId, 'zhengwen', chapter.chapterId);
            if (text.trim().length > 0) {
                sources.push({ name: `${chapter.bookId}/${chapter.chapterId}`, text });
            }
        } catch (error) {
            // 书被删了、章节被改名了都很正常，跳过就行
            logInfo('我的笔感取示范片段失败，跳过', {
                bookId: chapter.bookId,
                chapterId: chapter.chapterId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    return pickStyleExcerpts(sources, 1).map((item) => item.body);
}

/**
 * 取当前该注入的提示块
 *
 * 还在收集阶段就返回空串：画像没成型时注入等于把噪声当风格。
 * @returns 成熟度、提示块与示范段数
 */
export async function personalTracePrompt(): Promise<PersonalPromptResult> {
    const file = readPersonalTrace();
    // 设了参照就改用参照那份画像：这是作者手动指定的写法，优先于当前画像
    const anchor = file.anchor;
    const baseTrace = anchor ? anchor.trace : file.trace;
    const baseChars = anchor ? anchor.effectiveChars : file.effectiveChars;
    const stage = personalTraceStage(baseChars);
    if (stage === 'collecting' || baseChars <= 0) {
        return { stage, block: '', excerptCount: 0 };
    }

    // 档案没更新且缓存没过期，直接用上次拼好的；参照换了也必须重拼
    const key = `${file.updatedAt}|${stage}|${baseChars}|${anchor?.at ?? ''}`;
    if (promptCache && promptCache.key === key && Date.now() - promptCache.at <= PROMPT_CACHE_MS) {
        return promptCache.value;
    }

    try {
        // 参照旧写法时不取原文：手边只有当下的章节，那不等于从前的手感
        const excerpts =
            !anchor && stage === 'stable' ? await collectExcerpts(file.chapters) : [];
        const block = personalTracePromptBlock({
            trace: baseTrace,
            stage,
            excerpts,
            anchorAt: anchor?.at,
        });
        const value: PersonalPromptResult = {
            stage,
            block,
            excerptCount: excerpts.length,
        };
        promptCache = { key, value, at: Date.now() };
        return value;
    } catch (error) {
        logError('我的笔感拼提示词失败', error);
        return { stage, block: '', excerptCount: 0 };
    }
}

/**
 * 清空画像
 *
 * 作者写久了想重新开始、或者换了写法，需要一个干净的起点。
 */
export function clearPersonalTrace(): void {
    writePersonalTrace(emptyPersonalTrace());
    // 清空后缓存必须一起丢掉，否则下一次对话还会注入旧画像
    promptCache = null;
}
