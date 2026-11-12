/**
 * 榜单抓取
 * 现实情况：这些站点的页面结构随时会变，反爬也会越来越严。
 * 所以这里的策略是"尽力抓、抓不到就说明白"，绝不编数据。
 */

import { writeTextFile } from './content';
import { logInfo, logWarn } from './logger';
import { describeNetworkError } from '@mojiang/llm';
import type { MarketEntry, PlatformSnapshot } from '@mojiang/core';

/** 单个平台的抓取配置 */
interface PlatformConfig {
    /** 文件名用的短 id */
    id: string;
    /** 展示名 */
    name: string;
    /** 榜单地址 */
    url: string;
    /** 书籍详情页链接的特征，用来从 HTML 里挑出书名 */
    hrefPattern: string;
    /** 已知的坑，抓取成功也要写进报告 */
    caveat?: string;
}

/**
 * 五个平台的配置
 * hrefPattern 挑的是"书籍详情页链接"，比 class 名稳定得多
 */
const PLATFORMS: PlatformConfig[] = [
    {
        id: 'qidian',
        name: '起点',
        url: 'https://www.qidian.com/rank/yuepiao/',
        hrefPattern: 'book\\.qidian\\.com/info/',
    },
    {
        id: 'jjwxc',
        name: '晋江',
        url: 'https://www.jjwxc.net/topten.php?orderstr=1',
        hrefPattern: 'onebook\\.php\\?novelid=',
    },
    {
        id: 'qimao',
        name: '七猫',
        url: 'https://www.qimao.com/paihang/',
        hrefPattern: '/book/\\d+',
    },
    {
        id: 'faloo',
        name: '飞卢',
        url: 'https://b.faloo.com/',
        hrefPattern: 'b\\.faloo\\.com/\\d+\\.html',
        caveat: '飞卢取的是首页推荐位，不是官方榜单，排序只代表页面位置',
    },
    {
        id: 'fanqie',
        name: '番茄',
        url: 'https://fanqienovel.com/rank',
        hrefPattern: '/page/\\d+',
        caveat: '番茄对书名做了字体混淆，即使抓到条目，书名也可能缺字，只作参考',
    },
];

/** 每个平台最多取多少条 */
const MAX_ENTRIES = 20;
/** 超时毫秒数 */
const TIMEOUT_MS = 10_000;
/** 单页最多读多少字符，防止被超大响应拖死 */
const MAX_HTML_SIZE = 3_000_000;

/** 抓取结果 */
interface FetchResult {
    ok: boolean;
    status: number;
    html: string;
    error?: string;
}

/** 伪装成普通浏览器，否则很多站直接 403 */
const REQUEST_HEADERS: Record<string, string> = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
};

/**
 * 把各种 charset 归一成 TextDecoder 认的名字
 * 国内老站点大量用 gb2312/gbk，直接甩给 TextDecoder 会抛错
 * @param charset 页面声明的编码
 * @returns 归一后的编码名
 */
function normalizeCharset(charset: string): string {
    const lower = charset.trim().toLowerCase();
    if (lower === 'gb2312' || lower === 'gbk' || lower === 'gb18030') {
        return 'gbk';
    }
    return lower;
}

/**
 * 猜页面编码
 * 先看响应头，再看 HTML 前 2KB 里的 meta，都没有就按 UTF-8
 * @param contentType 响应头的 Content-Type
 * @param buffer 原始字节
 * @returns 编码名
 */
function detectCharset(contentType: string | null, buffer: Buffer): string {
    const headerMatch = contentType?.match(/charset=["']?([\w-]+)/i);
    if (headerMatch) {
        return normalizeCharset(headerMatch[1]);
    }
    // 用 latin1 读前 2KB，只为找 meta 标签，不影响正文
    const head = buffer.subarray(0, 2048).toString('latin1');
    const metaMatch = head.match(/<meta[^>]+charset=["']?([\w-]+)/i);
    if (metaMatch) {
        return normalizeCharset(metaMatch[1]);
    }
    return 'utf-8';
}

/**
 * 抓一个页面
 * @param url 地址
 * @returns 结果，失败时带上原因
 */
async function fetchPage(url: string): Promise<FetchResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const response = await fetch(url, {
            headers: REQUEST_HEADERS,
            signal: controller.signal,
            redirect: 'follow',
        });
        if (!response.ok) {
            return { ok: false, status: response.status, html: '', error: `HTTP ${response.status}` };
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        const charset = detectCharset(response.headers.get('content-type'), buffer);

        let html: string;
        try {
            html = new TextDecoder(charset).decode(buffer);
        } catch {
            // 编码不支持就退回 UTF-8，至少不是崩掉
            html = buffer.toString('utf-8');
        }

        return { ok: true, status: response.status, html: html.slice(0, MAX_HTML_SIZE) };
    } catch (error) {
        return { ok: false, status: 0, html: '', error: describeNetworkError(error) };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * 去掉标签，只留文字
 * @param html 片段
 * @returns 纯文本
 */
function stripTags(html: string): string {
    return html
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * 从 HTML 里按链接特征提取书名
 * @param html 页面
 * @param hrefPattern 链接正则（不带 g 标志）
 * @returns 去重后的书名，按出现顺序
 */
function extractTitles(html: string, hrefPattern: string): string[] {
    const pattern = new RegExp(hrefPattern);
    const titles: string[] = [];
    const seen = new Set<string>();

    for (const match of html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
        if (!pattern.test(match[1])) {
            continue;
        }
        const text = stripTags(match[2]);
        // 太长的是简介，太短的是"更多"，都不是书名
        if (text.length < 2 || text.length > 40) {
            continue;
        }
        if (!/[\u4e00-\u9fa5]/.test(text)) {
            continue;
        }
        // "第88章 xxx"是章节标题，飞卢这类站点会混进来
        if (/^第[\d一二三四五六七八九十百千零两]+[章节卷回]/.test(text)) {
            continue;
        }
        if (seen.has(text)) {
            continue;
        }
        seen.add(text);
        titles.push(text);
    }

    return titles;
}

/**
 * 抓一个平台
 * @param platform 平台配置
 * @param bookId 书 id，用于保存原始响应
 * @returns 快照
 */
async function fetchPlatform(platform: PlatformConfig, bookId: string): Promise<PlatformSnapshot> {
    const fetchedAt = new Date().toISOString();
    const response = await fetchPage(platform.url);

    if (!response.ok) {
        logWarn('榜单抓取失败', { platform: platform.name, error: response.error });
        return {
            platform: platform.name,
            url: platform.url,
            status: 'degraded',
            httpStatus: response.status,
            entries: [],
            note: `${response.error ?? '抓取失败'}。可以手动复制榜单，用下面的"手动录入"贴进来。`,
            fetchedAt,
        };
    }

    const titles = extractTitles(response.html, platform.hrefPattern);
    if (titles.length === 0) {
        // 抓到了但解析不出，把原始页面存下来，日后好修解析规则
        const rawPath = `报告/原始/${platform.id}.html`;
        try {
            await writeTextFile(bookId, rawPath, response.html);
        } catch (error) {
            logWarn('保存原始响应失败', { platform: platform.name, error });
        }
        logWarn('榜单解析为空', { platform: platform.name, bytes: response.html.length });
        return {
            platform: platform.name,
            url: platform.url,
            status: 'degraded',
            httpStatus: response.status,
            entries: [],
            note: `页面抓到了（${response.html.length} 字符）但没解析出书名，页面结构可能改版了。原始响应存在 ${rawPath}。`,
            fetchedAt,
        };
    }

    const entries: MarketEntry[] = titles.slice(0, MAX_ENTRIES).map((title, index) => ({
        rank: index + 1,
        title,
    }));

    logInfo('榜单抓取成功', { platform: platform.name, count: entries.length });
    return {
        platform: platform.name,
        url: platform.url,
        status: 'ok',
        httpStatus: response.status,
        entries,
        note: platform.caveat,
        fetchedAt,
    };
}

/**
 * 并行抓取全部平台
 * 单个平台失败不影响其他，全失败也只是返回一堆 degraded
 * @param bookId 书 id
 * @returns 各平台快照
 */
export async function fetchMarketSnapshots(bookId: string): Promise<PlatformSnapshot[]> {
    const results = await Promise.all(
        PLATFORMS.map((platform) => fetchPlatform(platform, bookId)),
    );
    return results;
}

/**
 * 把报告写入书里
 * @param bookId 书 id
 * @param markdown 报告内容
 */
export async function saveMarketReport(bookId: string, markdown: string): Promise<void> {
    await writeTextFile(bookId, '报告/市场.md', markdown);
}
