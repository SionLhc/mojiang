/**
 * AI 对话：解析回复里的选项块 + 按项目类型取系统提示
 *
 * 约定格式（系统提示里让模型照这个输出）：
 * 【选项】
 * 1. 方案一
 * 2. 方案二
 *
 * 解析后正文和选项分开：正文照常显示，选项渲染成可点按钮。
 */

import type { ProjectKind } from './project';

/** 选项解析结果 */
export interface ChatOptionsParse {
    /** 去掉选项块后的正文 */
    body: string;
    /** 选项列表；没有选项块时为空数组 */
    options: string[];
}

/** 选项块标记：【选项】或行首 1-3 级标题「选项」 */
const OPTION_MARKER_PATTERN = /【选项】|^#{1,3}\s*选项\s*$/m;

/** 编号或短横线列表行：`1. xxx`、`1、xxx`、`- xxx`、`· xxx` */
const OPTION_LINE_PATTERN = /^(?:\d+[.、．]|[-*·])\s*(.+)$/;

/**
 * 解析 AI 回复里的选项块
 * 找不到标记或标记后没有列表行时，整段原样返回，不当选项处理
 * @param text AI 回复全文
 * @returns 正文与选项
 */
export function parseChatOptions(text: string): ChatOptionsParse {
    const marker = text.search(OPTION_MARKER_PATTERN);
    if (marker < 0) {
        return { body: text, options: [] };
    }

    const head = text.slice(0, marker);
    const tail = text.slice(marker).replace(OPTION_MARKER_PATTERN, '');
    const options: string[] = [];
    for (const rawLine of tail.split('\n')) {
        const line = rawLine.trim();
        if (line.length === 0) {
            continue;
        }
        const matched = line.match(OPTION_LINE_PATTERN);
        if (matched) {
            options.push(matched[1].trim());
        }
    }
    // 有标记但没有可识别的列表行，说明模型没按格式来，整段当正文
    if (options.length === 0) {
        return { body: text, options: [] };
    }
    return { body: head.trimEnd(), options };
}

/** 大纲里的一章 */
export interface OutlineChapter {
    /** 章节标题，只保留「第X章 标题」部分（冒号前的） */
    title: string;
    /** 标题冒号后的一句话剧情，进细纲「本章要点」 */
    summary: string;
    /** 标题下其他大纲内容（标题到下一个标题之间） */
    content: string;
}

/** 单行超过这个长度就不当章节标题（标题不会是长句） */
const MAX_OUTLINE_TITLE_LENGTH = 60;

/** 中文/英文章节行：第一章 xxx、第 12 回、Chapter 3 */
const OUTLINE_CHAPTER_LINE =
    /^(?:第\s*[0-9零一二三四五六七八九十百千两]{1,6}\s*[章节回卷]|chapter\s+\d{1,4})[\s、.:：]*(.*)$/i;

/**
 * 判断一行是不是章节标题
 * 认「第X章/章/回/卷」「Chapter N」和 Markdown 一到三级标题
 * @param line 单行文本
 * @returns 标题文本，不是标题返回 null
 */
function matchOutlineTitle(line: string): string | null {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_OUTLINE_TITLE_LENGTH) {
        return null;
    }
    const md = trimmed.match(/^#{1,3}\s+(.+?)\s*#*$/);
    if (md) {
        return md[1].trim();
    }
    if (OUTLINE_CHAPTER_LINE.test(trimmed)) {
        // 章节行整行当标题，保留「第一章 开端」的原样
        return trimmed;
    }
    return null;
}

/**
 * 把标题行拆成「标题」和「一句话剧情」
 * 「第一章 废料场：陆昭翻找星轨残片」→ 标题「第一章 废料场」、要点「陆昭翻找星轨残片」
 * @param raw 标题原始行
 * @returns 拆好的标题与要点
 */
function splitHeading(raw: string): { title: string; summary: string } {
    const trimmed = raw.trim();
    const matched = trimmed.match(/[：:]/);
    if (!matched || matched.index === undefined) {
        return { title: trimmed, summary: '' };
    }
    return {
        title: trimmed.slice(0, matched.index).trim(),
        summary: trimmed.slice(matched.index + 1).trim(),
    };
}

/**
 * 把 AI 输出的大纲解析成章节列表
 * 用于「生成章节和细纲」：正文建骨架、细纲写大纲，作者不用复制
 * 标题行之外、第一个标题之前的内容会被丢弃（通常是书名或说明）
 * @param text AI 回复全文
 * @returns 章节列表，解析不出返回空数组
 */
export function parseOutlineChapters(text: string): OutlineChapter[] {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const chapters: OutlineChapter[] = [];
    let currentTitle = '';
    let currentSummary = '';
    let buffer: string[] = [];

    const flush = (): void => {
        if (currentTitle.length === 0) {
            buffer = [];
            return;
        }
        chapters.push({
            title: currentTitle,
            summary: currentSummary,
            content: buffer.join('\n').trim(),
        });
        buffer = [];
    };

    for (const line of lines) {
        const heading = matchOutlineTitle(line);
        if (heading !== null) {
            flush();
            const parts = splitHeading(heading);
            currentTitle = parts.title;
            currentSummary = parts.summary;
            continue;
        }
        if (currentTitle.length > 0) {
            buffer.push(line);
        }
    }
    flush();
    return chapters;
}

/** 选项块约定，三类项目共用（前端靠它渲染可点按钮） */
const OPTION_RULE = [
    '需要作者做选择时，在回复最后单独加一个选项块，格式严格如下：',
    '【选项】',
    '1. 具体方案一',
    '2. 具体方案二',
    '选项块每次 2-4 个，只在真的要作者选时才加；其他时候不要出现这个块。',
].join('\n');

/** 小说项目的系统提示：网文写法 + 作者主导 */
const NOVEL_PROMPT = [
    '你是「墨匠」里的中文网文写作助手。作者主导，你只负责按指令写和改。',
    '硬规则：',
    '1. 不替作者决定剧情走向，需要决定时给选项让作者选，不要自作主张。',
    '2. 续写时紧贴给出的正文，句长和用词习惯要接得上，不要突然变文风。',
    '3. 不写章末总结升华，不直接报情绪名（例如"他很愤怒"），用动作和细节写。',
    '4. 不编造上下文里没有的设定、人物和伏笔。缺信息就直接问。',
    '5. 输出正文时不要加解释、不要加"以下是"之类的开场。',
    OPTION_RULE,
].join('\n');

/** 工作文档项目的系统提示：技术文档/方案规划，重结构和准确 */
const DOCS_PROMPT = [
    '你是「墨匠」里的工作文档助手，擅长技术文档、方案规划、周报总结这类内容。作者主导，你只负责按指令写和改。',
    '硬规则：',
    '1. 保持原文的术语、编号和结构，不要改写成小说腔或口语腔。',
    '2. 输出用 Markdown：标题层级、清单、表格、代码块按内容来，结构清楚。',
    '3. 结论先行；数字、配置、版本号要准确，不要含糊。',
    '4. 不编造原文没有的技术细节和数据。缺信息先问，不要自己补。',
    '5. 输出正文时不要加解释、不要加"以下是"之类的开场。',
    OPTION_RULE,
].join('\n');

/** 笔记项目的系统提示：提炼归纳，不扩写 */
const NOTES_PROMPT = [
    '你是「墨匠」里的笔记助手，帮作者整理笔记、提炼要点、归档信息。作者主导，你只负责按指令整理。',
    '硬规则：',
    '1. 原样保留作者的信息，不添油加醋，不扩写成文章。',
    '2. 提炼要点用短清单；待办和行动项单独列出来。',
    '3. 归并和去重可以做，但要删掉任何原始信息前先问。',
    '4. 输出用 Markdown，短而清楚，不要空话套话。',
    '5. 输出正文时不要加解释、不要加"以下是"之类的开场。',
    OPTION_RULE,
].join('\n');

/**
 * 按项目类型取 AI 的系统提示
 * 小说用写手规则，工作文档用技术文档规则，笔记用整理规则——不是一套走天下
 * @param kind 项目类型，老数据没有这个字段时按小说处理
 * @returns 系统提示全文（不含作者自定义的附加指令）
 */
export function chatRolePrompt(kind: ProjectKind | undefined): string {
    if (kind === 'docs') {
        return DOCS_PROMPT;
    }
    if (kind === 'notes') {
        return NOTES_PROMPT;
    }
    return NOVEL_PROMPT;
}
