/**
 * 人味蒸馏的落盘层
 *
 * 三件事：
 * 1. 读用户选的书籍文件（txt/md），解码成文本
 * 2. 每本书单独算一遍「思路痕迹」，交给 core 的纯逻辑
 * 3. 把痕迹累积进同一份「人味档案」，再生成/更新那一份技能
 *
 * 为什么只有一份技能：我们要的是「人怎么想」，不是「某个作者怎么写」。
 * 一位作者一个技能会让作者被样本绑架，而且技能栏会越堆越乱。
 * 所以固定 id，重复蒸馏等于"更新基线"，样本越积越准。
 *
 * 刻意不存原文：档案里只有数字和书名截图，避免把别人的正文散落到各处。
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { readFile } from 'fs/promises';
import { basename, extname, join } from 'path';
import {
    analyzeStyle,
    buildHumanTraceSkill,
    cleanStyleText,
    countCharacters,
    HUMAN_TRACE_SKILL_ID,
    mergeTraceByWeight,
    pickStyleExcerpts,
    type HumanTrace,
    type Skill,
    type StyleMetrics,
    type StyleSource,
} from '@mojiang/core';
import { commitSkill, listSkills } from './skill-store';
import { decodeText } from './import';
import { ensureRootDirs, getStyleDir } from './paths';
import { logError, logInfo } from './logger';

/** 允许的素材扩展名：只吃纯文本，docx/pdf 先让用户另存 */
const ALLOWED_EXTENSIONS = ['.txt', '.md'];

/** 单本大小上限：20MB 已经远超一本千万字小说，再大就是选错文件了 */
const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** 本次最少总字数：太少统计不出节奏，硬算出来的基线会误导模型 */
const MIN_TOTAL_CHARS = 5000;

/** 一次最多几本：多了没必要，统计早就稳定了 */
const MAX_FILES = 8;

/** 档案里最多留几本：再多收益很小，读档案也会变慢 */
const MAX_SAMPLES = 12;

/** 档案文件名 */
const ARCHIVE_FILE = '人味档案.json';

/** 一个素材文件的概要，用于在界面上列出来 */
export interface StyleFileInfo {
    /** 绝对路径 */
    path: string;
    /** 文件名 */
    name: string;
    /** 正文字数（已剔除章节标题） */
    chars: number;
}

/** 蒸馏请求 */
export interface StyleDistillRequest {
    /** 素材文件绝对路径 */
    files: string[];
}

/** 档案里的一本书：只有数字，没有正文 */
export interface TraceSample {
    /** 文件名 */
    name: string;
    /** 正文字数 */
    chars: number;
    /** 这本书的思路痕迹 */
    trace: HumanTrace;
}

/** 人味档案：累积多本，全局只有一份 */
export interface TraceArchive {
    /** 档案格式版本，方便日后迁移 */
    version: number;
    /** 最后更新时间（ISO） */
    updatedAt: string;
    /** 参考过的书 */
    samples: TraceSample[];
}

/** 蒸馏结果 */
export interface StyleDistillResult {
    /** 生成并已安装（或更新）的技能 */
    skill: Skill;
    /** 本次素材的风格参考值 + 合并后的思路痕迹 */
    metrics: StyleMetrics;
    /** 累积参考过的全部素材 */
    sources: Array<{ name: string; chars: number }>;
    /** 本次新增或更新的书名 */
    added: string[];
    /** 累积下来的人味分 0-100 */
    humanScore: number;
}

/** 已经攒了多少样本，用于弹窗打开时告知用户 */
export interface HumanTraceOverview {
    /** 参考书目数量 */
    sourceCount: number;
    /** 累计字数 */
    charCount: number;
    /** 人味分 */
    humanScore: number;
    /** 最后更新时间 */
    updatedAt: string;
    /** 书目名 */
    names: string[];
}

/**
 * 校验一个素材路径
 * @param filePath 路径
 * @returns 规范化后的路径
 */
function assertStyleFile(filePath: string): string {
    if (!existsSync(filePath)) {
        throw new Error(`文件不存在：${basename(filePath)}，可能被移动了`);
    }
    const extension = extname(filePath).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(extension)) {
        throw new Error(`「${basename(filePath)}」不是 txt 或 md，先用别的编辑器另存为文本`);
    }
    const size = statSync(filePath).size;
    if (size > MAX_FILE_BYTES) {
        throw new Error(`「${basename(filePath)}」超过 20MB，确认一下是不是选错了`);
    }
    return filePath;
}

/**
 * 读一本素材，只留正文
 * @param filePath 路径
 * @returns 素材内容与字数
 */
async function readStyleFile(filePath: string): Promise<{ source: StyleSource; chars: number }> {
    const buffer = await readFile(filePath);
    const text = cleanStyleText(decodeText(buffer));
    return {
        source: { name: basename(filePath), text },
        chars: countCharacters(text),
    };
}

/**
 * 读一批素材文件的概要（选完文件就能看到每本多少字）
 * @param files 路径列表
 * @returns 概要列表；读不了的会带 chars: 0
 */
export async function inspectStyleFiles(files: string[]): Promise<StyleFileInfo[]> {
    const result: StyleFileInfo[] = [];
    for (const filePath of files) {
        try {
            const { chars } = await readStyleFile(assertStyleFile(filePath));
            result.push({ path: filePath, name: basename(filePath), chars });
        } catch (error) {
            logError('读取素材失败', error);
            result.push({ path: filePath, name: basename(filePath), chars: 0 });
        }
    }
    return result;
}

/**
 * 判断一条记录是不是合法样本
 * 档案是用户可以手改的文件，读的时候不能假设格式正确
 * @param raw 待检查值
 * @returns 是否合法
 */
function isTraceSample(raw: unknown): raw is TraceSample {
    if (!raw || typeof raw !== 'object') {
        return false;
    }
    const record = raw as Record<string, unknown>;
    if (typeof record.name !== 'string' || typeof record.chars !== 'number') {
        return false;
    }
    const trace = record.trace;
    if (!trace || typeof trace !== 'object') {
        return false;
    }
    return typeof (trace as Record<string, unknown>).humanScore === 'number';
}

/**
 * 读档案；文件不存在或坏了都当成空档案，不让蒸馏因此失败
 * @returns 档案
 */
export function readTraceArchive(): TraceArchive {
    const empty: TraceArchive = { version: 1, updatedAt: '', samples: [] };
    try {
        ensureRootDirs();
        const file = join(getStyleDir(), ARCHIVE_FILE);
        if (!existsSync(file)) {
            return empty;
        }
        const raw = JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>;
        if (!Array.isArray(raw.samples)) {
            return empty;
        }
        return {
            version: 1,
            updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
            samples: raw.samples.filter(isTraceSample).slice(-MAX_SAMPLES),
        };
    } catch (error) {
        logError('人味档案读取失败，当作空档案继续', error);
        return empty;
    }
}

/**
 * 写档案
 * @param archive 档案
 */
function writeTraceArchive(archive: TraceArchive): void {
    try {
        ensureRootDirs();
        const dir = getStyleDir();
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
        writeFileSync(join(dir, ARCHIVE_FILE), JSON.stringify(archive, null, 4), 'utf-8');
    } catch (error) {
        // 档案只是留档，写不了不影响技能已经更新这件事
        logError('人味档案写入失败', error);
    }
}

/**
 * 把多本书的痕迹合并成一份
 *
 * 为什么按字数加权：一本 50 万字的书比一本 2 万字的中篇更能代表"人怎么想"，
 * 等权平均会被小样本带偏。加权逻辑本身在 core，这里只负责把样本转成权重。
 * @param samples 样本
 * @returns 合并后的痕迹
 */
export function mergeTraceSamples(samples: TraceSample[]): HumanTrace {
    return mergeTraceByWeight(
        samples.map((sample) => ({ weight: sample.trace.charCount, trace: sample.trace })),
    );
}

/**
 * 看现在攒了多少样本
 * @returns 概要；还没蒸馏过返回 null
 */
export function humanTraceOverview(): HumanTraceOverview | null {
    const archive = readTraceArchive();
    if (archive.samples.length === 0) {
        return null;
    }
    const merged = mergeTraceSamples(archive.samples);
    return {
        sourceCount: archive.samples.length,
        charCount: merged.charCount,
        humanScore: merged.humanScore,
        updatedAt: archive.updatedAt,
        names: archive.samples.map((item) => item.name),
    };
}

/**
 * 跑一次蒸馏：更新人味基线
 * 纯本地统计，不调用模型，所以不花钱也不联网
 * @param request 请求
 * @returns 结果
 */
export async function distillStyle(request: StyleDistillRequest): Promise<StyleDistillResult> {
    const files = [...new Set(request.files)].slice(0, MAX_FILES).map(assertStyleFile);
    if (files.length === 0) {
        throw new Error('至少选一本书');
    }

    const sources: StyleSource[] = [];
    const freshSamples: TraceSample[] = [];
    const added: string[] = [];
    let freshChars = 0;

    for (const filePath of files) {
        const { source, chars } = await readStyleFile(filePath);
        if (chars < 500) {
            logInfo('素材太短，已跳过', { file: source.name, chars });
            continue;
        }
        sources.push(source);
        // 每本书单独算痕迹：合并时才好按字数加权，也方便日后单独剔除一本
        freshSamples.push({ name: source.name, chars, trace: analyzeStyle([source]).trace });
        added.push(source.name);
        freshChars += chars;
    }

    if (sources.length === 0) {
        throw new Error('选的文件里没有可用正文，检查一下是不是目录页或空文件');
    }
    if (freshChars < MIN_TOTAL_CHARS) {
        throw new Error(`正文只有 ${freshChars} 字，至少要 ${MIN_TOTAL_CHARS} 字才统计得出痕迹`);
    }

    // 同名文件视为"重新上传"，替换旧记录而不是再加一本
    const archive = readTraceArchive();
    const kept = archive.samples.filter((item) => !added.includes(item.name));
    const samples = [...kept, ...freshSamples].slice(-MAX_SAMPLES);
    const merged = mergeTraceSamples(samples);

    const base = analyzeStyle(sources);
    const metrics: StyleMetrics = { ...base, trace: merged };
    const skill = buildHumanTraceSkill({
        metrics,
        excerpts: pickStyleExcerpts(sources),
        sourceCount: samples.length,
        charCount: merged.charCount,
    });

    // 本次只带一两本时，别把之前攒下来的示范段冲掉
    const previous = listSkills().find((item) => item.id === HUMAN_TRACE_SKILL_ID);
    if (skill.examples.length < 3 && previous && previous.examples.length > 0) {
        skill.examples = previous.examples;
    }
    const installed = commitSkill(skill);

    writeTraceArchive({ version: 1, updatedAt: new Date().toISOString(), samples });
    logInfo('人味基线已更新', {
        books: samples.length,
        fresh: added.length,
        chars: merged.charCount,
        humanScore: merged.humanScore,
    });

    return {
        skill: installed.skill,
        metrics,
        sources: samples.map((item) => ({ name: item.name, chars: item.chars })),
        added,
        humanScore: merged.humanScore,
    };
}
