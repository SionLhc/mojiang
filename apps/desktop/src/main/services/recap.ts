/**
 * 前情提要读写
 * 存 `书库/{书名}/前情.md`，和账本、伏笔同一套机制：随书走，作者能看能改。
 */

import { renderRecapDraft } from '@mojiang/core';
import { listChapters, readTextFile, writeTextFile } from './content';
import { logInfo } from './logger';
import { readPlot } from './plot';

/** 文件名 */
const RECAP_FILE = '前情.md';

/** 读到的前情 */
export interface RecapFile {
    /** 内容，没有时为空串 */
    content: string;
    /** 是否已有内容 */
    exists: boolean;
}

/** 草稿生成结果 */
export interface RecapDraft {
    /** Markdown 草稿 */
    content: string;
    /** 参与整理的画板节点数（只算绑了章号的） */
    nodes: number;
    /** 已写章节数，用来提示作者 */
    chapters: number;
    /** 没绑章号、这次没纳入的节点数 */
    unlocated: number;
}

/**
 * 读前情提要
 * @param bookId 书 id
 * @returns 内容与是否存在
 */
export async function readRecap(bookId: string): Promise<RecapFile> {
    const content = (await readTextFile(bookId, RECAP_FILE)).trim();
    return { content, exists: content.length > 0 };
}

/**
 * 保存前情提要（作者手改或草稿落盘）
 * @param bookId 书 id
 * @param content 内容
 */
export async function saveRecap(bookId: string, content: string): Promise<void> {
    await writeTextFile(bookId, RECAP_FILE, content);
    logInfo('保存前情提要', { bookId, chars: content.length });
}

/**
 * 用剧情画板节点整理一份草稿
 * 纯本地拼装，不调模型，随时可重算
 * @param bookId 书 id
 * @returns 草稿与统计
 */
export async function buildRecapDraft(bookId: string): Promise<RecapDraft> {
    const graph = await readPlot(bookId);
    const chapters = await listChapters(bookId, 'zhengwen');
    const located = graph.nodes.filter(
        (node) => typeof node.chapter === 'number' && node.chapter > 0,
    );
    return {
        content: renderRecapDraft(graph.nodes),
        nodes: located.length,
        chapters: chapters.length,
        unlocated: graph.nodes.length - located.length,
    };
}
