/**
 * AI 对话：解析回复里的选项块
 *
 * 约定格式（系统提示里让模型照这个输出）：
 * 【选项】
 * 1. 方案一
 * 2. 方案二
 *
 * 解析后正文和选项分开：正文照常显示，选项渲染成可点按钮。
 */

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
