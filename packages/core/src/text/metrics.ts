/**
 * 六维指标计算
 * 全部是"可复算的计数"，不调模型，所以同一个文本永远算出同一个分数。
 * 这是墨匠体检可信的基础：作者可以自己数一遍核对。
 */

import type { TextMetrics } from '../types';
import {
    ABSTRACT_NOUNS,
    ACTION_VERBS,
    BLANK_MARKERS,
    MODIFIER_MARKERS,
    UNCERTAINTY_WORDS,
} from '../lexicon/word-lists';
import { countCharacters, countOccurrences, splitSentences } from './segment';

/**
 * 把计数换算成"每千字次数"
 * 用千字而不是百分比，是为了让数值落在 0-100 的可读区间
 * @param count 命中次数
 * @param charCount 总字数
 * @returns 每千字次数
 */
function perThousand(count: number, charCount: number): number {
    if (charCount <= 0) {
        return 0;
    }
    return (count / charCount) * 1000;
}

/**
 * 统计一组词在文本中的总命中次数
 * @param text 文本
 * @param words 词表
 * @returns 命中总数
 */
function countWordList(text: string, words: string[]): number {
    let total = 0;
    for (const word of words) {
        total += countOccurrences(text, word);
    }
    return total;
}

/**
 * 计算一段正文的六维指标
 * @param text 章节正文
 * @returns 六维数值 + 字数、句数、对话占比等辅助信息
 */
export function computeTextMetrics(text: string): TextMetrics {
    const charCount = countCharacters(text);
    const sentences = splitSentences(text);
    const sentenceCount = sentences.length;

    // 句法复杂度：平均句长，单位是字/句
    const syntaxComplexity = sentenceCount > 0 ? charCount / sentenceCount : 0;

    // 修饰密度：每千字 的/地/得 的次数
    const modifierDensity = perThousand(countWordList(text, MODIFIER_MARKERS), charCount);

    // 抽象度：每千字抽象名词命中数
    const abstraction = perThousand(countWordList(text, ABSTRACT_NOUNS), charCount);

    // 动作密度：每千字动作动词命中数
    const actionDensity = perThousand(countWordList(text, ACTION_VERBS), charCount);

    // 不确定性：每千字模糊限定词命中数
    const uncertainty = perThousand(countWordList(text, UNCERTAINTY_WORDS), charCount);

    // 留白指数：每千字省略号/破折号/问号数量
    const blankSpace = perThousand(countWordList(text, BLANK_MARKERS), charCount);

    // 对话占比：引号内的字数 / 总字数
    // 不能按"整句是否以引号开头"算，因为对话常被切成「说，"……"」这种跨句形式
    let dialogueChars = 0;
    for (const match of text.matchAll(/[“"]([^“”"]*)[”"]/g)) {
        dialogueChars += countCharacters(match[1]);
    }
    const dialogueRatio = charCount > 0 ? dialogueChars / charCount : 0;

    return {
        syntaxComplexity,
        modifierDensity,
        abstraction,
        actionDensity,
        uncertainty,
        blankSpace,
        charCount,
        sentenceCount,
        dialogueRatio,
    };
}

/**
 * 把指标四舍五入到两位小数，界面展示和快照落盘都用这个
 * @param metrics 原始指标
 * @returns 处理后的指标
 */
export function roundMetrics(metrics: TextMetrics): TextMetrics {
    const round = (value: number): number => Math.round(value * 100) / 100;
    return {
        syntaxComplexity: round(metrics.syntaxComplexity),
        modifierDensity: round(metrics.modifierDensity),
        abstraction: round(metrics.abstraction),
        actionDensity: round(metrics.actionDensity),
        uncertainty: round(metrics.uncertainty),
        blankSpace: round(metrics.blankSpace),
        charCount: metrics.charCount,
        sentenceCount: metrics.sentenceCount,
        dialogueRatio: round(metrics.dialogueRatio),
    };
}
