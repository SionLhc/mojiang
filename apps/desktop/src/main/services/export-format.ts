/**
 * 导出格式生成
 * 这里只做纯字符串拼装，不碰文件系统，方便单独验证。
 */

import { createZip } from './zip';

/** 正文解析后的一个块 */
export interface TextBlock {
    type: 'heading' | 'paragraph';
    /** 标题层级，普通段落为 0 */
    level: number;
    text: string;
}

/** 待导出的一章 */
export interface ExportChapter {
    index: number;
    title: string;
    blocks: TextBlock[];
}

/** 书的基本信息 */
export interface ExportBookMeta {
    title: string;
    genre: string;
    author: string;
}

/**
 * 去掉行内 Markdown 标记
 * 只处理写作里常用的几种，不做完整 Markdown 解析
 * @param text 原始文本
 * @returns 纯文本
 */
function stripInline(text: string): string {
    return text
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/\*(.+?)\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

/**
 * 把一章 Markdown 拆成标题和段落
 * 规则：空行分段，`#` 开头是标题，其余按行合并成一段
 * @param markdown 章节内容
 * @returns 文本块
 */
export function markdownToBlocks(markdown: string): TextBlock[] {
    const blocks: TextBlock[] = [];
    let buffer: string[] = [];

    const flush = (): void => {
        if (buffer.length === 0) {
            return;
        }
        blocks.push({ type: 'paragraph', level: 0, text: stripInline(buffer.join('')) });
        buffer = [];
    };

    for (const rawLine of markdown.split('\n')) {
        const line = rawLine.trim();
        if (line.length === 0) {
            flush();
            continue;
        }
        const heading = line.match(/^(#{1,6})\s+(.*)$/);
        if (heading) {
            flush();
            blocks.push({
                type: 'heading',
                level: heading[1].length,
                text: stripInline(heading[2].trim()),
            });
            continue;
        }
        buffer.push(line);
    }
    flush();

    return blocks;
}

/**
 * 取一章的标题，取不到就用章节号兜底
 * @param blocks 文本块
 * @param index 章节号
 * @returns 标题
 */
export function pickChapterTitle(blocks: TextBlock[], index: number): string {
    const heading = blocks.find((block) => block.type === 'heading');
    return heading?.text ?? `第 ${index} 章`;
}

/**
 * 只保留正文段落，去掉第一个标题（标题单独渲染）
 * @param blocks 文本块
 * @returns 内容块
 */
function bodyBlocks(blocks: TextBlock[]): TextBlock[] {
    let skippedTitle = false;
    const result: TextBlock[] = [];
    for (const block of blocks) {
        if (!skippedTitle && block.type === 'heading') {
            skippedTitle = true;
            continue;
        }
        result.push(block);
    }
    return result;
}

/**
 * 生成整本 txt
 * @param meta 书信息
 * @param chapters 章节
 * @returns 纯文本
 */
export function buildPlainText(meta: ExportBookMeta, chapters: ExportChapter[]): string {
    const lines: string[] = [`《${meta.title}》`, ''];
    if (meta.genre) {
        lines.push(`题材：${meta.genre}`, '');
    }
    lines.push(`共 ${chapters.length} 章`, '');

    for (const chapter of chapters) {
        lines.push('', '　　　　＊　　　　＊　　　　＊', '');
        lines.push(chapter.title, '');
        for (const block of bodyBlocks(chapter.blocks)) {
            if (block.type === 'heading') {
                lines.push(block.text, '');
                continue;
            }
            lines.push(block.text, '');
        }
    }

    return lines.join('\n');
}

/**
 * XML 转义，顺手去掉 XML 不允许的控制字符
 * @param text 原文
 * @returns 转义后的文本
 */
function escapeXml(text: string): string {
    return text
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/** 正文用的字体设置，宋体最接近纸质阅读 */
const FONT_PROPS = '<w:rFonts w:ascii="宋体" w:eastAsia="宋体" w:hAnsi="宋体"/>';

/**
 * 生成一个 docx 段落
 * @param text 文本
 * @param options 格式
 * @returns WordprocessingML 片段
 */
function docxParagraph(
    text: string,
    options: { size?: number; bold?: boolean; center?: boolean; indent?: boolean } = {},
): string {
    const paragraphProps: string[] = [];
    if (options.center) {
        paragraphProps.push('<w:jc w:val="center"/>');
    }
    if (options.indent) {
        // firstLineChars 是"首行缩进几个字符"，firstLine 是兜底 twips
        paragraphProps.push('<w:ind w:firstLineChars="200" w:firstLine="420"/>');
    }

    const runProps: string[] = [FONT_PROPS];
    if (options.bold) {
        runProps.push('<w:b/><w:bCs/>');
    }
    if (options.size) {
        runProps.push(`<w:sz w:val="${options.size}"/><w:szCs w:val="${options.size}"/>`);
    }

    const propsXml = paragraphProps.length > 0 ? `<w:pPr>${paragraphProps.join('')}</w:pPr>` : '';
    return `<w:p>${propsXml}<w:r><w:rPr>${runProps.join('')}</w:rPr><w:t xml:space="preserve">${escapeXml(
        text,
    )}</w:t></w:r></w:p>`;
}

/**
 * 生成 docx 文件
 * @param meta 书信息
 * @param chapters 章节
 * @returns docx 二进制
 */
export function buildDocx(meta: ExportBookMeta, chapters: ExportChapter[]): Buffer {
    const body: string[] = [];

    // 封面标题
    body.push(docxParagraph(meta.title, { size: 52, bold: true, center: true }));
    if (meta.genre) {
        body.push(docxParagraph(meta.genre, { size: 24, center: true }));
    }
    body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');

    chapters.forEach((chapter, position) => {
        body.push(docxParagraph(chapter.title, { size: 36, bold: true, center: true }));
        for (const block of bodyBlocks(chapter.blocks)) {
            if (block.type === 'heading') {
                body.push(docxParagraph(block.text, { size: 28, bold: true }));
                continue;
            }
            body.push(docxParagraph(block.text, { indent: true }));
        }
        // 最后一章不加分页，避免多出一张空白页
        if (position < chapters.length - 1) {
            body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
        }
    });

    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1701" w:bottom="1440" w:left="1701" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr></w:body>
</w:document>`;

    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;

    const relationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

    return createZip([
        { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
        { name: '_rels/.rels', data: Buffer.from(relationships, 'utf8') },
        { name: 'word/document.xml', data: Buffer.from(documentXml, 'utf8') },
    ]);
}

/**
 * 生成一章的 XHTML
 * @param chapter 章节
 * @returns XHTML
 */
function chapterXhtml(chapter: ExportChapter): string {
    const parts: string[] = [`<h1>${escapeXml(chapter.title)}</h1>`];
    for (const block of bodyBlocks(chapter.blocks)) {
        if (block.type === 'heading') {
            parts.push(`<h2>${escapeXml(block.text)}</h2>`);
            continue;
        }
        parts.push(`<p>${escapeXml(block.text)}</p>`);
    }

    return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh-CN" lang="zh-CN">
<head><meta charset="utf-8"/><title>${escapeXml(chapter.title)}</title><link rel="stylesheet" type="text/css" href="../style.css"/></head>
<body>${parts.join('\n')}</body>
</html>`;
}

/**
 * 生成 epub 文件
 * @param meta 书信息
 * @param chapters 章节
 * @returns epub 二进制
 */
export function buildEpub(meta: ExportBookMeta, chapters: ExportChapter[]): Buffer {
    const bookId = `urn:mojiang:${encodeURIComponent(meta.title)}`;
    const modified = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

    const css = `body { font-family: serif; line-height: 1.8; }
h1 { font-size: 1.4em; text-align: center; margin: 1.6em 0 1.2em; }
h2 { font-size: 1.15em; margin: 1.2em 0 0.6em; }
p { text-indent: 2em; margin: 0.5em 0; }`;

    const navItems = chapters
        .map(
            (chapter) =>
                `<li><a href="text/chapter-${String(chapter.index).padStart(3, '0')}.xhtml">${escapeXml(
                    chapter.title,
                )}</a></li>`,
        )
        .join('');

    const navXhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh-CN" lang="zh-CN">
<head><meta charset="utf-8"/><title>目录</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body><nav epub:type="toc" id="toc"><h1>目录</h1><ol>${navItems}</ol></nav></body>
</html>`;

    const navPoints = chapters
        .map(
            (chapter, position) =>
                `<navPoint id="nav-${position + 1}" playOrder="${position + 1}"><navLabel><text>${escapeXml(
                    chapter.title,
                )}</text></navLabel><content src="text/chapter-${String(chapter.index).padStart(
                    3,
                    '0',
                )}.xhtml"/></navPoint>`,
        )
        .join('');

    const tocNcx = `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="${bookId}"/><meta name="dtb:depth" content="1"/><meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head><docTitle><text>${escapeXml(
        meta.title,
    )}</text></docTitle><navMap>${navPoints}</navMap></ncx>`;

    const manifestItems = chapters
        .map(
            (chapter) =>
                `<item id="ch${chapter.index}" href="text/chapter-${String(chapter.index).padStart(
                    3,
                    '0',
                )}.xhtml" media-type="application/xhtml+xml"/>`,
        )
        .join('');

    const spineItems = chapters.map((chapter) => `<itemref idref="ch${chapter.index}"/>`).join('');

    // 作者没填就别输出空的 dc:creator，有些阅读器会因此报错
    const creatorXml = meta.author.trim().length > 0
        ? `<dc:creator>${escapeXml(meta.author)}</dc:creator>`
        : '';
    const subjectXml = meta.genre.trim().length > 0
        ? `<dc:subject>${escapeXml(meta.genre)}</dc:subject>`
        : '';

    const contentOpf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="zh-CN">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">${bookId}</dc:identifier><dc:title>${escapeXml(
        meta.title,
    )}</dc:title><dc:language>zh-CN</dc:language>${creatorXml}${subjectXml}<meta property="dcterms:modified">${modified}</meta></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="css" href="style.css" media-type="text/css"/>${manifestItems}</manifest>
<spine toc="ncx">${spineItems}</spine>
</package>`;

    const containerXml = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;

    const entries = [
        // mimetype 必须是包内第一个文件，且不压缩，否则阅读器不认
        { name: 'mimetype', data: Buffer.from('application/epub+zip', 'utf8'), store: true },
        { name: 'META-INF/container.xml', data: Buffer.from(containerXml, 'utf8') },
        { name: 'OEBPS/content.opf', data: Buffer.from(contentOpf, 'utf8') },
        { name: 'OEBPS/nav.xhtml', data: Buffer.from(navXhtml, 'utf8') },
        { name: 'OEBPS/toc.ncx', data: Buffer.from(tocNcx, 'utf8') },
        { name: 'OEBPS/style.css', data: Buffer.from(css, 'utf8') },
        ...chapters.map((chapter) => ({
            name: `OEBPS/text/chapter-${String(chapter.index).padStart(3, '0')}.xhtml`,
            data: Buffer.from(chapterXhtml(chapter), 'utf8'),
        })),
    ];

    return createZip(entries);
}
