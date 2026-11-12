/**
 * 中文文本切分
 * 用浏览器/Node 内置的 Intl.Segmenter，不引入分词词表依赖。
 * Electron 的渲染进程（Chromium）和主进程（Node 20+）都支持。
 */

const sentenceSegmenter = new Intl.Segmenter('zh-CN', { granularity: 'sentence' });
const wordSegmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });

/**
 * 把整章正文切成句子
 * @param text 正文
 * @returns 去掉空白后的非空句子数组
 */
export function splitSentences(text: string): string[] {
    const result: string[] = [];
    for (const segment of sentenceSegmenter.segment(text)) {
        const trimmed = segment.segment.trim();
        if (trimmed.length > 0) {
            result.push(trimmed);
        }
    }
    return result;
}

/**
 * 带位置信息的句子切分
 * 检测器需要知道命中的句子在全文的哪个偏移，才能让编辑器高亮定位
 * @param text 正文
 * @returns 句子及其起止偏移
 */
export function splitSentenceRanges(text: string): Array<{ text: string; start: number; end: number }> {
    const ranges: Array<{ text: string; start: number; end: number }> = [];
    for (const segment of sentenceSegmenter.segment(text)) {
        const sentenceText = segment.segment;
        if (sentenceText.trim().length === 0) {
            continue;
        }
        ranges.push({
            text: sentenceText,
            start: segment.index,
            end: segment.index + sentenceText.length,
        });
    }
    return ranges;
}

/**
 * 把一段文本切成词
 * Intl.Segmenter 提供 isWordLike 标记，标点和空白会被过滤掉
 * @param text 文本
 * @returns 词数组
 */
export function splitWords(text: string): string[] {
    const result: string[] = [];
    for (const segment of wordSegmenter.segment(text)) {
        if (segment.isWordLike) {
            result.push(segment.segment);
        }
    }
    return result;
}

/**
 * 统计字数：去掉所有空白字符后的长度
 * 中文写作的"字数"惯例是不算空格和换行
 * @param text 文本
 * @returns 字数
 */
export function countCharacters(text: string): number {
    return text.replace(/\s/g, '').length;
}

/**
 * 提取所有指定词在文本中的出现次数
 * 用 indexOf 逐次推进，避免正则拼接带来的转义问题
 * @param text 文本
 * @param needle 待查找的词
 * @returns 出现次数
 */
export function countOccurrences(text: string, needle: string): number {
    if (needle.length === 0) {
        return 0;
    }
    let count = 0;
    let cursor = text.indexOf(needle);
    while (cursor !== -1) {
        count += 1;
        cursor = text.indexOf(needle, cursor + needle.length);
    }
    return count;
}

/**
 * 找出所有指定词在文本中的位置
 * 供检测器生成可点击的高亮片段
 * @param text 文本
 * @param needle 待查找的词
 * @returns 起止偏移数组
 */
export function findOccurrences(text: string, needle: string): Array<{ start: number; end: number }> {
    const ranges: Array<{ start: number; end: number }> = [];
    if (needle.length === 0) {
        return ranges;
    }
    let cursor = text.indexOf(needle);
    while (cursor !== -1) {
        ranges.push({ start: cursor, end: cursor + needle.length });
        cursor = text.indexOf(needle, cursor + needle.length);
    }
    return ranges;
}

/**
 * 判断一段话是否为对话
 * 网文里对话几乎都以引号开头，这是最稳的判定方式
 * @param sentence 句子
 * @returns 是否对话
 */
export function isDialogueSentence(sentence: string): boolean {
    return /^[“"「『]/.test(sentence.trim());
}

/**
 * 取文本开头的字符数，用作"开头钩子"分析窗口
 * @param text 文本
 * @param length 取多少字
 * @returns 截断后的文本
 */
export function takeHead(text: string, length: number): string {
    return text.slice(0, length);
}
