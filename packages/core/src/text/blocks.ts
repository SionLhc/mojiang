/**
 * 把一段文字切成段落块
 * 用于"AI 写完后按段选用"：模型输出格式很随意，
 * 有空行就按空行切，全是一行一段就按换行切。
 */

/**
 * 切分段落
 * @param text 原始文本
 * @returns 段落数组，已去空行和首尾空白
 */
export function splitProseBlocks(text: string): string[] {
    const normalized = text.replace(/\r\n?/g, '\n').trim();
    if (normalized.length === 0) {
        return [];
    }

    // 有连续空行说明作者/模型用了标准段落分隔，按空行切
    const hasBlankLine = /\n\s*\n/.test(normalized);
    const parts = hasBlankLine ? normalized.split(/\n\s*\n/) : normalized.split('\n');

    return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}
