/**
 * 黄金三章诊断
 * 六项全部离线规则打分，作者可以照着改，也可以再让 AI 深诊。
 */

import type { GoldenChapterDiagnosis } from './types';
import { countCharacters, countOccurrences, isDialogueSentence, splitSentenceRanges } from './text/segment';

/** 冲突相关词，用来估冲突密度 */
const CONFLICT_WORDS = [
    '打', '杀', '退', '逼', '争', '抢', '威胁', '冷笑', '质问', '拦', '追', '逃',
    '喝', '吼', '刀', '剑', '血', '死', '拳', '撞', '摔', '绑', '债', '欠',
];

/** 场景描写开头常见的字，用来判断"开场是不是在写景" */
const SCENERY_HEAD_WORDS = ['天', '风', '云', '雨', '夜', '阳光', '月光', '空气', '街道', '山'];

/**
 * 把分数限制在 0-100
 * @param value 原始分
 * @returns 取整后的分数
 */
function clampScore(value: number): number {
    return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * 钩子强度：开头 200 字里有没有"让人想往下看"的东西
 * @param text 全章正文
 * @returns 0-100
 */
function scoreHook(text: string): number {
    const head = text.slice(0, 200);
    let score = 0;
    if (/[？?]/.test(head)) {
        score += 25;
    }
    if (CONFLICT_WORDS.some((word) => head.includes(word))) {
        score += 25;
    }
    if (/\d/.test(head) || /[《》“”]/.test(head)) {
        score += 15;
    }
    const firstSentence = splitSentenceRanges(head)[0];
    if (firstSentence && countCharacters(firstSentence.text) < 30) {
        score += 15;
    }
    if (!SCENERY_HEAD_WORDS.some((word) => head.trim().startsWith(word))) {
        score += 20;
    }
    return clampScore(score);
}

/**
 * 开场节奏：前三段平均句长越接近 18 字越顺
 * @param text 全章正文
 * @returns 0-100
 */
function scoreOpeningPace(text: string): number {
    const openingParagraphs = text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .slice(0, 3)
        .join('\n');
    const sentences = splitSentenceRanges(openingParagraphs);
    if (sentences.length === 0) {
        return 0;
    }
    const averageLength =
        sentences.reduce((sum, item) => sum + countCharacters(item.text), 0) / sentences.length;
    const deviation = Math.abs(averageLength - 18);
    return clampScore(100 - deviation * 3);
}

/**
 * 冲突密度：每千字冲突词数量，理想 3-10
 * @param text 全章正文
 * @param charCount 字数
 * @returns 0-100
 */
function scoreConflictDensity(text: string, charCount: number): number {
    if (charCount === 0) {
        return 0;
    }
    let hits = 0;
    for (const word of CONFLICT_WORDS) {
        hits += countOccurrences(text, word);
    }
    // 千字下限取 1：几百字的片段直接按千字密度算会被放大十倍，
    // 短章会莫名其妙拿 0 分
    const density = hits / Math.max(charCount / 1000, 1);
    if (density < 3) {
        return clampScore(density * 25);
    }
    if (density > 10) {
        return clampScore(100 - (density - 10) * 5);
    }
    return 100;
}

/**
 * 设定灌输比：专有名词密度过高说明在倒设定
 * 没有专有名表时用引号外长段落占比近似
 * @param text 全章正文
 * @param charCount 字数
 * @param properNouns 专有名表
 * @returns 0-100
 */
function scoreInfoDump(text: string, charCount: number, properNouns: string[]): number {
    if (charCount === 0) {
        return 0;
    }
    if (properNouns.length === 0) {
        // 没有专有名表时退化为"长段落占比"，超过 60% 扣分
        const paragraphs = text.split('\n').filter((line) => line.trim().length > 0);
        if (paragraphs.length === 0) {
            return 100;
        }
        const longParagraphs = paragraphs.filter((line) => countCharacters(line) > 200).length;
        const ratio = longParagraphs / paragraphs.length;
        return clampScore(100 - Math.max(0, ratio - 0.6) * 250);
    }
    let hits = 0;
    for (const noun of properNouns) {
        hits += countOccurrences(text, noun);
    }
    // 同样用千字下限：人物名在短章里天然密集，不能因此判成"倒设定"
    const density = hits / Math.max(charCount / 1000, 1);
    return density > 25 ? clampScore(100 - (density - 25) * 4) : 100;
}

/**
 * 对话占比得分：理想区间 25%-55%
 * @param ratio 对话字数占比
 * @returns 0-100
 */
function scoreDialogueRatio(ratio: number): number {
    if (ratio >= 0.25 && ratio <= 0.55) {
        return 100;
    }
    if (ratio < 0.25) {
        return clampScore(100 - (0.25 - ratio) * 220);
    }
    return clampScore(100 - (ratio - 0.55) * 200);
}

/**
 * 诊断一章（通常只用在第 1-3 章）
 * @param chapterNumber 章节号
 * @param title 章节标题
 * @param text 正文
 * @param wordTarget 单章字数目标
 * @param properNouns 专有名表
 * @returns 诊断结果
 */
export function diagnoseGoldenChapter(
    chapterNumber: number,
    title: string,
    text: string,
    wordTarget: number,
    properNouns: string[] = [],
): GoldenChapterDiagnosis {
    const charCount = countCharacters(text);
    const sentences = splitSentenceRanges(text);
    const dialogueChars = sentences
        .filter((item) => isDialogueSentence(item.text))
        .reduce((sum, item) => sum + countCharacters(item.text), 0);
    const dialogueRatio = charCount > 0 ? dialogueChars / charCount : 0;

    const hookStrength = scoreHook(text);
    const openingPace = scoreOpeningPace(text);
    const conflictDensity = scoreConflictDensity(text, charCount);
    const infoDumpRatio = scoreInfoDump(text, charCount, properNouns);
    const wordCountOk = charCount >= wordTarget * 0.9;
    const dialogueScore = scoreDialogueRatio(dialogueRatio);

    const notes: string[] = [];
    if (hookStrength < 60) {
        notes.push('开头 200 字里没有明确的疑问、冲突或反常，读者容易划走');
    }
    if (openingPace < 60) {
        notes.push('前三段句子偏长或偏短，读起来节奏不稳');
    }
    if (conflictDensity < 60) {
        notes.push('冲突词密度偏低，前几章需要更强的对抗张力');
    }
    if (infoDumpRatio < 70) {
        notes.push('设定信息偏密，容易变成说明书，把设定拆进动作和对话');
    }
    if (!wordCountOk) {
        notes.push(`本章 ${charCount} 字，低于目标的 90%（${Math.round(wordTarget * 0.9)} 字）`);
    }
    if (dialogueScore < 60) {
        notes.push(`对话占比 ${Math.round(dialogueRatio * 100)}%，偏离常见区间 25%-55%`);
    }

    const score = clampScore(
        hookStrength * 0.25 +
            openingPace * 0.15 +
            conflictDensity * 0.2 +
            infoDumpRatio * 0.15 +
            dialogueScore * 0.15 +
            (wordCountOk ? 100 : 40) * 0.1,
    );

    return {
        chapterNumber,
        title,
        hookStrength,
        openingPace,
        conflictDensity,
        infoDumpRatio,
        wordCountOk,
        dialogueRatio: Math.round(dialogueRatio * 100) / 100,
        score,
        notes,
    };
}
