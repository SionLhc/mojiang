/**
 * 词库闸：12 类本地规则检测
 * 全部是字符串和正则运算，0 token，0 网络请求。
 */

import type { CategorySummary, Finding, LexiconReport, Severity } from '../types';
import { countCharacters, findOccurrences, splitSentenceRanges } from '../text/segment';
import { DEFAULT_RULES, type LexiconRule } from './rules';

/** 检测选项 */
export interface LexiconOptions {
    /** 专有名词豁免表：人名、地名、宗门名，命中这些不算重复 */
    properNouns?: string[];
    /** 自定义规则表，不传则用内置 12 类 */
    rules?: LexiconRule[];
}

/** 判定"情绪高点"的辅助词：这些词附近的重复算修辞，不算偷懒 */
const EMOTION_PEAK_WORDS = [
    '吼', '喊', '怒', '哭', '笑', '颤抖', '咬牙', '血', '死', '疼', '痛', '泪',
];

/** 句子里的标点，用于跳过含标点的重复片段 */
const PUNCTUATION_PATTERN = /[\s，。！？、；：“”‘’「」『』（）《》〈〉…—,.!?;:'"()[\]]/;

/**
 * 把一批命中按"每千字密度"过滤
 * 低于容忍密度的不报，避免把正常写作判成毛病
 * @param findings 命中列表
 * @param rule 所属规则
 * @param charCount 全文字数
 * @returns 过滤后的命中
 */
function filterByTolerance(findings: Finding[], rule: LexiconRule, charCount: number): Finding[] {
    const tolerance = rule.tolerancePerKilo ?? 0;
    if (tolerance <= 0) {
        return findings;
    }
    const kilo = Math.max(charCount / 1000, 0.3);
    const density = findings.length / kilo;
    return density > tolerance ? findings : [];
}

/**
 * 词表类规则：逐词查找所有出现位置
 * @param text 正文
 * @param rule 规则
 * @returns 命中列表
 */
function collectPhraseFindings(text: string, rule: LexiconRule): Finding[] {
    const words = rule.words ?? [];
    const findings: Finding[] = [];
    for (const word of words) {
        for (const range of findOccurrences(text, word)) {
            findings.push({
                ruleId: rule.id,
                category: rule.category,
                severity: rule.severity,
                message: rule.message,
                snippet: word,
                start: range.start,
                end: range.end,
                suggestion: rule.suggestion,
            });
        }
    }
    return findings;
}

/**
 * 正则类规则：匹配句式模板
 * @param text 正文
 * @param rule 规则
 * @returns 命中列表
 */
function collectPatternFindings(text: string, rule: LexiconRule): Finding[] {
    if (!rule.patternSource) {
        return [];
    }
    const flags = (rule.patternFlags ?? 'g').includes('g')
        ? (rule.patternFlags ?? 'g')
        : `${rule.patternFlags ?? ''}g`;
    // 每次新建正则对象，避免 lastIndex 在多次调用间残留
    const pattern = new RegExp(rule.patternSource, flags);
    const findings: Finding[] = [];
    for (const match of text.matchAll(pattern)) {
        const snippet = match[0];
        const start = match.index ?? 0;
        findings.push({
            ruleId: rule.id,
            category: rule.category,
            severity: rule.severity,
            message: rule.message,
            snippet,
            start,
            end: start + snippet.length,
            suggestion: rule.suggestion,
        });
    }
    return findings;
}

/**
 * 计算每个段落的起止位置，用于判断某个命中是否处在情绪高点段落
 * @param text 正文
 * @returns 段落范围
 */
function collectParagraphRanges(text: string): Array<{ start: number; end: number }> {
    const ranges: Array<{ start: number; end: number }> = [];
    let cursor = 0;
    for (const line of text.split('\n')) {
        ranges.push({ start: cursor, end: cursor + line.length });
        cursor += line.length + 1;
    }
    return ranges;
}

/**
 * 判断某个偏移是否处在情绪高点段落
 * 规划书要求：情绪高点的重复是情绪，不算偷懒
 * @param text 正文
 * @param paragraphs 段落范围
 * @param offset 偏移
 * @returns 是否情绪高点
 */
function isEmotionalPeak(
    text: string,
    paragraphs: Array<{ start: number; end: number }>,
    offset: number,
): boolean {
    const paragraph = paragraphs.find((item) => offset >= item.start && offset <= item.end);
    if (!paragraph) {
        return false;
    }
    const content = text.slice(paragraph.start, paragraph.end);
    if (/[！!]/.test(content)) {
        return true;
    }
    return EMOTION_PEAK_WORDS.some((word) => content.includes(word));
}

/**
 * 重复检测：4 字片段出现 3 次以上
 * 专有名词豁免，情绪高点降级为提示
 * @param text 正文
 * @param rule 规则
 * @param properNouns 专有名词表
 * @returns 命中列表
 */
function collectRepetitionFindings(
    text: string,
    rule: LexiconRule,
    properNouns: string[],
): Finding[] {
    const gramLength = 4;
    const minCount = 3;
    const positions = new Map<string, number[]>();

    for (let index = 0; index + gramLength <= text.length; index += 1) {
        const gram = text.slice(index, index + gramLength);
        if (PUNCTUATION_PATTERN.test(gram)) {
            continue;
        }
        const hits = positions.get(gram) ?? [];
        hits.push(index);
        positions.set(gram, hits);
    }

    const paragraphs = collectParagraphRanges(text);
    const findings: Finding[] = [];
    const reportedRanges: Array<{ start: number; end: number }> = [];

    for (const [gram, hits] of positions) {
        if (hits.length < minCount) {
            continue;
        }
        // 专有名词豁免：任一个专有名包含该片段就跳过
        if (properNouns.some((noun) => noun.includes(gram))) {
            continue;
        }
        const first = hits[0];
        // 已经报过的位置附近不重复报，避免一个长句产生多条重叠 4-gram
        const overlapped = reportedRanges.some(
            (range) => first >= range.start - gramLength && first <= range.end,
        );
        if (overlapped) {
            continue;
        }
        const severity: Severity = isEmotionalPeak(text, paragraphs, first) ? 'info' : rule.severity;
        findings.push({
            ruleId: rule.id,
            category: rule.category,
            severity,
            message: `"${gram}"在全文出现 ${hits.length} 次，${rule.message}`,
            snippet: gram,
            start: first,
            end: first + gramLength,
        });
        reportedRanges.push({ start: first, end: first + gramLength });
    }

    return findings;
}

/**
 * 节奏检测：连续 4 句以上都短于 8 字，判为短句堆砌
 * @param text 正文
 * @param rule 规则
 * @returns 命中列表
 */
function collectRhythmFindings(text: string, rule: LexiconRule): Finding[] {
    const sentences = splitSentenceRanges(text);
    const findings: Finding[] = [];
    let runStart = -1;
    let runCount = 0;

    const flushRun = (): void => {
        if (runCount >= 4 && runStart >= 0) {
            const start = sentences.find((item) => item.start >= runStart)?.start ?? runStart;
            findings.push({
                ruleId: rule.id,
                category: rule.category,
                severity: rule.severity,
                message: `连续 ${runCount} 句都短于 8 字，${rule.message}`,
                snippet: text.slice(start, Math.min(start + 12, text.length)),
                start,
                end: Math.min(start + 12, text.length),
            });
        }
        runStart = -1;
        runCount = 0;
    };

    for (const sentence of sentences) {
        const length = countCharacters(sentence.text);
        if (length > 0 && length < 8) {
            if (runStart < 0) {
                runStart = sentence.start;
            }
            runCount += 1;
        } else {
            flushRun();
        }
    }
    flushRun();

    return findings;
}

/**
 * 对话检测：超长对话句 + 引号不配平
 * @param text 正文
 * @param rule 规则
 * @returns 命中列表
 */
function collectDialogueFindings(text: string, rule: LexiconRule): Finding[] {
    const findings: Finding[] = [];

    // 直接找"引号内超过 80 字"的片段：对话经常被切成「他说，"……"」，
    // 按整句判断会漏掉真正长的对话
    const longQuote = /[“"]([^“”"]{80,})[”"]/g;
    for (const match of text.matchAll(longQuote)) {
        const inner = match[1];
        const start = match.index ?? 0;
        findings.push({
            ruleId: rule.id,
            category: rule.category,
            severity: rule.severity,
            message: `这段话 ${countCharacters(inner)} 字没换气，读者会读串，拆成几句再加动作`,
            snippet: inner.slice(0, 16),
            start,
            end: Math.min(start + 16, text.length),
        });
    }

    const leftQuotes = findOccurrences(text, '“').length;
    const rightQuotes = findOccurrences(text, '”').length;
    if (leftQuotes !== rightQuotes) {
        findings.push({
            ruleId: rule.id,
            category: rule.category,
            severity: 'error',
            message: `中文引号没配平：左引号 ${leftQuotes} 个、右引号 ${rightQuotes} 个`,
            snippet: '引号配对',
            start: 0,
            end: 0,
        });
    }

    return findings;
}

/**
 * 综合打分
 * 按命中密度扣分，权重按严重程度区分。规则是确定的，同一文本分数恒定。
 * @param findings 全部命中
 * @param charCount 字数
 * @returns 0-100 分
 */
function computeScore(findings: Finding[], charCount: number): number {
    if (charCount <= 0) {
        return 100;
    }
    const weights: Record<Severity, number> = { info: 0.7, warn: 1.4, error: 2.2 };
    let penalty = 0;
    for (const finding of findings) {
        penalty += weights[finding.severity];
    }
    // 千字折算下限设为 1：一百多字的片段按一千字算，
    // 否则短文本里两三个词就把分数打到 0，作者会觉得"这工具在骂我"
    const kilo = Math.max(charCount / 1000, 1);
    const density = penalty / kilo;
    return Math.max(0, Math.min(100, Math.round(100 - density * 3)));
}

/**
 * 执行 12 类词库检测
 * @param text 章节正文
 * @param options 检测选项
 * @returns 词库闸结论
 */
export function runLexiconCheck(text: string, options: LexiconOptions = {}): LexiconReport {
    const rules = options.rules ?? DEFAULT_RULES;
    const properNouns = options.properNouns ?? [];
    const charCount = countCharacters(text);
    const findings: Finding[] = [];

    for (const rule of rules) {
        let ruleFindings: Finding[] = [];
        if (rule.kind === 'phrase') {
            ruleFindings = filterByTolerance(
                collectPhraseFindings(text, rule),
                rule,
                charCount,
            );
        } else if (rule.kind === 'pattern') {
            ruleFindings = filterByTolerance(
                collectPatternFindings(text, rule),
                rule,
                charCount,
            );
        } else if (rule.kind === 'repetition') {
            ruleFindings = collectRepetitionFindings(text, rule, properNouns);
        } else if (rule.kind === 'rhythm') {
            ruleFindings = collectRhythmFindings(text, rule);
        } else if (rule.kind === 'dialogue') {
            ruleFindings = collectDialogueFindings(text, rule);
        }
        findings.push(...ruleFindings);
    }

    findings.sort((left, right) => left.start - right.start);

    const summaries: CategorySummary[] = rules.map((rule) => {
        const count = findings.filter((finding) => finding.ruleId === rule.id).length;
        return {
            category: rule.category,
            ruleId: rule.id,
            count,
            severity: rule.severity,
        };
    });

    return {
        findings,
        summaries,
        score: computeScore(findings, charCount),
        charCount,
    };
}
