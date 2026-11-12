/**
 * 人设卡：两个检测（OOC、千人一腔）
 * 人设卡本身存成 Markdown，末尾带一个 json 代码块，既能人读也能程序读。
 */

import type {
    CharacterCard,
    OocFinding,
    SimilarVoicePair,
    SpeechProfile,
} from './types';
import { countCharacters, splitSentences, splitWords } from './text/segment';

/** 判断"千人一腔"的相似度阈值 */
export const VOICE_SIMILARITY_THRESHOLD = 0.75;

/** 分词后的停用词，避免"的了是"这类词把声音拉近 */
const STOP_WORDS = new Set([
    '的', '了', '是', '我', '你', '他', '她', '它', '不', '也', '就', '在', '有', '和',
    '都', '说', '这', '那', '一', '个', '上', '来', '去', '着', '吗', '呢', '吧', '啊',
    '还', '又', '把', '被', '给', '对', '会', '要', '得', '很', '没', '什么', '怎么',
]);

/**
 * 创建一张空白人设卡
 * @param name 角色名
 * @returns 人设卡
 */
export function createCharacterCard(name: string): CharacterCard {
    return {
        name,
        identity: '',
        personality: [],
        flaw: '',
        speech: {
            sentenceLength: 'medium',
            catchphrases: [],
            forbiddenWords: [],
            addressToProtagonist: [],
        },
        emotionBaseline: {
            normal: '',
            triggers: [],
        },
        evolutions: [],
    };
}

/**
 * 句长档位对应的字数区间
 * @param profile 说话方式
 * @returns 期望的最短、最长句长
 */
function expectedSentenceRange(profile: SpeechProfile): { min: number; max: number } {
    if (profile.sentenceLength === 'short') {
        return { min: 2, max: 15 };
    }
    if (profile.sentenceLength === 'long') {
        return { min: 20, max: 80 };
    }
    return { min: 10, max: 35 };
}

/**
 * OOC 检测：台词是否偏离人设的说话方式
 * 只做能确定的三件事：禁用词、称呼、句长。情绪基线需要语义判断，交给 AI 深诊。
 * @param card 人设卡
 * @param lines 该角色的台词
 * @returns 问题列表
 */
export function checkOoc(card: CharacterCard, lines: string[]): OocFinding[] {
    const findings: OocFinding[] = [];
    const range = expectedSentenceRange(card.speech);

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length === 0) {
            continue;
        }

        for (const word of card.speech.forbiddenWords) {
            if (word.length > 0 && trimmed.includes(word)) {
                findings.push({
                    character: card.name,
                    line: trimmed,
                    reason: `说了语言禁区里的"${word}"`,
                    severity: 'error',
                });
            }
        }

        const length = countCharacters(trimmed);
        if (length > range.max * 1.8) {
            findings.push({
                character: card.name,
                line: trimmed,
                reason: `这句 ${length} 字，比设定的"${describeSentenceLength(card.speech.sentenceLength)}"习惯长太多`,
                severity: 'warn',
            });
        }

        // 台词里对主角用了"你"但没有出现约定称呼
        if (
            trimmed.includes('你') &&
            card.speech.addressToProtagonist.length > 0 &&
            !card.speech.addressToProtagonist.some((address) => trimmed.includes(address))
        ) {
            findings.push({
                character: card.name,
                line: trimmed,
                reason: `对着主角说话但没出现约定称呼（${card.speech.addressToProtagonist.join('、')}）`,
                severity: 'info',
            });
        }
    }

    return findings;
}

/**
 * 句长档位的中文描述
 * @param value 档位
 * @returns 中文说明
 */
function describeSentenceLength(value: SpeechProfile['sentenceLength']): string {
    const labels: Record<SpeechProfile['sentenceLength'], string> = {
        short: '短句',
        medium: '中等句长',
        long: '长句',
    };
    return labels[value];
}

/**
 * 取高频词集合，用于比较两个人的用词习惯
 * @param lines 台词
 * @param topCount 取前多少个
 * @returns 高频词
 */
function topWords(lines: string[], topCount: number = 20): Set<string> {
    const counter = new Map<string, number>();
    for (const line of lines) {
        for (const word of splitWords(line)) {
            if (word.length < 2 || STOP_WORDS.has(word)) {
                continue;
            }
            counter.set(word, (counter.get(word) ?? 0) + 1);
        }
    }
    const sorted = [...counter.entries()].sort((left, right) => right[1] - left[1]);
    return new Set(sorted.slice(0, topCount).map((entry) => entry[0]));
}

/**
 * 计算两个集合的 Jaccard 相似度
 * @param left 集合 A
 * @param right 集合 B
 * @returns 0-1
 */
function jaccard(left: Set<string>, right: Set<string>): number {
    if (left.size === 0 && right.size === 0) {
        return 1;
    }
    let intersection = 0;
    for (const item of left) {
        if (right.has(item)) {
            intersection += 1;
        }
    }
    const union = left.size + right.size - intersection;
    return union === 0 ? 0 : intersection / union;
}

/**
 * 平均句长
 * @param lines 台词
 * @returns 字数
 */
function averageSentenceLength(lines: string[]): number {
    const sentences = lines.flatMap((line) => splitSentences(line));
    if (sentences.length === 0) {
        return 0;
    }
    const total = sentences.reduce((sum, sentence) => sum + countCharacters(sentence), 0);
    return total / sentences.length;
}

/**
 * 千人一腔检测：两个角色的句长分布和高频词太接近就报警
 * @param characterA 角色 A 姓名与台词
 * @param characterB 角色 B 姓名与台词
 * @returns 相似度结论
 */
export function compareVoices(
    characterA: { name: string; lines: string[] },
    characterB: { name: string; lines: string[] },
): SimilarVoicePair {
    const wordsA = topWords(characterA.lines);
    const wordsB = topWords(characterB.lines);
    const wordSimilarity = jaccard(wordsA, wordsB);

    const lengthA = averageSentenceLength(characterA.lines);
    const lengthB = averageSentenceLength(characterB.lines);
    const maxLength = Math.max(lengthA, lengthB, 1);
    const lengthSimilarity = 1 - Math.abs(lengthA - lengthB) / maxLength;

    // 用词占六成权重，因为读者感觉"像"主要来自用词
    const similarity = Math.round((wordSimilarity * 0.6 + lengthSimilarity * 0.4) * 100) / 100;

    const tooSimilar = similarity >= VOICE_SIMILARITY_THRESHOLD;
    const message = tooSimilar
        ? `${characterA.name} 和 ${characterB.name} 的说话方式太像了（相似度 ${similarity}），给其中一人加个口头禅或改句长`
        : `${characterA.name} 和 ${characterB.name} 的说话方式有区分（相似度 ${similarity}）`;

    return {
        characterA: characterA.name,
        characterB: characterB.name,
        similarity,
        message,
    };
}

/**
 * 从正文里启发式提取某个角色的台词
 * 规则：角色名前后 40 字内的引号内容算他的台词。
 * 这是启发式，不是语义判断——旁边有人在说话时会串，所以界面上要提示作者核对。
 * @param text 正文
 * @param name 角色名
 * @returns 台词列表，已去重
 */
export function extractDialogueForCharacter(text: string, name: string): string[] {
    if (name.trim().length === 0) {
        return [];
    }
    const contextWindow = 40;

    // 先收集所有引号内容及其位置
    const quotes: Array<{ start: number; end: number; content: string }> = [];
    for (const match of text.matchAll(/[“"]([^“”"]{1,200})[”"]/g)) {
        const start = match.index ?? 0;
        quotes.push({
            start,
            end: start + match[0].length,
            content: match[1].trim(),
        });
    }

    // 再收集角色名出现的位置
    const namePositions: number[] = [];
    let cursor = text.indexOf(name);
    while (cursor !== -1) {
        namePositions.push(cursor);
        cursor = text.indexOf(name, cursor + name.length);
    }
    if (namePositions.length === 0) {
        return [];
    }

    const picked: string[] = [];
    for (const quote of quotes) {
        const nearName = namePositions.some(
            (position) =>
                Math.abs(position - quote.start) <= contextWindow ||
                Math.abs(position - quote.end) <= contextWindow,
        );
        // 台词内部提到自己名字的，不算"名字在台词附近"，避免把别人的话算进来
        if (nearName && !quote.content.includes(name)) {
            picked.push(quote.content);
        }
    }

    return [...new Set(picked)];
}

/**
 * 渲染人设卡为 Markdown
 * @param card 人设卡
 * @returns Markdown 文本
 */
export function renderCharacterMarkdown(card: CharacterCard): string {
    const lines: string[] = [`# ${card.name}`, ''];

    lines.push('## 身份与立场');
    lines.push('');
    lines.push(card.identity || '（待补）');
    lines.push('');

    lines.push('## 性格底色');
    lines.push('');
    lines.push(card.personality.length > 0 ? card.personality.map((item) => `- ${item}`).join('\n') : '- （待补）');
    if (card.flaw) {
        lines.push(`- 缺陷：${card.flaw}`);
    }
    lines.push('');

    lines.push('## 说话方式');
    lines.push('');
    lines.push(`- 句长习惯：${describeSentenceLength(card.speech.sentenceLength)}`);
    lines.push(`- 口头禅：${card.speech.catchphrases.join('、') || '（无）'}`);
    lines.push(`- 语言禁区：${card.speech.forbiddenWords.join('、') || '（无）'}`);
    lines.push(`- 对主角的称呼：${card.speech.addressToProtagonist.join('、') || '（未设定）'}`);
    lines.push('');

    lines.push('## 情绪基线');
    lines.push('');
    lines.push(`- 平时：${card.emotionBaseline.normal || '（待补）'}`);
    lines.push(`- 被什么激怒：${card.emotionBaseline.triggers.join('、') || '（待补）'}`);
    lines.push('');

    lines.push('## 语用演变');
    lines.push('');
    if (card.evolutions.length === 0) {
        lines.push('（暂无）');
    } else {
        for (const evolution of card.evolutions) {
            lines.push(`- 第 ${evolution.chapter} 章：因为${evolution.reason}，${evolution.change}`);
        }
    }
    lines.push('');

    lines.push('<!-- 下面这个块是程序读的数据，改上面的文字不影响它，反之亦然 -->');
    lines.push('```json');
    lines.push(JSON.stringify(card, null, 4));
    lines.push('```');
    lines.push('');

    return lines.join('\n');
}

/**
 * 从 Markdown 里解析人设卡
 * 优先读 json 代码块，读不到就返回 null，不做不可靠的文本猜测
 * @param markdown 文件内容
 * @returns 人设卡或 null
 */
export function parseCharacterMarkdown(markdown: string): CharacterCard | null {
    const match = markdown.match(/```json\s*([\s\S]*?)```/);
    if (!match) {
        return null;
    }
    try {
        const parsed = JSON.parse(match[1]) as CharacterCard;
        if (!parsed || typeof parsed.name !== 'string') {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}
