/**
 * 极简 Markdown 渲染
 * 只为了"对照预览"：作者写 Markdown，右边看到大致排版效果。
 * 不是通用解析器——只覆盖写作里常用的那些语法，复杂语法宁可原样显示也不猜。
 *
 * 安全：先转义 HTML，再处理标记，所以文档里写 <script> 也不会被执行。
 */

import { parseFrontMatter } from './frontmatter';

/**
 * 转义 HTML 特殊字符
 * @param text 原文
 * @returns 转义后的文本
 */
function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** 行内占位符用的控制字符，正常文本里不会出现 */
const PLACEHOLDER = '\u0000';

/**
 * 处理行内标记：代码、粗体、斜体、链接
 * @param text 原始行
 * @returns HTML 片段
 */
function renderInline(text: string): string {
    let output = escapeHtml(text);

    // 行内代码先抽出来，避免里面的 * 被当成强调符号
    const codes: string[] = [];
    output = output.replace(/`([^`]+)`/g, (_match, code: string) => {
        codes.push(code);
        return `${PLACEHOLDER}${codes.length - 1}${PLACEHOLDER}`;
    });

    output = output.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // 斜体要避开已被粗体吃掉的星号，只匹配单个 *
    output = output.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    output = output.replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        '<a href="$2" target="_blank" rel="noreferrer">$1</a>',
    );

    // 把代码还原回来
    output = output.replace(
        new RegExp(`${PLACEHOLDER}(\\d+)${PLACEHOLDER}`, 'g'),
        (_match, index: string) => `<code>${codes[Number(index)]}</code>`,
    );

    return output;
}

/** 列表类型 */
type ListType = 'ul' | 'ol' | null;

/**
 * 把 Markdown 渲染成 HTML
 * @param markdown 文档内容
 * @returns HTML 字符串
 */
export function renderMarkdownToHtml(markdown: string): string {
    const { body } = parseFrontMatter(markdown);
    const lines = body.split('\n');
    const blocks: string[] = [];

    let paragraph: string[] = [];
    let listType: ListType = null;
    let inCodeBlock = false;
    let codeLines: string[] = [];

    const flushParagraph = (): void => {
        if (paragraph.length === 0) {
            return;
        }
        blocks.push(`<p>${renderInline(paragraph.join(''))}</p>`);
        paragraph = [];
    };

    const flushList = (): void => {
        if (listType === null) {
            return;
        }
        blocks.push(`</${listType}>`);
        listType = null;
    };

    for (const rawLine of lines) {
        const line = rawLine.replace(/\s+$/, '');

        // 代码块：内部内容原样保留，不做任何标记处理
        if (line.trim().startsWith('```')) {
            if (inCodeBlock) {
                blocks.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
                codeLines = [];
                inCodeBlock = false;
            } else {
                flushParagraph();
                flushList();
                inCodeBlock = true;
            }
            continue;
        }
        if (inCodeBlock) {
            codeLines.push(rawLine);
            continue;
        }

        if (line.trim().length === 0) {
            flushParagraph();
            flushList();
            continue;
        }

        const heading = line.match(/^(#{1,6})\s+(.*)$/);
        if (heading) {
            flushParagraph();
            flushList();
            const level = heading[1].length;
            blocks.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`);
            continue;
        }

        if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
            flushParagraph();
            flushList();
            blocks.push('<hr/>');
            continue;
        }

        const quote = line.match(/^\s*>\s?(.*)$/);
        if (quote) {
            flushParagraph();
            flushList();
            blocks.push(`<blockquote>${renderInline(quote[1])}</blockquote>`);
            continue;
        }

        const unordered = line.match(/^\s*[-*+]\s+(.*)$/);
        const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
        if (unordered || ordered) {
            flushParagraph();
            const type: ListType = unordered ? 'ul' : 'ol';
            if (listType !== type) {
                flushList();
                blocks.push(`<${type}>`);
                listType = type;
            }
            blocks.push(`<li>${renderInline((unordered ?? ordered)![1])}</li>`);
            continue;
        }

        flushList();
        paragraph.push(line.trim());
    }

    if (inCodeBlock && codeLines.length > 0) {
        blocks.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
    }
    flushParagraph();
    flushList();

    return blocks.join('\n');
}
