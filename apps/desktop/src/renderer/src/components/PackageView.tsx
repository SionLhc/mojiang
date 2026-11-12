import { useCallback, useEffect, useState } from 'react';
import {
    packageCompleteness,
    renderWritingPackagePrompt,
    type WritingPackage,
} from '@mojiang/core';
import { errorMessage } from '@/lib/format';
import { useAppStore } from '@/store/useAppStore';

/**
 * 开写包视图
 * 16 项一次取齐，缺的项直接把补救方法写出来——不假装有
 */
export default function PackageView() {
    const book = useAppStore((state) => state.book);
    const chapterId = useAppStore((state) => state.chapterId);
    const chapters = useAppStore((state) => state.chapters);
    const setPendingPrompt = useAppStore((state) => state.setPendingPrompt);
    const setRightTab = useAppStore((state) => state.setRightTab);
    const pushToast = useAppStore((state) => state.pushToast);

    const [pack, setPack] = useState<WritingPackage | null>(null);
    const [loading, setLoading] = useState(false);
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});

    const chapter = chapters.find((item) => item.id === chapterId);

    /**
     * 组装一次开写包
     */
    const load = useCallback(async (): Promise<void> => {
        if (!book || !chapterId) {
            setPack(null);
            return;
        }
        setLoading(true);
        try {
            const result = await window.api.writingPackage.build(book.id, chapterId);
            setPack(result);
        } catch (error) {
            pushToast('error', errorMessage(error));
        } finally {
            setLoading(false);
        }
    }, [book, chapterId, pushToast]);

    useEffect(() => {
        void load();
    }, [load]);

    /**
     * 展开/收起某一项
     * @param key 项 key
     */
    function toggle(key: string): void {
        setExpanded((previous) => ({ ...previous, [key]: !previous[key] }));
    }

    /**
     * 复制整包提示词
     */
    async function copyPrompt(): Promise<void> {
        if (!pack) {
            return;
        }
        try {
            await navigator.clipboard.writeText(renderWritingPackagePrompt(pack));
            pushToast('success', '已复制到剪贴板');
        } catch {
            pushToast('error', '复制失败，可能是系统剪贴板被占用');
        }
    }

    /**
     * 把整包塞进 AI 输入框，作者补一句指令就能发
     */
    function sendToChat(): void {
        if (!pack) {
            return;
        }
        setPendingPrompt(renderWritingPackagePrompt(pack));
        setRightTab('chat');
        pushToast('info', '开写包已放进输入框，补一句你要它做什么再发送');
    }

    if (!book || !chapterId) {
        return (
            <main className="flex flex-1 items-center justify-center text-sm text-ink-500">
                先打开一章正文，再来取开写包
            </main>
        );
    }

    const completeness = pack ? packageCompleteness(pack) : 0;
    const missing = pack?.items.filter((item) => item.degradedReason).length ?? 0;

    return (
        <main className="flex min-w-0 flex-1 flex-col bg-ink-950">
            <div className="flex h-11 shrink-0 items-center justify-between border-b border-ink-800 bg-ink-900 px-4">
                <div className="flex items-center gap-3">
                    <h2 className="text-sm font-medium text-ink-100">开写包</h2>
                    <span className="text-[13px] text-ink-500">
                        {chapter?.title ?? ''} · {pack ? pack.items.length - missing : 0}/
                        {pack?.items.length ?? 16} 项齐 · 缺 {missing}
                    </span>
                </div>
                <div className="flex items-center gap-1.5">
                    <button
                        type="button"
                        className="btn-ghost text-[13px]"
                        onClick={() => void load()}
                        disabled={loading}
                    >
                        {loading ? '组装中…' : '重新组装'}
                    </button>
                    <button
                        type="button"
                        className="btn-outline text-[13px]"
                        onClick={() => void copyPrompt()}
                        disabled={!pack}
                    >
                        复制提示词
                    </button>
                    <button
                        type="button"
                        className="btn-primary text-[13px]"
                        onClick={sendToChat}
                        disabled={!pack}
                    >
                        发给 AI
                    </button>
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <div className="mx-auto max-w-3xl space-y-3">
                    {/* 完整度 */}
                    <div className="flex items-center gap-3">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-800">
                            <div
                                className="h-full rounded-full bg-jade-500 transition-all"
                                style={{ width: `${completeness * 100}%` }}
                            />
                        </div>
                        <span className="text-[13px] text-ink-400">
                            {Math.round(completeness * 100)}% 齐
                        </span>
                    </div>

                    {missing > 0 && (
                        <p className="text-[13px] leading-relaxed text-ink-500">
                            缺的项不会编，会明确告诉模型"这块没有"。想让包更全，按下面每项的补救方法去补。
                        </p>
                    )}

                    {!pack && loading && (
                        <p className="py-8 text-center text-[13px] text-ink-500">正在读取书内各文件…</p>
                    )}

                    {/* 16 项 */}
                    <ul className="space-y-1">
                        {pack?.items.map((item) => {
                            const isOpen = expanded[item.key] === true;
                            return (
                                <li
                                    key={item.key}
                                    className={`rounded-md border ${
                                        item.degradedReason
                                            ? 'border-amber-500/30 bg-amber-500/5'
                                            : 'border-ink-800 bg-ink-900'
                                    }`}
                                >
                                    <button
                                        type="button"
                                        onClick={() => toggle(item.key)}
                                        className="flex w-full items-center justify-between px-3 py-2 text-left"
                                    >
                                        <span className="text-[13px] text-ink-200">{item.label}</span>
                                        <span className="flex items-center gap-2">
                                            <span className="text-[13px] text-ink-600">
                                                {item.degradedReason
                                                    ? '缺'
                                                    : `${item.content.replace(/\s/g, '').length} 字`}
                                            </span>
                                            <span
                                                className={`text-[13px] ${
                                                    item.degradedReason ? 'text-amber-500' : 'text-jade-500'
                                                }`}
                                            >
                                                {item.degradedReason ? '待补' : '已取到'}
                                            </span>
                                            <span className="text-[13px] text-ink-600">
                                                {isOpen ? '−' : '+'}
                                            </span>
                                        </span>
                                    </button>

                                    {isOpen && (
                                        <div className="border-t border-ink-800 px-3 py-2">
                                            {item.degradedReason ? (
                                                <p className="text-[13px] leading-relaxed text-amber-400/90">
                                                    补救：{item.degradedReason}
                                                </p>
                                            ) : (
                                                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink-400">
                                                    {item.content}
                                                </pre>
                                            )}
                                        </div>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                </div>
            </div>
        </main>
    );
}
