/**
 * 思维导图画板读写
 * 存 `书库/{书名}/导图.json`，和剧情图（剧情.json）完全分开：
 * 剧情画板管小说剧情，导图画板管思维导图/流程图，各存各的。
 */

import type { MindBoardGraph } from '@mojiang/core';
import { readJsonFile, writeJsonFile } from './content';
import { logInfo } from './logger';

/** 文件名 */
const MIND_BOARD_FILE = '导图.json';

/**
 * 读导图画板，没有就返回空图
 * @param bookId 书 id
 * @returns 导图画板
 */
export async function readMindBoard(bookId: string): Promise<MindBoardGraph> {
    return readJsonFile<MindBoardGraph>(bookId, MIND_BOARD_FILE, {
        nodes: [],
        edges: [],
        updatedAt: new Date().toISOString(),
    });
}

/**
 * 写导图画板
 * @param bookId 书 id
 * @param graph 导图画板
 */
export async function writeMindBoard(bookId: string, graph: MindBoardGraph): Promise<void> {
    await writeJsonFile(bookId, MIND_BOARD_FILE, {
        nodes: graph.nodes,
        edges: graph.edges,
        updatedAt: new Date().toISOString(),
    });
    logInfo('保存导图画板', { bookId, nodes: graph.nodes.length, edges: graph.edges.length });
}
