import { useEffect, useMemo, useState } from 'react';
import { compactDiff, diffLines, summarizeDiff } from '@mojiang/core';
import type { SnapshotEntry } from '@shared/types';
import Modal from '@/components/Modal';
import { errorMessage, formatTime } from '@/lib/format';
import { useAppStore } from '@/store/useAppStore';

/** 属性 */
interface VersionDialogProps {
    open: boolean;
    onClose: () => void;
}

/**
 * 版本历史与回滚
 * 左边选快照，右边看它和"当前正文"的差异，只显示变更点附近的行
 */
export default function VersionDialog({ open, onClose }: VersionDialogProps) {
    const book = useAppStore((state) => state.book);
    const section = useAppStore((state) => state.section);
    const chapterId = useAppStore((state) => state.chapterId);
    const content = useAppStore((state) => state.content);
    const restoreSnapshot = useAppStore((state) => state.restoreSnapshot);
    const pushToast = useAppStore((state) => state.pushToast);

    const [snapshots, setSnapshots] = useState<SnapshotEntry[]>([]);
    const [selected, setSelected] = useState<string | null>(null);
    const [snapshotText, setSnapshotText] = useState('');
    const [loading, setLoading] = useState(false);

    // 打开时拉快照列表
    useEffect(() => {
        if (!open || !book || !chapterId) {
            return;
        }
        void (async () => {
            try {
                const list = await window.api.chapter.snapshots(book.id, section, chapterId);
                setSnapshots(list);
                setSelected(list.length > 0 ? list[0].fileName : null);
            } catch (error) {
                pushToast('error', errorMessage(error));
            }
        })();
    }, [open, book, section, chapterId, pushToast]);

    // 选中快照后读内容
    useEffect(() => {
        if (!book || !chapterId || !selected) {
            setSnapshotText('');
            return;
        }
        void (async () => {
            setLoading(true);
            try {
                const text = await window.api.chapter.readSnapshot(
                    book.id,
                    section,
                    chapterId,
                    selected,
                );
                setSnapshotText(text);
            } catch (error) {
                pushToast('error', errorMessage(error));
            } finally {
                setLoading(false);
            }
        })();
    }, [book, section, chapterId, selected, pushToast]);

    const diff = useMemo(() => {
        if (!snapshotText) {
            return { summary: { added: 0, removed: 0, unchanged: 0 }, lines: [] as ReturnType<typeof compactDiff> };
        }
        const lines = diffLines(snapshotText, content);
        return { summary: summarizeDiff(lines), lines: compactDiff(lines) };
    }, [snapshotText, content]);

    if (!book || !chapterId) {
        return null;
    }

    /**
     * 回滚前二次确认
     */
    function handleRestore(): void {
        if (!selected) {
            return;
        }
        const ok = window.confirm(
            `回滚到 ${formatTime(snapshotFileNameToTime(selected))} 的版本？\n\n当前正文会先存一份快照，所以这次回滚也能再撤回。`,
        );
        if (ok) {
            void restoreSnapshot(selected);
            onClose();
        }
    }

    return (
        <Modal
            open={open}
            title="版本历史"
            subtitle="每次保存前的正文都会留一份，默认保留最近 50 个"
            onClose={onClose}
            widthClass="max-w-5xl"
            footer={
                <>
                    <span className="mr-auto text-[13px] text-ink-500">
                        {diff.summary.added + diff.summary.removed === 0
                            ? '这个版本和当前正文没有差别'
                            : `相对当前正文：${diff.summary.removed} 行会被去掉，${diff.summary.added} 行会被加回`}
                    </span>
                    <button type="button" className="btn-ghost" onClick={onClose}>
                        关闭
                    </button>
                    <button
                        type="button"
                        className="btn-primary"
                        onClick={handleRestore}
                        disabled={!selected}
                    >
                        回滚到这个版本
                    </button>
                </>
            }
        >
            {snapshots.length === 0 ? (
                <p className="py-8 text-center text-[13px] text-ink-500">
                    还没有快照。保存过两次以上，这里就会出现历史版本。
                </p>
            ) : (
                <div className="flex h-[58vh] gap-3">
                    {/* 快照列表 */}
                    <ul className="w-44 shrink-0 space-y-0.5 overflow-y-auto pr-1">
                        {snapshots.map((snapshot) => (
                            <li key={snapshot.fileName}>
                                <button
                                    type="button"
                                    onClick={() => setSelected(snapshot.fileName)}
                                    className={`w-full rounded-md px-2 py-1.5 text-left text-[13px] ${
                                        selected === snapshot.fileName
                                            ? 'bg-jade-500/15 text-jade-400'
                                            : 'text-ink-300 hover:bg-ink-800'
                                    }`}
                                >
                                    <p>{formatTime(snapshot.createdAt)}</p>
                                    <p className="text-[13px] text-ink-600">
                                        {Math.round(snapshot.size / 3)} 字
                                    </p>
                                </button>
                            </li>
                        ))}
                    </ul>

                    {/* diff */}
                    <div className="min-w-0 flex-1 overflow-auto rounded-md border border-ink-800 bg-ink-950 p-2 font-mono text-[13px] leading-relaxed">
                        {loading ? (
                            <p className="p-2 text-ink-500">读取中…</p>
                        ) : diff.lines.length === 0 ? (
                            <p className="p-2 text-ink-500">没有可显示的差异</p>
                        ) : (
                            diff.lines.map((line, index) => {
                                if (line === null) {
                                    return (
                                        <div key={`gap-${index}`} className="px-2 py-0.5 text-ink-600">
                                            ⋯
                                        </div>
                                    );
                                }
                                if (line.kind === 'same') {
                                    return (
                                        <div key={index} className="px-2 text-ink-400">
                                            {line.text || ' '}
                                        </div>
                                    );
                                }
                                const isAdd = line.kind === 'add';
                                return (
                                    <div
                                        key={index}
                                        className={`px-2 ${
                                            isAdd
                                                ? 'bg-jade-600/15 text-jade-300'
                                                : 'bg-red-500/10 text-red-300'
                                        }`}
                                    >
                                        <span className="mr-2 select-none opacity-60">
                                            {isAdd ? '+' : '-'}
                                        </span>
                                        {line.text || ' '}
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            )}
        </Modal>
    );
}

/**
 * 从快照文件名里还原时间
 * 文件名形如 20261112-153012123.md
 * @param fileName 文件名
 * @returns ISO 时间字符串，解析失败返回空串
 */
function snapshotFileNameToTime(fileName: string): string {
    const match = fileName.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(\d{3})/);
    if (!match) {
        return new Date().toISOString();
    }
    const [, year, month, day, hour, minute, second, ms] = match;
    return new Date(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second),
        Number(ms),
    ).toISOString();
}
