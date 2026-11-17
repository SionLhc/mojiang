/**
 * 写作上下文包
 * AI 写正文、改细纲要参考的所有料都从这里一次拿齐：
 * 当前章正文 + 当前章细纲 + 开写包（伏笔/账本/人物/文风/硬约束）+ 剧情画板摘要
 * 细纲是菜单、正文是成品，小说工具是后厨——AI 得看到全部才能做出完整判断。
 */

import { renderPlotDigest, type PlotGraph } from '@mojiang/core';
import { listChapters, readChapter, readTextFile } from './content';
import { buildWritingPackage } from './package-builder';
import { readPlot } from './plot';

/** 写作上下文包 */
export interface WritingContextPack {
    /** 当前章正文（可能为空，新书还没写） */
    body: string;
    /** 当前章细纲（同章优先，没有就取第一篇/大纲） */
    outline: string;
    /** 开写包各项：上一章衔接、出场人物、待回收伏笔、账本摘要、文风、硬约束等 */
    items: Array<{ key: string; label: string; content: string }>;
    /** 剧情画板摘要（最近节点 + 类型 + 连线） */
    plot: string;
    /** 当前章节序号，0 表示没定位到 */
    chapterNumber: number;
}

/**
 * 组装写作上下文包
 * @param bookId 书 id
 * @param chapterId 当前章节 id，null 时按第一章算
 * @returns 上下文包
 */
export async function buildWritingContext(
    bookId: string,
    chapterId: string | null,
): Promise<WritingContextPack> {
    const chapters = await listChapters(bookId, 'zhengwen');
    const effectiveId = chapterId ?? chapters[0]?.id ?? '';
    const chapterNumber = chapters.find((item) => item.id === effectiveId)?.index ?? 0;

    // 当前章正文
    const body = effectiveId ? (await readChapter(bookId, 'zhengwen', effectiveId)).trim() : '';

    // 细纲：同章优先，没有就取第一篇（新书通常只有「大纲」）
    let outline = '';
    const outlineList = await listChapters(bookId, 'xigang');
    if (outlineList.length > 0) {
        const sameChapter = outlineList.find((item) => item.id === effectiveId);
        const target = sameChapter ?? outlineList[0];
        outline = (await readTextFile(bookId, `细纲/${target.id}.md`)).trim();
    }

    // 开写包：伏笔/账本/人物/文风/硬约束都在里面；细纲上面单独给，去掉避免重复
    let items: WritingContextPack['items'] = [];
    if (effectiveId.length > 0) {
        try {
            const pack = await buildWritingPackage(bookId, effectiveId);
            items = pack.items
                .filter((item) => item.key !== 'beatSheet' && item.content.trim().length > 0)
                .map((item) => ({ key: item.key, label: item.label, content: item.content }));
        } catch {
            // 开写包组装失败不影响对话，只是少带料
        }
    }

    // 剧情画板：最近节点 + 类型 + 连线，够 AI 判断故事走到哪了
    let plot = '';
    try {
        const graph: PlotGraph = await readPlot(bookId);
        plot = renderPlotDigest(graph);
    } catch {
        // 画板读不到就跳过
    }

    return { body, outline, items, plot, chapterNumber };
}
