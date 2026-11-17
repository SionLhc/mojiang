/**
 * 前情提要
 * 长篇的远程记忆：按卷把"已经发生过什么"压成几行，随书存在 前情.md。
 * 全部本地拼装，不调模型；作者可以随手改，改完保存就会用上。
 */

import { PLOT_NODE_KINDS, type PlotNode } from './plot';

/** 一卷 */
export interface RecapVolume {
    /** 起始章号 */
    from: number;
    /** 结束章号 */
    to: number;
    /** 卷内容，不含标题行 */
    body: string;
}

/** 卷标题：## 第 1-20 章 */
const VOLUME_TITLE = /^##\s*第\s*(\d+)\s*[-~－—]\s*(\d+)\s*章/;

/** 生成草稿的参数 */
export interface RecapDraftOptions {
    /** 一卷多少章 */
    perVolume?: number;
    /** 每个节点摘要最多多少字 */
    summaryChars?: number;
}

/**
 * 从 Markdown 里拆出各卷
 * @param content 前情文件内容
 * @returns 卷列表，按出现顺序
 */
export function parseRecapVolumes(content: string): RecapVolume[] {
    const volumes: RecapVolume[] = [];
    let current: RecapVolume | null = null;

    for (const rawLine of content.split('\n')) {
        const line = rawLine.trim();
        const match = VOLUME_TITLE.exec(line);
        if (match) {
            current = { from: Number(match[1]), to: Number(match[2]), body: '' };
            volumes.push(current);
            continue;
        }
        if (current && line.length > 0 && !line.startsWith('# ')) {
            current.body += (current.body.length > 0 ? '\n' : '') + line;
        }
    }

    return volumes;
}

/**
 * 取当前章之前的部分，用于注入
 * 跨当前章的那一卷也保留——它包含当前章之前已经发生的情节
 * @param content 前情文件内容
 * @param chapterNumber 当前章号
 * @returns 可直接注入的文本，没有可用内容时为空串
 */
export function clipRecapForChapter(content: string, chapterNumber: number): string {
    const trimmed = content.trim();
    if (trimmed.length === 0) {
        return '';
    }

    const volumes = parseRecapVolumes(trimmed);
    if (volumes.length === 0) {
        // 作者没按卷写，就整段带上，交给预算截断
        return trimmed;
    }

    const kept = volumes.filter((volume) => volume.from < chapterNumber && volume.body.length > 0);
    if (kept.length === 0) {
        return '';
    }

    return kept.map((volume) => `## 第 ${volume.from}-${volume.to} 章\n${volume.body}`).join('\n\n');
}

/**
 * 用剧情画板节点生成前情草稿
 * 有章号的按章号分卷，没章号的归到最后一组
 * @param nodes 画板节点
 * @param options 分卷参数
 * @returns Markdown 草稿
 */
export function renderRecapDraft(nodes: PlotNode[], options: RecapDraftOptions = {}): string {
    const perVolume = Math.max(1, options.perVolume ?? 20);
    const summaryChars = Math.max(10, options.summaryChars ?? 60);
    const kindName = new Map(PLOT_NODE_KINDS.map((item) => [item.kind, item.name]));

    /** 章号有效才参与分卷 */
    const hasChapter = (node: PlotNode): boolean =>
        typeof node.chapter === 'number' && node.chapter > 0;

    const located = nodes
        .filter(hasChapter)
        .sort((a, b) => (a.chapter as number) - (b.chapter as number));

    /**
     * 渲染一行
     * @param node 节点
     * @returns Markdown 行
     */
    const renderLine = (node: PlotNode): string => {
        const name = kindName.get(node.kind) ?? node.kind;
        const summary = node.summary.trim().slice(0, summaryChars);
        const head = hasChapter(node) ? `第 ${node.chapter} 章 ` : '';
        const tail = summary.length > 0 ? `：${summary}` : '';
        return `- ${head}【${name}】${node.title.trim()}${tail}`;
    };

    const groups = new Map<number, PlotNode[]>();
    for (const node of located) {
        const volume = Math.floor(((node.chapter as number) - 1) / perVolume);
        const list = groups.get(volume) ?? [];
        list.push(node);
        groups.set(volume, list);
    }

    const lines: string[] = [
        '# 前情提要',
        '',
        '> 写正文时会带上这份提要（只带当前章之前的部分）。可以随手改，改完保存即可。',
        '',
    ];

    for (const volume of [...groups.keys()].sort((a, b) => a - b)) {
        const from = volume * perVolume + 1;
        const to = from + perVolume - 1;
        lines.push(`## 第 ${from}-${to} 章`);
        for (const node of groups.get(volume) ?? []) {
            lines.push(renderLine(node));
        }
        lines.push('');
    }

    // 没绑章号的节点不放进来：前情是按时间线组织的，塞进去会让 AI 把时间搞错
    return `${lines.join('\n').trim()}\n`;
}
