/**
 * 人味蒸馏（小说专用）
 *
 * 学什么？不是「某作者的语言风格」，而是「人的写作思路」。
 *
 * 为什么 AI 写的东西一眼假：它的思路太完美——能长程关联几万字，
 * 每段逻辑自洽、前后呼应、笔墨均匀、段末升华。人做不到这些，于是留下痕迹：
 * 会忘、会重复、会跳、会只死磕一个细节、会把段落断在半截。
 *
 * 所以这里统计的是「不完美」，不是「美」：
 * 1. 笔墨不均 —— 段长变异系数、单句成段率
 * 2. 逻辑不闭环 —— 段末总结率、过渡词密度
 * 3. 会重复自己 —— 相隔几十句的高相似句对
 * 4. 不概括 —— 抽象短语密度、AI 套话密度
 * 5. 有毛刺 —— 省略号/破折号收尾
 *
 * 风格统计（句长、对话占比）仍保留，但只作为参考值，不进提示词。
 * 提示词只讲思路，因为"像某人"和"像人"是两件事。
 *
 * 纯逻辑，不依赖 Node/Electron，渲染层也能算。
 */

import type { Skill, SkillChecker, SkillExample } from './skill';
import { countCharacters, countOccurrences, isDialogueSentence, splitSentences, splitWords } from './text/segment';
import { computeTextMetrics } from './text/metrics';
import { similarity } from './text/similarity';

/** 一段待分析的素材 */
export interface StyleSource {
    /** 出处名（书名或文件名），只用于展示 */
    name: string;
    /** 正文 */
    text: string;
}

/**
 * 思路痕迹：人写东西时留下的"不完美"指标
 *
 * 每项都以「AI 基准值」为参照：AI 写作在每项上都接近完美，
 * 偏离得越远，越像人手写。
 */
export interface HumanTrace {
    /** 样本字数 */
    charCount: number;
    /** 样本句数 */
    sentenceCount: number;
    /** 样本段数 */
    paragraphCount: number;
    /** 段长变异系数（标准差/均值）：笔墨是否不均。人高、AI 低 */
    paragraphLengthCV: number;
    /** 句长变异系数：句子长短是否忽长忽短。人高、AI 低 */
    sentenceLengthCV: number;
    /** 短句成段比例：一句话（20 字内）就换段。人高、AI 低 */
    singleSentenceParagraphRatio: number;
    /** 段末总结率：段落以感受/升华收尾的比例。AI 高、人低 */
    summaryEndingRatio: number;
    /** 每千字衔接词（于是/随后/与此同时）。AI 高、人低 */
    transitionPerThousand: number;
    /** 每千字抽象概括（一种……的感觉、说不出的）。AI 高、人低 */
    abstractFeelingPerThousand: number;
    /** 每千句的自我重复对数：相隔几十句又说了遍同样的话。人高、AI 近 0 */
    selfRepeatPerThousand: number;
    /** 省略号/破折号收尾的句子比例：没说完的毛刺。人高、AI 低 */
    unfinishedSentenceRatio: number;
    /** 每千字 AI 套话命中次数（仿佛/似乎/不禁…） */
    clichePerThousand: number;
    /** 人味分 0-100：把上面各项折算后取平均，仅用于展示和对比 */
    humanScore: number;
}

/** 蒸馏出的量化档案（风格参考值，只展示、不进提示词） */
export interface StyleMetrics {
    /** 参与统计的总字数 */
    charCount: number;
    /** 句子总数 */
    sentenceCount: number;
    /** 平均句长（字/句） */
    avgSentenceChars: number;
    /** 12 字以内短句占比 0-1 */
    shortSentenceRatio: number;
    /** 40 字以上长句占比 0-1 */
    longSentenceRatio: number;
    /** 平均段落字数 */
    avgParagraphChars: number;
    /** 平均每段几句 */
    avgSentencesPerParagraph: number;
    /** 对话字数占全文比例 0-1 */
    dialogueRatio: number;
    /** 对话句占全部句子比例 0-1 */
    dialogueLineRatio: number;
    /** 每千字"说/道/问/答"这类提示语出现的次数（近似） */
    speechTagDensity: number;
    /** 高频词（已去停用词），按次数降序 */
    topWords: Array<{ word: string; count: number }>;
    /** AI 套话在样本里的命中情况 */
    cliche: Array<{ word: string; count: number; perThousand: number }>;
    /** 这位作者几乎不用的套话，写进 checkers 当禁用词 */
    bannedWords: string[];
    /** 素材本数 */
    sourceCount: number;
    /** 思路痕迹：这才是要交给模型的东西 */
    trace: HumanTrace;
}

/** 单条素材的典型段落，用作示范 */
export interface StyleExcerpt {
    /** 上文的结尾，帮模型知道"接在哪" */
    lead: string;
    /** 原文段落 */
    body: string;
    /** 出处名 */
    source: string;
}

/** AI 味高发词：不是绝对禁词，而是"频率异常"就是 AI 写的证据 */
export const AI_CLICHE_WORDS: string[] = [
    '仿佛',
    '似乎',
    '不禁',
    '缓缓',
    '一丝',
    '不易察觉',
    '深邃',
    '嘴角',
    '眼神中',
    '下意识',
    '莫名',
    '意味深长',
    '五味杂陈',
    '如释重负',
    '深吸一口气',
    '瞳孔',
    '轻声',
    '微微',
    '空气仿佛凝固',
    '无法言喻',
];

/** 统计高频词时要跳过的虚词，否则 top 全是"的、了、是" */
const STOP_WORDS = new Set([
    '自己',
    '什么',
    '这个',
    '那个',
    '一个',
    '没有',
    '已经',
    '还是',
    '不过',
    '就是',
    '可是',
    '然后',
    '这样',
    '那样',
    '时候',
    '知道',
    '觉得',
    '看看',
    '起来',
    '出来',
    '一下',
    '一样',
    '这些',
    '那些',
    '我们',
    '你们',
    '他们',
    '她们',
    '现在',
    '因为',
    '所以',
    '但是',
    '如果',
    '只是',
    '真的',
    '不是',
    '可以',
    '这么',
    '那么',
]);

/** 章节标题行：蒸馏前要先剔掉，否则"第一章"会污染词汇统计 */
const CHAPTER_LINE = /^\s*(?:第\s*[0-9零一二三四五六七八九十百千两]{1,6}\s*[章节回卷]|chapter\s+\d{1,4})/i;
/** Markdown 标题行 */
const MD_HEADING_LINE = /^\s{0,3}#{1,6}\s+/;
/** 明显不是正文的零碎行：目录、作者的话、（本章完） */
const NOISE_LINE = /^\s*(?:目录|作者有话说|作者的话|求票|求收藏|（?本章完）?|\(?本章完\)?)\s*$/;

/**
 * 四舍五入到两位小数
 * @param value 原始值
 * @returns 处理后的值
 */
function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

/**
 * 清洗素材：去掉章节标题、目录和"求票"这类非正文行
 * @param text 原始文本
 * @returns 干净正文
 */
export function cleanStyleText(text: string): string {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const kept: string[] = [];
    for (const line of lines) {
        if (CHAPTER_LINE.test(line) || MD_HEADING_LINE.test(line) || NOISE_LINE.test(line)) {
            continue;
        }
        kept.push(line);
    }
    return kept.join('\n');
}

/**
 * 切段落
 *
 * 老 txt 常有两种写法：段间空一行，或每段只换行。
 * 先用空行切，如果切出来平均一段超过 600 字（说明其实没空行，整章成了一块），
 * 退回按行切。
 * @param text 正文
 * @returns 段落数组
 */
export function splitStyleParagraphs(text: string): string[] {
    const byBlank = text
        .split(/\n\s*\n/)
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
    const total = byBlank.reduce((sum, item) => sum + item.length, 0);
    const average = byBlank.length > 0 ? total / byBlank.length : 0;
    if (byBlank.length >= 6 && average <= 600) {
        return byBlank;
    }
    return text
        .split('\n')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
}

/**
 * 统计高频词
 * @param text 正文
 * @param limit 取前几名
 * @returns 词与次数
 */
export function topStyleWords(text: string, limit = 15): Array<{ word: string; count: number }> {
    const counter = new Map<string, number>();
    for (const word of splitWords(text)) {
        // 只留 2 字以上的纯汉字，单字和标点都是噪声
        if (word.length < 2 || !/^[\u4e00-\u9fa5]+$/.test(word) || STOP_WORDS.has(word)) {
            continue;
        }
        counter.set(word, (counter.get(word) ?? 0) + 1);
    }
    return [...counter.entries()]
        .map(([word, count]) => ({ word, count }))
        .sort((left, right) => right.count - left.count)
        .slice(0, limit);
}

/**
 * 统计 AI 套话密度
 * @param text 正文
 * @param charCount 总字数
 * @returns 每个词的命中次数与千字频率
 */
export function clicheProfile(
    text: string,
    charCount: number,
): Array<{ word: string; count: number; perThousand: number }> {
    const scale = charCount > 0 ? 1000 / charCount : 0;
    return AI_CLICHE_WORDS.map((word) => {
        const count = countOccurrences(text, word);
        return { word, count, perThousand: round2(count * scale) };
    });
}

/**
 * 从套话档案里挑出"该作者几乎不用"的词
 *
 * 只有"样本里几乎不出现"的才适合当禁用词：如果一个词这位作者本来就爱用，
 * 禁掉它等于写着不像他。
 * @param profile 套话档案
 * @param limit 最多挑几个
 * @returns 禁用词
 */
export function pickBannedWords(
    profile: Array<{ word: string; count: number; perThousand: number }>,
    limit = 8,
): string[] {
    return profile
        .filter((item) => item.perThousand < 0.05)
        .slice(0, limit)
        .map((item) => item.word);
}

/**
 * AI 默认写法的经验基准
 *
 * 这些数字来自对"模型默认输出"的观察，不是学术标准，只用来给作者一个对照物：
 * 偏离它越远，越像人手写。改这些值只会影响展示，不影响提示词的判断。
 */
export const AI_TRACE_BASELINE = {
    paragraphLengthCV: 0.35,
    sentenceLengthCV: 0.45,
    singleSentenceParagraphRatio: 0.04,
    summaryEndingRatio: 0.55,
    transitionPerThousand: 6,
    abstractFeelingPerThousand: 3,
    selfRepeatPerThousand: 0.2,
    unfinishedSentenceRatio: 0.01,
    clichePerThousand: 2.5,
};

/** 折算人味分时"够像人"的一端，和 AI_TRACE_BASELINE 方向相反 */
const HUMAN_TRACE_TARGET = {
    paragraphLengthCV: 1.2,
    sentenceLengthCV: 1.3,
    singleSentenceParagraphRatio: 0.35,
    summaryEndingRatio: 0.05,
    transitionPerThousand: 1,
    abstractFeelingPerThousand: 0.2,
    selfRepeatPerThousand: 3,
    unfinishedSentenceRatio: 0.15,
    clichePerThousand: 0.2,
};

/** 段末出现这些词，说明这一段被"总结"了（AI 的典型习惯） */
const SUMMARY_ENDING_WORDS = [
    '感觉',
    '感受',
    '心情',
    '心里',
    '明白',
    '意识到',
    '懂得',
    '原来',
    '终于',
    '也许',
    '或许',
    '仿佛',
    '似乎',
    '像是',
    '说不清',
    '无法形容',
    '五味杂陈',
    '如释重负',
    '意味深长',
    '这一刻',
];

/** 段落之间的缝合词：人写东西经常直接跳，不缝合 */
const TRANSITION_WORDS = [
    '于是',
    '因此',
    '所以',
    '接着',
    '随后',
    '然后',
    '同时',
    '此时',
    '与此同时',
    '紧接着',
    '总之',
    '由此可见',
];

/**
 * 抽象概括：AI 最爱把具体感受打包成名词短语
 *
 * 注意"一种/这种/那种"三种都要收——模型更爱用"这种说不清的感觉"，
 * 只盯"一种"会漏掉大半。
 */
const ABSTRACT_FEELING_PATTERN =
    /(?:一种|这种|那种|某种)[^。！？\n]{0,12}?的(?:感觉|情绪|气氛|滋味|味道|冲动|念头|压迫感|寒意|暖意)|说不出的|说不清的|无法形容|难以形容|难以言喻|无法言喻|莫名(?:其妙)?的|不易察觉的|意味深长/g;

/** 短段阈值：一句话且不超过这个字数，才算"一句话就换段" */
const SHORT_PARAGRAPH_CHARS = 20;

/** 自我重复的采样句数：全量两两比较太慢，均匀抽样足够估出密度 */
const REPEAT_SENTENCE_SAMPLE = 1500;
/** 太近的句子不算重复（同一句承上启下是正常写法） */
const REPEAT_MIN_GAP = 3;
/**
 * 隔太远就不算"忘了自己刚写过"
 *
 * 原来放到 50 句，结果把"同一个场景里句式复用"也算成重复了：
 * 模型爱用固定句式（"他缓缓推开门，仿佛…"），字面很像但内容不同。
 * 收窄到 20 句，只抓同场景内的真重复。
 */
const REPEAT_MAX_GAP = 20;
/** 相似到这个程度才算"又说了遍同样的话"；0.55 会把同结构不同内容的句子算进来 */
const REPEAT_THRESHOLD = 0.7;

/**
 * 把数值夹到 0-1
 * @param value 原值
 * @returns 夹取后的值
 */
function clamp01(value: number): number {
    return Math.min(1, Math.max(0, value));
}

/**
 * 变异系数：标准差除以均值，衡量"忽长忽短"的程度
 * @param values 数值序列
 * @returns 变异系数
 */
function coefficientOfVariation(values: number[]): number {
    if (values.length < 2) {
        return 0;
    }
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    if (mean <= 0) {
        return 0;
    }
    const variance =
        values.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / values.length;
    return Math.sqrt(variance) / mean;
}

/**
 * 段末总结率：段落最后一句是否在"给感受下结论"
 * @param paragraphs 段落
 * @returns 0-1
 */
function computeSummaryEndingRatio(paragraphs: string[]): number {
    if (paragraphs.length === 0) {
        return 0;
    }
    let hit = 0;
    for (const paragraph of paragraphs) {
        const sentences = splitSentences(paragraph);
        const last = sentences.length > 0 ? sentences[sentences.length - 1] : paragraph;
        // 只留正文，引号和标点会干扰词表匹配
        const clean = last.replace(/[“”"「」『』\s]/g, '');
        if (SUMMARY_ENDING_WORDS.some((word) => clean.includes(word))) {
            hit += 1;
        }
    }
    return hit / paragraphs.length;
}

/**
 * 词表密度（每千字出现次数）
 * @param text 正文
 * @param words 词表
 * @param charCount 总字数
 * @returns 每千字次数
 */
function keywordDensity(text: string, words: string[], charCount: number): number {
    if (charCount <= 0) {
        return 0;
    }
    const total = words.reduce((sum, word) => sum + countOccurrences(text, word), 0);
    return (total * 1000) / charCount;
}

/**
 * 正则密度（每千字命中次数）
 * @param text 正文
 * @param pattern 正则（必须带 g）
 * @param charCount 总字数
 * @returns 每千字次数
 */
function patternDensity(text: string, pattern: RegExp, charCount: number): number {
    if (charCount <= 0) {
        return 0;
    }
    const matches = text.match(pattern);
    return ((matches ? matches.length : 0) * 1000) / charCount;
}

/**
 * 自我重复密度：隔几十句又说了遍相似的话
 *
 * 这是"人无法长程关联"最直接的痕迹——写到第 800 句时忘了第 700 句说过什么。
 * AI 的工作记忆覆盖全文，这一项几乎恒为 0。
 * @param sentences 句子
 * @returns 每千句命中的对数
 */
function computeSelfRepeat(sentences: string[]): number {
    if (sentences.length < REPEAT_MIN_GAP + 2) {
        return 0;
    }
    const step = Math.max(1, Math.floor(sentences.length / REPEAT_SENTENCE_SAMPLE));
    let checked = 0;
    let hits = 0;
    for (let index = 0; index < sentences.length; index += step) {
        const current = sentences[index];
        // 太短的句子（"他没答。"）跟谁比都像，会把这个指标灌满
        if (countCharacters(current) < 6) {
            continue;
        }
        const limit = Math.min(sentences.length, index + REPEAT_MAX_GAP + 1);
        for (let next = index + REPEAT_MIN_GAP; next < limit; next += 1) {
            const candidate = sentences[next];
            if (countCharacters(candidate) < 6) {
                continue;
            }
            if (similarity(current, candidate) >= REPEAT_THRESHOLD) {
                hits += 1;
            }
        }
        checked += 1;
    }
    if (checked === 0) {
        return 0;
    }
    return (hits / checked) * 1000;
}

/**
 * 把一项指标折算成 0-1 的"像人程度"
 * @param value 样本值
 * @param aiValue AI 基准
 * @param humanValue 够像人的一端
 * @returns 0-1
 */
function traceScore(value: number, aiValue: number, humanValue: number): number {
    if (humanValue === aiValue) {
        return 0;
    }
    return clamp01((value - aiValue) / (humanValue - aiValue));
}

/**
 * 算出思路痕迹
 * @param text 正文
 * @param sentences 句子
 * @param paragraphs 段落
 * @param charCount 字数
 * @param clicheCount AI 套话命中总数
 * @returns 痕迹档案
 */
export function computeHumanTrace(
    text: string,
    sentences: string[],
    paragraphs: string[],
    charCount: number,
    clicheCount: number,
): HumanTrace {
    const sentenceLengths = sentences.map((item) => countCharacters(item));
    const paragraphLengths = paragraphs.map((item) => countCharacters(item));
    // "一句话就换段"必须同时满足：只含一句 + 这句够短。
    // AI 也常一段一句，但那是一整段长句（60 字往上），不算人的断点。
    const singleCount = paragraphs.filter((item) => {
        const paragraphSentences = splitSentences(item);
        return (
            paragraphSentences.length <= 1 &&
            countCharacters(item) <= SHORT_PARAGRAPH_CHARS
        );
    }).length;
    const unfinished = sentences.filter((item) =>
        /(?:……|…|——|—)[”"」』』]?$/.test(item.trim()),
    ).length;

    const trace: HumanTrace = {
        charCount,
        sentenceCount: sentences.length,
        paragraphCount: paragraphs.length,
        paragraphLengthCV: round2(coefficientOfVariation(paragraphLengths)),
        sentenceLengthCV: round2(coefficientOfVariation(sentenceLengths)),
        singleSentenceParagraphRatio: round2(
            paragraphs.length > 0 ? singleCount / paragraphs.length : 0,
        ),
        summaryEndingRatio: round2(computeSummaryEndingRatio(paragraphs)),
        transitionPerThousand: round2(keywordDensity(text, TRANSITION_WORDS, charCount)),
        abstractFeelingPerThousand: round2(
            patternDensity(text, ABSTRACT_FEELING_PATTERN, charCount),
        ),
        selfRepeatPerThousand: round2(computeSelfRepeat(sentences)),
        unfinishedSentenceRatio: round2(sentences.length > 0 ? unfinished / sentences.length : 0),
        clichePerThousand: round2(charCount > 0 ? (clicheCount * 1000) / charCount : 0),
        humanScore: 0,
    };

    trace.humanScore = scoreHumanTrace(trace);
    return trace;
}

/**
 * 算人味分：每项折算成 0-1 后取平均，再放大到 0-100
 *
 * 单独导出是因为"累积多本书"时要先加权合并各项指标，再重算总分，
 * 不能把各书的总分直接平均（指标之间不是线性的）。
 *
 * 自我重复不计入：这个指标的绝对值在真实文本里浮动太大（取决于作者
 * 是否回头改稿），用固定阈值折算会误判，所以只测量、只展示、不定分。
 * @param trace 痕迹档案
 * @returns 0-100
 */
export function scoreHumanTrace(trace: HumanTrace): number {
    const baseline = AI_TRACE_BASELINE;
    const target = HUMAN_TRACE_TARGET;
    const pairs: Array<[number, number, number]> = [
        [trace.paragraphLengthCV, baseline.paragraphLengthCV, target.paragraphLengthCV],
        [trace.sentenceLengthCV, baseline.sentenceLengthCV, target.sentenceLengthCV],
        [
            trace.singleSentenceParagraphRatio,
            baseline.singleSentenceParagraphRatio,
            target.singleSentenceParagraphRatio,
        ],
        [trace.summaryEndingRatio, baseline.summaryEndingRatio, target.summaryEndingRatio],
        [trace.transitionPerThousand, baseline.transitionPerThousand, target.transitionPerThousand],
        [
            trace.abstractFeelingPerThousand,
            baseline.abstractFeelingPerThousand,
            target.abstractFeelingPerThousand,
        ],
        [
            trace.unfinishedSentenceRatio,
            baseline.unfinishedSentenceRatio,
            target.unfinishedSentenceRatio,
        ],
        [trace.clichePerThousand, baseline.clichePerThousand, target.clichePerThousand],
    ];
    const total = pairs.reduce((sum, [value, ai, human]) => sum + traceScore(value, ai, human), 0);
    return Math.round((total / pairs.length) * 100);
}

/**
 * 合并时按权重平均的字段（计数类字段直接求和）
 *
 * 自我重复也在这里平均而不是求和：它是"每千句的对数"，本身已经是密度。
 */
const WEIGHTED_TRACE_FIELDS: Array<keyof HumanTrace> = [
    'paragraphLengthCV',
    'sentenceLengthCV',
    'singleSentenceParagraphRatio',
    'summaryEndingRatio',
    'transitionPerThousand',
    'abstractFeelingPerThousand',
    'selfRepeatPerThousand',
    'unfinishedSentenceRatio',
    'clichePerThousand',
];

/**
 * 按权重合并多份痕迹
 *
 * 为什么必须加权：一本 50 万字的书比一篇 2 万字的中篇更能代表写法，
 * 等权平均会被小样本带偏；作者自己每次保存的字数也差很多，同理。
 * @param entries 每份痕迹与它的权重（一般取字数）
 * @returns 合并后的痕迹
 */
export function mergeTraceByWeight(
    entries: Array<{ weight: number; trace: HumanTrace }>,
): HumanTrace {
    // 一份都没有时不能走折算：全零指标的"最像人"判法会算出 50 分这种假分数
    if (entries.length === 0) {
        return {
            charCount: 0,
            sentenceCount: 0,
            paragraphCount: 0,
            paragraphLengthCV: 0,
            sentenceLengthCV: 0,
            singleSentenceParagraphRatio: 0,
            summaryEndingRatio: 0,
            transitionPerThousand: 0,
            abstractFeelingPerThousand: 0,
            selfRepeatPerThousand: 0,
            unfinishedSentenceRatio: 0,
            clichePerThousand: 0,
            humanScore: 0,
        };
    }
    const merged: HumanTrace = {
        charCount: entries.reduce((sum, item) => sum + item.trace.charCount, 0),
        sentenceCount: entries.reduce((sum, item) => sum + item.trace.sentenceCount, 0),
        paragraphCount: entries.reduce((sum, item) => sum + item.trace.paragraphCount, 0),
        paragraphLengthCV: 0,
        sentenceLengthCV: 0,
        singleSentenceParagraphRatio: 0,
        summaryEndingRatio: 0,
        transitionPerThousand: 0,
        abstractFeelingPerThousand: 0,
        selfRepeatPerThousand: 0,
        unfinishedSentenceRatio: 0,
        clichePerThousand: 0,
        humanScore: 0,
    };
    for (const field of WEIGHTED_TRACE_FIELDS) {
        let total = 0;
        let weight = 0;
        for (const entry of entries) {
            const scale = Math.max(1, entry.weight);
            total += entry.trace[field] * scale;
            weight += scale;
        }
        merged[field] = round2(weight > 0 ? total / weight : 0);
    }
    // 加权平均后各项都变了，总分必须重算：指标之间不是线性的
    merged.humanScore = scoreHumanTrace(merged);
    return merged;
}

/**
 * 分析一组素材，得到量化档案
 * @param sources 素材
 * @returns 档案
 */
export function analyzeStyle(sources: StyleSource[]): StyleMetrics {
    const cleaned = sources
        .map((item) => ({ name: item.name, text: cleanStyleText(item.text) }))
        .filter((item) => countCharacters(item.text) >= 200);
    const text = cleaned.map((item) => item.text).join('\n\n');
    const charCount = countCharacters(text);
    const sentences = splitSentences(text);
    const paragraphs = splitStyleParagraphs(text);

    const sentenceLengths = sentences.map((item) => countCharacters(item));
    const avgSentenceChars =
        sentenceLengths.length > 0
            ? sentenceLengths.reduce((sum, value) => sum + value, 0) / sentenceLengths.length
            : 0;
    const shortCount = sentenceLengths.filter((value) => value <= 12).length;
    const longCount = sentenceLengths.filter((value) => value >= 40).length;

    const paragraphChars = paragraphs.map((item) => countCharacters(item));
    const avgParagraphChars =
        paragraphChars.length > 0
            ? paragraphChars.reduce((sum, value) => sum + value, 0) / paragraphChars.length
            : 0;
    const sentencesPerParagraph = paragraphs.map((item) => splitSentences(item).length);
    const avgSentencesPerParagraph =
        sentencesPerParagraph.length > 0
            ? sentencesPerParagraph.reduce((sum, value) => sum + value, 0) /
              sentencesPerParagraph.length
            : 0;

    const metrics = computeTextMetrics(text);
    const dialogueLines = sentences.filter((item) => isDialogueSentence(item)).length;
    const speechWords = splitWords(text).filter((word) => /^[说道问答喊]$/.test(word)).length;
    const cliche = clicheProfile(text, charCount);
    const clicheTotal = cliche.reduce((sum, item) => sum + item.count, 0);

    return {
        charCount,
        sentenceCount: sentences.length,
        avgSentenceChars: round2(avgSentenceChars),
        shortSentenceRatio: round2(sentences.length > 0 ? shortCount / sentences.length : 0),
        longSentenceRatio: round2(sentences.length > 0 ? longCount / sentences.length : 0),
        avgParagraphChars: round2(avgParagraphChars),
        avgSentencesPerParagraph: round2(avgSentencesPerParagraph),
        dialogueRatio: round2(metrics.dialogueRatio),
        dialogueLineRatio: round2(sentences.length > 0 ? dialogueLines / sentences.length : 0),
        speechTagDensity: round2(charCount > 0 ? (speechWords * 1000) / charCount : 0),
        topWords: topStyleWords(text),
        cliche,
        bannedWords: pickBannedWords(cliche),
        sourceCount: cleaned.length,
        trace: computeHumanTrace(text, sentences, paragraphs, charCount, clicheTotal),
    };
}

/** 一个候选示范窗口（相邻若干段拼成） */
interface ExcerptWindow {
    /** 起始段落下标 */
    start: number;
    /** 结束段落下标（含） */
    end: number;
    body: string;
    lead: string;
    score: number;
}

/** 示范段最短字数：低于这个不足以看出节奏 */
const MIN_EXCERPT_CHARS = 120;
/** 示范段最长字数：再长会挤掉提示词预算 */
const MAX_EXCERPT_CHARS = 900;

/**
 * 给每本书挑出几段原文当示范
 *
 * 为什么还要原文：思路这种东西讲不清，但"他怎么把一个动作写具体"看一眼就懂。
 * 示范只承担"长什么样"，规则和数字才承担"怎么写"，两者不重复。
 *
 * 为什么不按单段挑：有的作者一段只有十几个字，单段当不了示范，
 * 所以按"相邻几段拼到 120 字以上"的滑窗来挑。
 * 打分标准跟"某位作者"无关：含对话的优先，长度落在看着舒服的区间优先。
 * @param sources 素材
 * @param perSource 每本最多挑几段
 * @returns 示范片段
 */
export function pickStyleExcerpts(sources: StyleSource[], perSource = 1): StyleExcerpt[] {
    const picked: StyleExcerpt[] = [];
    for (const source of sources) {
        const paragraphs = splitStyleParagraphs(cleanStyleText(source.text));
        const windows: ExcerptWindow[] = [];
        // 从下标 1 起：第一段没有上文，示范里"承接上文"会空掉
        for (let start = 1; start < paragraphs.length; start += 1) {
            const parts: string[] = [];
            let length = 0;
            let end = start;
            while (end < paragraphs.length && length < MIN_EXCERPT_CHARS) {
                parts.push(paragraphs[end]);
                length += countCharacters(paragraphs[end]);
                end += 1;
            }
            if (length < MIN_EXCERPT_CHARS || length > MAX_EXCERPT_CHARS) {
                continue;
            }
            const body = parts.join('\n');
            const sentences = splitSentences(body);
            const average =
                sentences.length > 0
                    ? sentences.reduce((sum, item) => sum + countCharacters(item), 0) /
                      sentences.length
                    : 0;
            // 对话段最见"人怎么说话"，优先；长度偏离 240 字越远越不典型
            const hasDialogue = /[“"「]/.test(body) ? 6 : 0;
            const score =
                hasDialogue - Math.abs(average - 18) * 0.3 - Math.abs(length - 240) / 400;
            windows.push({ start, end: end - 1, body, lead: paragraphs[start - 1].slice(-60), score });
        }

        const used: ExcerptWindow[] = [];
        for (const window of [...windows].sort((left, right) => right.score - left.score)) {
            if (used.length >= perSource) {
                break;
            }
            // 窗口之间不能重叠，否则示范会重复同一段文字
            if (used.some((item) => window.start <= item.end && item.start <= window.end)) {
                continue;
            }
            used.push(window);
        }
        used.sort((left, right) => left.start - right.start);
        for (const item of used) {
            picked.push({ lead: item.lead, body: item.body, source: source.name });
        }
    }
    return picked;
}

/**
 * 把思路痕迹写成作者能看懂的中文说明，每项后面标出 AI 的基准值
 *
 * 为什么带基准：单看"段长波动 1.12"没有意义，跟"AI 约 0.35"并排才有说服力。
 * @param trace 痕迹
 * @returns 多行说明
 */
export function describeHumanTrace(trace: HumanTrace): string[] {
    const percent = (value: number): string => `${Math.round(value * 100)}%`;
    return [
        `笔墨不均：段长波动 ${trace.paragraphLengthCV}` +
            `（AI 约 ${AI_TRACE_BASELINE.paragraphLengthCV}），` +
            `单句成段占 ${percent(trace.singleSentenceParagraphRatio)}。`,
        `不爱收尾：${percent(trace.summaryEndingRatio)} 的段落以感受/总结结束` +
            `（AI 约 ${percent(AI_TRACE_BASELINE.summaryEndingRatio)}）。`,
        `不缝合：每千字衔接词 ${trace.transitionPerThousand} 次` +
            `（AI 约 ${AI_TRACE_BASELINE.transitionPerThousand} 次）。`,
        `会重复自己：每千句 ${trace.selfRepeatPerThousand} 处` +
            `（AI 约 ${AI_TRACE_BASELINE.selfRepeatPerThousand} 处）。`,
        `不概括：每千字抽象短语 ${trace.abstractFeelingPerThousand} 次` +
            `（AI 约 ${AI_TRACE_BASELINE.abstractFeelingPerThousand} 次）。`,
        `有毛刺：${percent(trace.unfinishedSentenceRatio)} 的句子以省略号/破折号收尾。`,
        `AI 套话：每千字 ${trace.clichePerThousand} 次` +
            `（AI 约 ${AI_TRACE_BASELINE.clichePerThousand} 次）。`,
    ];
}

/** 人味基线技能的固定 id：全局只有一份，重复蒸馏是"更新"而不是"新增" */
export const HUMAN_TRACE_SKILL_ID = 'novel-humanness';
/** 人味基线技能的固定名字 */
export const HUMAN_TRACE_SKILL_NAME = '人味·叙事基线';
/**
 * 固定要盯住的 AI 口头禅
 *
 * 注意：这不是"某位作者不用的词"，而是模型自己爱用的词。
 * 所以不按样本频率挑选——样本里出现得少不代表是风格，出现得多也不该放过。
 */
export const HUMAN_TRACE_FORBIDDEN: string[] = [
    '仿佛',
    '似乎',
    '不禁',
    '缓缓',
    '意味深长',
    '五味杂陈',
    '无法言喻',
    '下意识',
];

/** 生成人味技能时的参数 */
export interface BuildHumanTraceInput {
    /** 量化档案（风格值只作参考，思路痕迹才是主体） */
    metrics: StyleMetrics;
    /** 原文示范片段，用来示范"人怎么把一个动作写具体" */
    excerpts: StyleExcerpt[];
    /** 累积参考书目数量 */
    sourceCount: number;
    /** 累积正文字数 */
    charCount: number;
}

/**
 * 把思路痕迹组装成一份可安装的技能
 *
 * 全程不提"像某个作者"，只讲"人跟 AI 的思路差在哪"，所以同一份技能
 * 可以吃任意作者、任意题材的样本，不需要一人一份。
 * @param input 参数
 * @returns 技能对象
 */
export function buildHumanTraceSkill(input: BuildHumanTraceInput): Skill {
    const { trace } = input.metrics;
    const percent = (value: number): string => `${Math.round(value * 100)}%`;
    const baseline = AI_TRACE_BASELINE;
    const prompt = [
        '任务：写小说正文。',
        '这份基线不是「某个作者的风格」，是从人手稿里统计出的思维习惯。',
        '人和 AI 的差别不在用词，在思路：AI 能把几万字前后照顾到、每段逻辑自洽；人做不到。',
        '按人的状态写，不要按"更好的写法"写。',
        '',
        `笔墨不均：段长波动 ${trace.paragraphLengthCV}（AI 约 ${baseline.paragraphLengthCV}），` +
            `单句成段占 ${percent(trace.singleSentenceParagraphRatio)}。` +
            '允许某段只有一句话，也允许连着十几句只写一个动作，别平均分配笔墨。',
        `不在段末收尾：样本只有 ${percent(trace.summaryEndingRatio)} 的段落以感受收尾` +
            `（AI 约 ${percent(baseline.summaryEndingRatio)}）。` +
            '段落直接断在动作或对话上，下一段就跳走。',
        `不缝合：每千字衔接词 ${trace.transitionPerThousand} 次` +
            `（AI 约 ${baseline.transitionPerThousand} 次）。` +
            '少写"于是/随后/与此同时"这类把两段粘起来的词。',
        '会重复自己：人写长篇会忘掉几十句前说过什么，同一件事说两遍是正常的。' +
            '别因为"前面交代过了"就刻意删掉，也别每句话都换个新说法。',
        `不概括：每千字抽象短语 ${trace.abstractFeelingPerThousand} 次` +
            `（AI 约 ${baseline.abstractFeelingPerThousand} 次）。` +
            '不写"一种说不出的感觉"，情绪放在动作、物件、对话上。',
        `有毛刺：${percent(trace.unfinishedSentenceRatio)} 的句子以省略号或破折号收尾。` +
            '允许话说一半、允许口误、允许句子不完整。',
        '',
        '不要做的（这些是 AI 的默认习惯，不是人的）：',
        '- 不要每段都写出完整因果链。',
        '- 不要回收每一个道具，不要首尾呼应，不要给每个出场的人都安排作用。',
        '- 不要写得比样本更整齐、更漂亮、更懂事。',
        '- 不要替读者总结这一段讲了什么。',
        '',
        '只输出正文。',
    ].join('\n');

    const rules: string[] = [
        '笔墨不均：允许一句成段，也允许一段只写一个动作',
        '段末直接断掉，不总结、不升华、不解释心理',
        '少用"于是/随后/与此同时"缝合段落',
        '允许重复、允许跑偏、允许话说一半',
        '不写"一种说不出的感觉"这类抽象概括',
    ];

    const checkers: SkillChecker[] = [
        { type: 'noExplanation', message: '只输出正文' },
        {
            type: 'forbiddenWords',
            value: [...HUMAN_TRACE_FORBIDDEN],
            message: `这些是 AI 腔的口头禅（${HUMAN_TRACE_FORBIDDEN.join('、')}），换人话`,
        },
    ];

    const examples: SkillExample[] = input.excerpts.slice(0, 3).map((item) => ({
        input:
            item.lead.length > 0
                ? `承接上文（……${item.lead}）往下写，别写得太完整`
                : '往下写一段，别写得太完整',
        output: item.body,
    }));

    return {
        id: HUMAN_TRACE_SKILL_ID,
        name: HUMAN_TRACE_SKILL_NAME,
        version: '1.0.0',
        author: '人味蒸馏',
        description:
            `参考 ${input.sourceCount} 本、${input.charCount} 字：` +
            `人味分 ${trace.humanScore}，段长波动 ${trace.paragraphLengthCV}`,
        modules: ['novel'],
        icon: '🖊',
        triggers: ['人味', '去AI味', '去 AI 味', '人写的'],
        prompt,
        rules,
        checkers,
        examples,
        enabled: true,
        builtin: false,
    };
}
