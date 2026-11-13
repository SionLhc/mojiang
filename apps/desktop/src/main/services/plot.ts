/**
 * 剧情图读写
 * 存 `书库/{书名}/剧情.json`，和账本、伏笔同一套机制。
 */

import type { PlotGraph } from '@mojiang/core';
import { readJsonFile, writeJsonFile } from './content';
import { logInfo } from './logger';

/** 文件名 */
const PLOT_FILE = '剧情.json';

/**
 * 读剧情图，没有就返回空图
 * @param bookId 书 id
 * @returns 剧情图
 */
export async function readPlot(bookId: string): Promise<PlotGraph> {
    return readJsonFile<PlotGraph>(bookId, PLOT_FILE, {
        nodes: [],
        edges: [],
        updatedAt: new Date().toISOString(),
    });
}

/**
 * 写剧情图
 * @param bookId 书 id
 * @param graph 剧情图
 */
export async function writePlot(bookId: string, graph: PlotGraph): Promise<void> {
    await writeJsonFile(bookId, PLOT_FILE, {
        nodes: graph.nodes,
        edges: graph.edges,
        updatedAt: new Date().toISOString(),
    });
    logInfo('保存剧情图', { bookId, nodes: graph.nodes.length, edges: graph.edges.length });
}
