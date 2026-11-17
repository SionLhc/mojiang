/**
 * 文本相似度
 * 只用字符二元组（bigram）算 Jaccard，够判断"这段是原来那段改的"还是"换了一段话"。
 * 中文没有空格，按字的二元组比按词的稳定性好，也不用引分词库。
 */

/** 参与比较前先去掉的东西：标点、空白、符号 */
const NOISE = /[\s\u3000-\u303f\uff00-\uffef，。！？；：、""''（）《》……—·~!-/:-@[-`{-~]/g;

/**
 * 归一化：去标点空白，转小写
 * 全角字母数字也顺手转半角，避免"；"和";"被当成两个字
 * @param text 原文
 * @returns 归一化文本
 */
function normalize(text: string): string {
    return text
        .replace(/[\uff01-\uff5e]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
        .replace(NOISE, '')
        .toLowerCase();
}

/**
 * 取字符二元组集合
 * 只有 1 个字时用单字兜底，否则集合为空、相似度恒为 0
 * @param text 归一化后的文本
 * @returns 二元组集合
 */
function bigrams(text: string): Set<string> {
    const result = new Set<string>();
    if (text.length === 0) {
        return result;
    }
    if (text.length === 1) {
        result.add(text);
        return result;
    }
    for (let index = 0; index < text.length - 1; index += 1) {
        result.add(text.slice(index, index + 2));
    }
    return result;
}

/**
 * 两个集合的 Jaccard 相似度
 * @param left 集合一
 * @param right 集合二
 * @returns 0~1
 */
function jaccard(left: Set<string>, right: Set<string>): number {
    if (left.size === 0 || right.size === 0) {
        return 0;
    }
    let shared = 0;
    for (const item of left) {
        if (right.has(item)) {
            shared += 1;
        }
    }
    const union = left.size + right.size - shared;
    return union === 0 ? 0 : shared / union;
}

/**
 * 两段文字的相似度
 *
 * 只用二元组会把"换了一半字"的改写判成不相干（作者改稿恰恰是每处都动一点），
 * 只用字集合又完全不看语序（"他打了我"和"我打了他"会被当成一样）。
 * 所以各占一半：二元组盯语序，字集合盯用字。
 * @param left 文本一
 * @param right 文本二
 * @returns 相似度，0 表示毫无重合
 */
export function similarity(left: string, right: string): number {
    const first = normalize(left);
    const second = normalize(right);
    if (first.length === 0 || second.length === 0) {
        return 0;
    }
    if (first === second) {
        return 1;
    }

    const ordered = jaccard(bigrams(first), bigrams(second));
    const unordered = jaccard(new Set(first), new Set(second));
    return ordered * 0.5 + unordered * 0.5;
}

/**
 * 在候选里找最像的一条
 * @param target 要比对的文本
 * @param candidates 候选文本
 * @returns 最高分与下标，候选为空时分数为 0、下标 -1
 */
export function bestMatch(
    target: string,
    candidates: string[],
): { score: number; index: number } {
    let bestScore = 0;
    let bestIndex = -1;
    for (let index = 0; index < candidates.length; index += 1) {
        const score = similarity(target, candidates[index] ?? '');
        if (score > bestScore) {
            bestScore = score;
            bestIndex = index;
        }
    }
    return { score: bestScore, index: bestIndex };
}
