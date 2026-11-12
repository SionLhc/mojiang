/**
 * 市场调研：榜单数据的结构与文本解析
 * 这里只做纯文本处理，不抓网络。抓取在主进程，解析规则放这里方便单独验证。
 *
 * 设计原则：只记录事实。工具不替作者判断"该写什么"，也不猜缺失的数据。
 */

import { splitWords } from './text/segment';

/** 榜单里的一条 */
export interface MarketEntry {
    /** 排名，从 1 开始 */
    rank: number;
    title: string;
    author?: string;
    /** 附加信息，比如字数、月票 */
    extra?: string;
}

/** 快照来源类型 */
export type SnapshotStatus = 'ok' | 'degraded' | 'manual';

/** 一个平台的抓取结果 */
export interface PlatformSnapshot {
    /** 平台名，如"起点" */
    platform: string;
    /** 来源地址 */
    url: string;
    /**
     * ok：抓取并解析成功
     * degraded：抓到了页面但解析不出，或者压根没抓到
     * manual：作者手动粘贴
     */
    status: SnapshotStatus;
    /** HTTP 状态码，0 表示网络层就失败了 */
    httpStatus?: number;
    entries: MarketEntry[];
    /** 人话说明：失败了为什么、缺了什么 */
    note?: string;
    fetchedAt: string;
}

/** 一次调研的全部数据 */
export interface MarketReport {
    snapshots: PlatformSnapshot[];
    generatedAt: string;
}

/** 书名最大长度，超过这个基本是误抓的广告或导航 */
const MAX_TITLE_LENGTH = 40;

/** 统计高频词时跳过的词 */
const STOP_WORDS = new Set([
    '我的', '我们', '他们', '这个', '那个', '什么', '怎么', '一个', '没有', '不是',
    '就是', '可以', '因为', '所以', '但是', '而且', '然后', '开始', '最后', '时候',
]);

/**
 * 解析作者从浏览器复制来的榜单文本
 * 规则尽量宽松：排名有就去掉，没就用行号；书名和作者之间认制表符、竖线、两个以上空格
 * @param text 粘贴的文本
 * @returns 解析出的条目
 */
export function parseRankingText(text: string): MarketEntry[] {
    const entries: MarketEntry[] = [];

    for (const rawLine of text.split('\n')) {
        const line = rawLine.trim();
        if (line.length === 0) {
            continue;
        }

        // 去掉开头的排名：1. / 1、/ 第1名 / (1) 都认
        const withoutRank = line
            .replace(/^[（(]?\s*第?\s*\d+\s*[）)]?\s*[名位]?\s*[.、,，:：\-—]?\s*/, '')
            .trim();
        if (withoutRank.length === 0 || /^\d+$/.test(withoutRank)) {
            continue;
        }

        // 制表符、竖线、两个以上空格都当分隔符
        const parts = withoutRank
            .split(/\t+|\s*[|｜]\s*|\s{2,}/)
            .map((part) => part.trim())
            .filter((part) => part.length > 0);

        let title = parts[0] ?? '';
        let author = parts[1];
        let extra = parts[2];

        // 只有一段时，试着按最后一个空格拆出作者
        if (parts.length === 1 && title.includes(' ')) {
            const lastSpace = title.lastIndexOf(' ');
            const maybeAuthor = title.slice(lastSpace + 1).trim();
            if (maybeAuthor.length >= 2 && maybeAuthor.length <= 8 && !maybeAuthor.includes(' ')) {
                author = maybeAuthor;
                title = title.slice(0, lastSpace).trim();
            }
        }

        if (title.length < 2 || title.length > MAX_TITLE_LENGTH) {
            continue;
        }
        // 纯标点或纯英文的通常是导航项，不要
        if (!/[\u4e00-\u9fa5a-zA-Z]/.test(title)) {
            continue;
        }

        entries.push({
            rank: entries.length + 1,
            title,
            author: author && author.length > 0 ? author : undefined,
            extra: extra && extra.length > 0 ? extra : undefined,
        });
    }

    return entries;
}

/**
 * 统计书名里的高频词
 * @param titles 书名列表
 * @param limit 取前几个
 * @returns 词与出现次数
 */
export function topTitleWords(titles: string[], limit: number = 8): Array<{ word: string; count: number }> {
    const counter = new Map<string, number>();

    for (const title of titles) {
        for (const word of splitWords(title)) {
            if (word.length < 2 || STOP_WORDS.has(word)) {
                continue;
            }
            counter.set(word, (counter.get(word) ?? 0) + 1);
        }
    }

    return [...counter.entries()]
        .filter((entry) => entry[1] >= 2)
        .sort((left, right) => right[1] - left[1])
        .slice(0, limit)
        .map(([word, count]) => ({ word, count }));
}

/**
 * 生成事实观察
 * 只陈述能数出来的东西，不下结论
 * @param snapshots 各平台快照
 * @returns 观察条目
 */
export function computeObservations(snapshots: PlatformSnapshot[]): string[] {
    const observations: string[] = [];
    const okPlatforms = snapshots.filter((item) => item.status !== 'degraded' && item.entries.length > 0);
    const failedPlatforms = snapshots.filter((item) => item.entries.length === 0);

    observations.push(`本次取到 ${okPlatforms.length}/${snapshots.length} 个平台的数据`);

    const allTitles = okPlatforms.flatMap((item) => item.entries.map((entry) => entry.title));
    if (allTitles.length > 0) {
        const averageLength =
            allTitles.reduce((sum, title) => sum + title.replace(/\s/g, '').length, 0) / allTitles.length;
        observations.push(
            `书名平均 ${averageLength.toFixed(1)} 字，最短 ${Math.min(
                ...allTitles.map((title) => title.length),
            )} 字，最长 ${Math.max(...allTitles.map((title) => title.length))} 字`,
        );

        const words = topTitleWords(allTitles);
        if (words.length > 0) {
            observations.push(
                `书名高频词：${words.map((item) => `${item.word}(${item.count})`).join('、')}`,
            );
        }
    }

    if (failedPlatforms.length > 0) {
        observations.push(
            `数据缺口：${failedPlatforms.map((item) => item.platform).join('、')} 没有取到，` +
                '这些平台的结论请不要基于本次数据',
        );
    }

    return observations;
}

/**
 * 渲染 报告/市场.md
 * @param report 调研数据
 * @returns Markdown 文本
 */
export function renderMarketReport(report: MarketReport): string {
    const lines: string[] = [];

    lines.push('# 市场快照');
    lines.push('');
    lines.push(`生成时间：${report.generatedAt}`);
    lines.push('');
    lines.push(
        '> 这里只记录抓到或录入的事实，不替你下选题结论。' +
            '标了 degraded 的平台说明数据没取到，别拿它当依据。',
    );
    lines.push('');

    for (const snapshot of report.snapshots) {
        lines.push(`## ${snapshot.platform}`);
        lines.push('');
        lines.push(`- 来源：${snapshot.url}`);
        lines.push(`- 状态：${describeStatus(snapshot)}`);
        if (snapshot.httpStatus) {
            lines.push(`- HTTP：${snapshot.httpStatus}`);
        }
        if (snapshot.note) {
            lines.push(`- 说明：${snapshot.note}`);
        }
        lines.push('');

        if (snapshot.entries.length === 0) {
            lines.push('（没有数据）');
            lines.push('');
            continue;
        }

        for (const entry of snapshot.entries) {
            const author = entry.author ? ` — ${entry.author}` : '';
            const extra = entry.extra ? `（${entry.extra}）` : '';
            lines.push(`${entry.rank}. ${entry.title}${author}${extra}`);
        }
        lines.push('');
    }

    lines.push('## 事实观察');
    lines.push('');
    for (const observation of computeObservations(report.snapshots)) {
        lines.push(`- ${observation}`);
    }
    lines.push('');

    return lines.join('\n');
}

/**
 * 把状态翻译成人话
 * @param snapshot 快照
 * @returns 说明
 */
function describeStatus(snapshot: PlatformSnapshot): string {
    if (snapshot.status === 'ok') {
        return `抓到 ${snapshot.entries.length} 条`;
    }
    if (snapshot.status === 'manual') {
        return `手动录入 ${snapshot.entries.length} 条`;
    }
    return '未取到（degraded）';
}
