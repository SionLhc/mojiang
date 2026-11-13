/**
 * 从 Markdown 里提取标题，供右侧大纲导航用
 *
 * 两个容易错的地方：
 * 1. 代码块里的 # 不是标题
 * 2. 行内代码和链接里的 # 也不是
 */

/** 大纲里的一条 */
export interface HeadingItem {
    /** 标题层级，1 表示 #，2 表示 ## */
    level: number;
    /** 去掉 # 后的标题文字 */
    text: string;
    /** 行号，从 1 开始 */
    line: number;
}

/** 只认 1-3 级标题，再深的分级在窄栏里排不下 */
const MAX_LEVEL = 3;

/**
 * 提取标题
 * @param markdown 文档内容
 * @returns 标题列表，按出现顺序
 */
export function extractHeadings(markdown: string): HeadingItem[] {
    const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
    const headings: HeadingItem[] = [];
    let inFence = false;

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];

        // 围栏代码块的开关，里面的内容一律跳过
        if (/^\s{0,3}```/.test(line)) {
            inFence = !inFence;
            continue;
        }
        if (inFence) {
            continue;
        }

        const match = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
        if (!match) {
            continue;
        }
        const level = match[1].length;
        if (level > MAX_LEVEL) {
            continue;
        }
        const text = match[2].trim();
        if (text.length === 0) {
            continue;
        }
        headings.push({ level, text, line: index + 1 });
    }

    return headings;
}

/**
 * 根据当前视口行，找出应该高亮的那一条标题
 * @param headings 标题列表
 * @param currentLine 当前视口顶部所在行
 * @returns 命中的下标，没有则 -1
 */
export function activeHeadingIndex(headings: HeadingItem[], currentLine: number): number {
    let result = -1;
    for (let index = 0; index < headings.length; index += 1) {
        if (headings[index].line <= currentLine) {
            result = index;
        } else {
            break;
        }
    }
    return result;
}
