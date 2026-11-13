/**
 * 敏感词扫描
 * 只做纯文本匹配，词库由使用者自己维护，这里不联网、不猜词。
 */

/** 一行命中 */
export interface SensitiveLine {
    /** 行号，从 1 开始 */
    line: number;
    /** 该行原文，截断到 60 字 */
    text: string;
}

/** 一个词的命中情况 */
export interface SensitiveHit {
    /** 命中的词 */
    word: string;
    /** 出现次数 */
    count: number;
    /** 命中的行，每词最多记 20 行 */
    lines: SensitiveLine[];
}

/** 默认词库：几个常见的引流词，仅作示例，随时可改 */
export const DEFAULT_SENSITIVE_WORDS = [
    '加微信',
    '加QQ',
    '私聊',
    '转账',
    '汇款',
    '代购',
    '扫码进群',
    '点击链接',
    '领取福利',
    '内部渠道',
];

/** 每个词最多记录多少行 */
const MAX_LINES_PER_WORD = 20;

/**
 * 在文本里扫描敏感词
 * @param text 要检查的正文
 * @param words 词库，空词自动忽略
 * @returns 命中列表，只含有命中的词，按出现次数降序
 */
export function scanSensitiveWords(text: string, words: string[]): SensitiveHit[] {
    // 先把词库去空去重，避免重复统计
    const uniqueWords = [...new Set(words.map((word) => word.trim()).filter((word) => word.length > 0))];
    const lines = text.split('\n');
    const hits: SensitiveHit[] = [];

    for (const word of uniqueWords) {
        let count = 0;
        const hitLines: SensitiveLine[] = [];
        // 逐行扫描，既统计次数又记位置，方便跳转
        lines.forEach((lineText, index) => {
            let position = lineText.indexOf(word);
            while (position !== -1) {
                count += 1;
                if (hitLines.length < MAX_LINES_PER_WORD && hitLines[hitLines.length - 1]?.line !== index + 1) {
                    hitLines.push({ line: index + 1, text: lineText.trim().slice(0, 60) });
                }
                position = lineText.indexOf(word, position + word.length);
            }
        });
        if (count > 0) {
            hits.push({ word, count, lines: hitLines });
        }
    }

    // 按次数降序，次数一样按词的先后
    hits.sort((a, b) => b.count - a.count);
    return hits;
}
