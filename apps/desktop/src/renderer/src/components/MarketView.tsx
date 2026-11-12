import { useState } from 'react';
import {
    parseRankingText,
    renderMarketReport,
    type MarketReport,
    type PlatformSnapshot,
} from '@mojiang/core';
import { errorMessage } from '@/lib/format';
import { useAppStore } from '@/store/useAppStore';

/** 手动录入时可选的平台，和自动抓取的对齐，加一个"其他" */
const MANUAL_PLATFORMS = ['起点', '番茄', '晋江', '七猫', '飞卢', '其他'];

/**
 * 市场调研
 * 自动抓取尽力而为，抓不到标 degraded；作者可以手动粘贴榜单补上。
 * 报告只陈述事实，不下选题结论。
 */
export default function MarketView() {
    const book = useAppStore((state) => state.book);
    const pushToast = useAppStore((state) => state.pushToast);

    const [snapshots, setSnapshots] = useState<PlatformSnapshot[]>([]);
    const [loading, setLoading] = useState(false);
    const [manualPlatform, setManualPlatform] = useState('起点');
    const [manualText, setManualText] = useState('');
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});

    if (!book) {
        return (
            <main className="flex flex-1 items-center justify-center text-sm text-ink-500">
                先打开一本书
            </main>
        );
    }

    const readyCount = snapshots.filter((item) => item.entries.length > 0).length;

    /**
     * 抓取全部平台
     */
    async function handleFetch(): Promise<void> {
        if (!book) {
            return;
        }
        setLoading(true);
        try {
            const list = await window.api.market.fetch(book.id);
            // 手动录入的保留，不被抓取结果冲掉
            setSnapshots((previous) => [
                ...list,
                ...previous.filter((item) => item.status === 'manual'),
            ]);
            const ok = list.filter((item) => item.entries.length > 0).length;
            if (ok === 0) {
                pushToast(
                    'info',
                    '一个平台都没抓到，可能是网络或反爬。可以用下面的手动录入，把浏览器里看到的榜单贴进来。',
                );
            } else {
                pushToast('success', `取到 ${ok}/${list.length} 个平台的榜单`);
            }
        } catch (error) {
            pushToast('error', errorMessage(error));
        } finally {
            setLoading(false);
        }
    }

    /**
     * 把粘贴的文本解析成榜单并加入结果
     */
    function handleManualAdd(): void {
        const entries = parseRankingText(manualText);
        if (entries.length === 0) {
            pushToast('error', '没解析出书名，检查一下粘贴的内容（支持"排名 书名 作者"这种格式）');
            return;
        }
        const snapshot: PlatformSnapshot = {
            platform: manualPlatform,
            url: '（手动录入）',
            status: 'manual',
            entries,
            note: '作者从浏览器复制粘贴的数据，不是程序抓的',
            fetchedAt: new Date().toISOString(),
        };
        setSnapshots((previous) => [
            ...previous.filter((item) => item.platform !== manualPlatform),
            snapshot,
        ]);
        setManualText('');
        pushToast('success', `${manualPlatform} 解析出 ${entries.length} 条`);
    }

    /**
     * 生成报告并写盘
     */
    async function handleSave(): Promise<void> {
        if (!book) {
            return;
        }
        if (snapshots.length === 0) {
            pushToast('info', '还没有数据，先抓取或手动录入');
            return;
        }
        try {
            const report: MarketReport = {
                snapshots,
                generatedAt: new Date().toISOString(),
            };
            await window.api.market.saveReport(book.id, renderMarketReport(report));
            pushToast('success', '报告已保存到 报告/市场.md');
        } catch (error) {
            pushToast('error', errorMessage(error));
        }
    }

    /**
     * 展开/收起某个平台
     * @param platform 平台名
     */
    function toggle(platform: string): void {
        setExpanded((previous) => ({ ...previous, [platform]: !previous[platform] }));
    }

    return (
        <main className="flex min-w-0 flex-1 flex-col bg-ink-950">
            <div className="flex h-11 shrink-0 items-center justify-between border-b border-ink-800 bg-ink-900 px-4">
                <div className="flex items-center gap-3">
                    <h2 className="text-sm font-medium text-ink-100">市场调研</h2>
                    <span className="text-[13px] text-ink-500">
                        {snapshots.length > 0 ? `取到 ${readyCount}/${snapshots.length} 个平台` : '还没有数据'}
                    </span>
                </div>
                <div className="flex items-center gap-1.5">
                    <button
                        type="button"
                        className="btn-outline text-[13px]"
                        onClick={() => void handleFetch()}
                        disabled={loading}
                    >
                        {loading ? '抓取中…' : '开始抓取'}
                    </button>
                    <button
                        type="button"
                        className="btn-primary text-[13px]"
                        onClick={() => void handleSave()}
                        disabled={snapshots.length === 0}
                    >
                        生成报告
                    </button>
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <div className="mx-auto max-w-3xl space-y-3">
                    <p className="text-[13px] leading-relaxed text-ink-500">
                        自动抓取是尽力而为：这些站点的页面结构和反爬策略随时会变，抓不到会明确标成 degraded，
                        不会拿编造的数据凑数。抓取失败时把浏览器里的榜单复制下来，用下面的手动录入补上。
                    </p>

                    {/* 手动录入 */}
                    <section className="rounded-md border border-ink-800 bg-ink-900 p-3">
                        <div className="mb-2 flex items-center gap-2">
                            <span className="text-[13px] text-ink-300">手动录入</span>
                            <select
                                className="field h-7 w-24 text-[13px]"
                                value={manualPlatform}
                                onChange={(event) => setManualPlatform(event.target.value)}
                            >
                                {MANUAL_PLATFORMS.map((name) => (
                                    <option key={name} value={name}>
                                        {name}
                                    </option>
                                ))}
                            </select>
                            <span className="text-[13px] text-ink-600">
                                支持"1 书名 作者"、"书名 | 作者"、制表符分隔
                            </span>
                        </div>
                        <textarea
                            className="field h-24 resize-none text-[13px] leading-relaxed"
                            placeholder={'1 夜的命名术 会说话的肘子\n2 大奉打更人 卖报小郎君'}
                            value={manualText}
                            onChange={(event) => setManualText(event.target.value)}
                        />
                        <div className="mt-1.5 flex justify-end">
                            <button
                                type="button"
                                className="btn-outline text-[13px]"
                                onClick={handleManualAdd}
                                disabled={manualText.trim().length === 0}
                            >
                                解析并加入
                            </button>
                        </div>
                    </section>

                    {/* 各平台结果 */}
                    {snapshots.length === 0 && !loading && (
                        <p className="py-6 text-center text-[13px] text-ink-500">
                            点右上角「开始抓取」，或者先手动录入一个平台。
                        </p>
                    )}

                    {snapshots.map((snapshot) => {
                        const isOpen = expanded[snapshot.platform] === true;
                        const visible = isOpen ? snapshot.entries : snapshot.entries.slice(0, 10);
                        return (
                            <section
                                key={snapshot.platform}
                                className="rounded-md border border-ink-800 bg-ink-900 p-3"
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <h3 className="text-[13px] font-medium text-ink-100">
                                            {snapshot.platform}
                                        </h3>
                                        <span
                                            className={`rounded px-1.5 py-0.5 text-[13px] ${
                                                snapshot.status === 'ok'
                                                    ? 'bg-jade-600/20 text-jade-400'
                                                    : snapshot.status === 'manual'
                                                      ? 'bg-ink-700 text-ink-200'
                                                      : 'bg-amber-500/15 text-amber-500'
                                            }`}
                                        >
                                            {snapshot.status === 'ok'
                                                ? `抓到 ${snapshot.entries.length} 条`
                                                : snapshot.status === 'manual'
                                                  ? `手动 ${snapshot.entries.length} 条`
                                                  : '未取到'}
                                        </span>
                                    </div>
                                    {snapshot.entries.length > 10 && (
                                        <button
                                            type="button"
                                            className="text-[13px] text-ink-500 hover:text-ink-300"
                                            onClick={() => toggle(snapshot.platform)}
                                        >
                                            {isOpen ? '收起' : `展开全部 ${snapshot.entries.length} 条`}
                                        </button>
                                    )}
                                </div>

                                {snapshot.note && (
                                    <p className="mt-1.5 text-[13px] leading-relaxed text-amber-500/90">
                                        {snapshot.note}
                                    </p>
                                )}

                                {visible.length > 0 && (
                                    <ol className="mt-2 space-y-0.5">
                                        {visible.map((entry) => (
                                            <li
                                                key={`${snapshot.platform}-${entry.rank}`}
                                                className="flex items-baseline gap-2 text-[13px]"
                                            >
                                                <span className="w-5 shrink-0 text-right text-ink-600">
                                                    {entry.rank}
                                                </span>
                                                <span className="min-w-0 flex-1 truncate text-ink-200">
                                                    {entry.title}
                                                </span>
                                                {entry.author && (
                                                    <span className="shrink-0 text-[13px] text-ink-500">
                                                        {entry.author}
                                                    </span>
                                                )}
                                            </li>
                                        ))}
                                    </ol>
                                )}
                            </section>
                        );
                    })}
                </div>
            </div>
        </main>
    );
}
