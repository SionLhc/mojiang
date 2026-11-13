import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_SENSITIVE_WORDS, scanSensitiveWords, type SensitiveHit } from '@mojiang/core';
import { errorMessage } from '@/lib/format';
import { useAppStore } from '@/store/useAppStore';

/** 词库文件结构 */
interface SensitiveFile {
    words: string[];
}

/** 一篇文档的扫描结果 */
interface DocReport {
    chapterId: string;
    title: string;
    hits: SensitiveHit[];
}

/**
 * 敏感词检查
 * 词库自己维护，扫完可以点结果跳到出问题的文档
 * 数据存在书里的 敏感词.json
 */
export default function SensitiveView() {
    const book = useAppStore((state) => state.book);
    const section = useAppStore((state) => state.section);
    const chapters = useAppStore((state) => state.chapters);
    const content = useAppStore((state) => state.content);
    const chapterId = useAppStore((state) => state.chapterId);
    const jumpToDocument = useAppStore((state) => state.jumpToDocument);
    const pushToast = useAppStore((state) => state.pushToast);

    const [words, setWords] = useState<string[]>([...DEFAULT_SENSITIVE_WORDS]);
    const [wordInput, setWordInput] = useState('');
    const [reports, setReports] = useState<DocReport[]>([]);
    const [scanning, setScanning] = useState(false);

    /**
     * 读词库
     */
    const reload = useCallback(async () => {
        if (!book) {
            return;
        }
        try {
            const file = await window.api.file.readJson<SensitiveFile>(book.id, '敏感词.json', {
                words: [...DEFAULT_SENSITIVE_WORDS],
            });
            setWords(Array.isArray(file.words) ? file.words : [...DEFAULT_SENSITIVE_WORDS]);
        } catch (error) {
            pushToast('error', `读词库失败：${errorMessage(error)}`);
        }
    }, [book, pushToast]);

    useEffect(() => {
        void reload();
    }, [reload]);

    /**
     * 把词库落盘
     * @param next 新词库
     */
    async function persist(next: string[]): Promise<void> {
        if (!book) {
            return;
        }
        try {
            await window.api.file.writeJson(book.id, '敏感词.json', { words: next } satisfies SensitiveFile);
            setWords(next);
        } catch (error) {
            pushToast('error', `存词库失败：${errorMessage(error)}`);
        }
    }

    /**
     * 加一个词
     */
    async function addWord(): Promise<void> {
        const word = wordInput.trim().replace(/^#/, '');
        if (word.length === 0) {
            return;
        }
        if (words.includes(word)) {
            pushToast('info', '词库里已经有这个词了');
            setWordInput('');
            return;
        }
        await persist([...words, word]);
        setWordInput('');
    }

    /**
     * 删一个词
     * @param word 要删的词
     */
    async function removeWord(word: string): Promise<void> {
        await persist(words.filter((item) => item !== word));
    }

    /**
     * 扫描所有文档（当前打开的那篇用内存里的内容，其余去读盘）
     */
    async function scan(): Promise<void> {
        if (!book) {
            return;
        }
        if (words.length === 0) {
            pushToast('error', '词库是空的，先加几个词');
            return;
        }
        setScanning(true);
        try {
            const results: DocReport[] = [];
            for (const chapter of chapters) {
                // 当前打开的文档可能有未保存改动，直接用编辑器里的内容更准
                const text = chapter.id === chapterId ? content : await window.api.chapter.read(book.id, section, chapter.id);
                const hits = scanSensitiveWords(text, words);
                if (hits.length > 0) {
                    results.push({ chapterId: chapter.id, title: chapter.title, hits });
                }
            }
            setReports(results);
            pushToast(
                results.length === 0 ? 'success' : 'info',
                results.length === 0 ? '全部干净，没有命中' : `有 ${results.length} 篇文档命中敏感词`,
            );
        } catch (error) {
            pushToast('error', `扫描失败：${errorMessage(error)}`);
        } finally {
            setScanning(false);
        }
    }

    return (
        <main className="flex min-h-0 flex-1 overflow-hidden bg-ink-950">
            {/* 左：词库 */}
            <div className="flex w-64 shrink-0 flex-col border-r border-ink-800">
                <p className="px-3 py-2.5 text-sm font-medium text-ink-200">词库</p>
                <div className="flex items-center gap-1.5 px-3 pb-2">
                    <input
                        className="field h-7 flex-1 text-[13px]"
                        placeholder="加个词，回车确认"
                        value={wordInput}
                        onChange={(event) => setWordInput(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                void addWord();
                            }
                        }}
                    />
                    <button type="button" className="btn-outline h-7 text-[13px]" onClick={() => void addWord()}>
                        加
                    </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
                    <div className="flex flex-wrap gap-1">
                        {words.map((word) => (
                            <span
                                key={word}
                                className="flex items-center gap-0.5 rounded bg-ink-800 px-1.5 py-0.5 text-[12px] text-ink-300"
                            >
                                {word}
                                <button
                                    type="button"
                                    className="text-ink-600 hover:text-red-400"
                                    onClick={() => void removeWord(word)}
                                    title="从词库去掉"
                                >
                                    ×
                                </button>
                            </span>
                        ))}
                    </div>
                    {words.length === 0 && (
                        <p className="px-1 py-4 text-center text-[13px] leading-relaxed text-ink-600">
                            词库是空的。加几个要拦的词，比如平台不让出现的引流词。
                        </p>
                    )}
                </div>
            </div>

            {/* 右：扫描结果 */}
            <div className="flex min-w-0 flex-1 flex-col overflow-y-auto px-8 py-6">
                <div className="mx-auto w-full max-w-2xl">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-lg font-medium text-ink-100">敏感词检查</h2>
                            <p className="mt-1 text-[13px] text-ink-500">
                                发布前扫一遍，按词库逐篇匹配，点结果能跳到文档。
                            </p>
                        </div>
                        <button
                            type="button"
                            className="btn-primary h-8 text-[13px]"
                            onClick={() => void scan()}
                            disabled={scanning}
                        >
                            {scanning ? '扫描中…' : '开始扫描'}
                        </button>
                    </div>

                    <div className="mt-5 flex flex-col gap-3">
                        {reports.length === 0 ? (
                            <p className="rounded-lg border border-dashed border-ink-750 py-10 text-center text-[13px] text-ink-500">
                                {scanning ? '正在逐篇检查…' : '还没扫过，点右上角「开始扫描」'}
                            </p>
                        ) : (
                            reports.map((report) => (
                                <div key={report.chapterId} className="rounded-lg border border-ink-750 bg-ink-900 px-4 py-3">
                                    <div className="flex items-center justify-between">
                                        <p className="text-sm text-ink-100">{report.title}</p>
                                        <button
                                            type="button"
                                            className="btn-ghost text-[13px]"
                                            onClick={() => {
                                                if (book) {
                                                    void jumpToDocument(book.id, section, report.chapterId);
                                                }
                                            }}
                                        >
                                            去看看
                                        </button>
                                    </div>
                                    <div className="mt-2 flex flex-col gap-1.5">
                                        {report.hits.map((hit) => (
                                            <div key={hit.word} className="text-[13px]">
                                                <span className="text-amber-500">「{hit.word}」</span>
                                                <span className="text-ink-500"> × {hit.count} 次</span>
                                                {hit.lines.slice(0, 3).map((line) => (
                                                    <p key={line.line} className="mt-0.5 truncate pl-3 text-ink-500">
                                                        第 {line.line} 行：{line.text}
                                                    </p>
                                                ))}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </main>
    );
}
