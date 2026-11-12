/**
 * Markdown frontmatter 的极简读写
 * 只处理 tags 一项，够用即可；格式和 Obsidian 兼容，别的编辑器也认得。
 *
 * 形状：
 * ---
 * tags: 工作, 会议
 * ---
 *
 * # 标题
 * 正文
 */

/** 解析结果 */
export interface DocumentMeta {
    /** 标签 */
    tags: string[];
    /** 去掉 frontmatter 之后的正文 */
    body: string;
    /** 文件是否本来就有 frontmatter */
    hasFrontMatter: boolean;
}

/** frontmatter 块的正则，允许 \r\n */
const FRONT_MATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * 把标签行拆成数组
 * 支持 `tags: a, b` 和 `tags: [a, b]` 两种写法
 * @param raw 标签行冒号后面的内容
 * @returns 标签数组
 */
function parseTagLine(raw: string): string[] {
    const trimmed = raw.trim();
    const inner = trimmed.startsWith('[') && trimmed.endsWith(']')
        ? trimmed.slice(1, -1)
        : trimmed;
    return inner
        .split(/[,，、]/)
        .map((item) => item.trim().replace(/^["']|["']$/g, ''))
        .filter((item) => item.length > 0);
}

/**
 * 解析文档的 frontmatter
 * @param markdown 文件内容
 * @returns 标签与正文
 */
export function parseFrontMatter(markdown: string): DocumentMeta {
    const match = markdown.match(FRONT_MATTER_PATTERN);
    if (!match) {
        return { tags: [], body: markdown, hasFrontMatter: false };
    }

    const tags: string[] = [];
    for (const line of match[1].split(/\r?\n/)) {
        const tagMatch = line.match(/^\s*tags\s*:\s*(.*)$/i);
        if (tagMatch) {
            tags.push(...parseTagLine(tagMatch[1]));
        }
    }

    return {
        tags: [...new Set(tags)],
        body: markdown.slice(match[0].length),
        hasFrontMatter: true,
    };
}

/**
 * 写入标签，保留正文内容
 * 标签为空时把 frontmatter 整块去掉，避免留下空的 --- 块
 * @param markdown 原内容
 * @param tags 新标签
 * @returns 新内容
 */
export function writeTags(markdown: string, tags: string[]): string {
    const meta = parseFrontMatter(markdown);
    const cleaned = [...new Set(tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0))];

    if (cleaned.length === 0) {
        return meta.body.replace(/^\r?\n+/, '');
    }

    const block = `---\ntags: ${cleaned.join(', ')}\n---\n\n`;
    return `${block}${meta.body.replace(/^\r?\n+/, '')}`;
}

/**
 * 从正文里取标题：优先 frontmatter 之后的第一行 # 标题
 * @param markdown 文件内容
 * @param fallback 取不到时的兜底
 * @returns 标题
 */
export function pickDocumentTitle(markdown: string, fallback: string): string {
    const { body } = parseFrontMatter(markdown);
    const firstLine = body.split('\n', 1)[0]?.trim() ?? '';
    const heading = firstLine.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
        return heading[1].trim();
    }
    return fallback;
}
