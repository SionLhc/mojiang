import { useCallback, useEffect, useState } from 'react';
import { diagnoseGoldenChapter, type GoldenChapterDiagnosis } from '@mojiang/core';
import { errorMessage } from '@/lib/format';
import { useAppStore } from '@/store/useAppStore';

/** 参与条形图打分的项目 */
const SCORE_ITEMS: Array<{
    key: 'hookStrength' | 'openingPace' | 'conflictDensity' | 'infoDumpRatio';
    label: string;
}> = [
    { key: 'hookStrength', label: '钩子强度' },
    { key: 'openingPace', label: '开场节奏' },
    { key: 'conflictDensity', label: '冲突密度' },
    { key: 'infoDumpRatio', label: '设定克制' },
];

/**
 * 按分数给个文字颜色
 * @param score 0-100
 * @returns Tailwind 文字色类
 */
function tone(score: number): string {
    if (score >= 80) {
        return 'text-jade-400';
    }
    if (score >= 60) {
        return 'text-amber-500';
    }
    return 'text-red-400';
}

/**
 * 按分数给个进度条颜色
 * @param score 0-100
 * @returns Tailwind 背景色类
 */
function barTone(score: number): string {
    if (score >= 80) {
        return 'bg-jade-500';
    }
    if (score >= 60) {
        return 'bg-amber-500';
    }
    return 'bg-red-500';
}

/**
 * 黄金三章诊断
 * 只看前三章，全部离线规则打分，不花 token
 */
export default function Golden3View() {
    const book = useAppStore((state) => state.book);
    const properNouns = useAppStore((state) => state.properNouns);
    const pushToast = useAppStore((state) => state.pushToast);

    const [diagnoses, setDiagnoses] = useState<GoldenChapterDiagnosis[]>([]);
    const [loading, setLoading] = useState(false);

    /**
     * 读前三章并逐章诊断
     */
    const load = useCallback(async (): Promise<void> => {
        if (!book) {
            return;
        }
        setLoading(true);
        try {
            const chapters = await window.api.chapter.list(book.id, 'zhengwen');
            const results: GoldenChapterDiagnosis[] = [];
            for (const chapter of chapters.slice(0, 3)) {
                const text = await window.api.chapter.read(book.id, 'zhengwen', chapter.id);
                if (text.trim().length === 0) {
                    continue;
                }
                results.push(
                    diagnoseGoldenChapter(
                        chapter.index,
                        chapter.title,
                        text,
                        book.chapterWordTarget,
                        properNouns,
                    ),
                );
            }
            setDiagnoses(results);
        } catch (error) {
            pushToast('error', errorMessage(error));
        } finally {
            setLoading(false);
        }
    }, [book, properNouns, pushToast]);

    useEffect(() => {
        void load();
    }, [load]);

    return (
        <main className="flex min-w-0 flex-1 flex-col bg-ink-950">
            <div className="flex h-11 shrink-0 items-center justify-between border-b border-ink-800 bg-ink-900 px-4">
                <div className="flex items-center gap-3">
                    <h2 className="text-sm font-medium text-ink-100">黄金三章</h2>
                    <span className="text-[13px] text-ink-500">只看前三章 · 离线规则打分</span>
                </div>
                <button
                    type="button"
                    className="btn-outline text-[13px]"
                    onClick={() => void load()}
                    disabled={loading}
                >
                    {loading ? '检测中…' : '重新检测'}
                </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <div className="mx-auto max-w-3xl space-y-3">
                    <p className="text-[13px] leading-relaxed text-ink-500">
                        六项都是规则算出来的：开头 200 字有没有钩子、前三段句长、冲突词密度、
                        设定信息密度、字数达标、对话占比。分数只作参考，不替你判断好不好看。
                    </p>

                    {diagnoses.length === 0 && !loading && (
                        <p className="py-8 text-center text-[13px] text-ink-500">
                            还没有正文。写完第一章再回来。
                        </p>
                    )}

                    {diagnoses.map((item) => (
                        <section
                            key={item.chapterNumber}
                            className="rounded-lg border border-ink-800 bg-ink-900 p-4"
                        >
                            <div className="flex items-baseline justify-between">
                                <div>
                                    <h3 className="text-sm font-medium text-ink-100">
                                        第 {item.chapterNumber} 章 · {item.title}
                                    </h3>
                                    <p className="mt-0.5 text-[13px] text-ink-500">
                                        对话占比 {Math.round(item.dialogueRatio * 100)}% ·{' '}
                                        {item.wordCountOk ? '字数达标' : '字数偏低'}
                                    </p>
                                </div>
                                <span
                                    className={`text-2xl font-semibold leading-none ${tone(item.score)}`}
                                >
                                    {item.score}
                                </span>
                            </div>

                            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
                                {SCORE_ITEMS.map((metric) => {
                                    const score = item[metric.key];
                                    return (
                                        <div key={metric.key}>
                                            <div className="flex items-center justify-between text-[13px]">
                                                <span className="text-ink-400">{metric.label}</span>
                                                <span className={tone(score)}>{score}</span>
                                            </div>
                                            <div className="mt-1 h-1 overflow-hidden rounded-full bg-ink-800">
                                                <div
                                                    className={`h-full rounded-full ${barTone(score)}`}
                                                    style={{ width: `${score}%` }}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {item.notes.length > 0 && (
                                <ul className="mt-3 space-y-1 border-t border-ink-800 pt-2">
                                    {item.notes.map((note) => (
                                        <li key={note} className="text-[13px] leading-relaxed text-ink-400">
                                            · {note}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>
                    ))}
                </div>
            </div>
        </main>
    );
}
