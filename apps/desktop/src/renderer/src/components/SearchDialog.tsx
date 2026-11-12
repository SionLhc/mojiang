import { useEffect, useRef } from 'react';
import type { SearchHit } from '@shared/types';
import Modal from '@/components/Modal';
import { useAppStore } from '@/store/useAppStore';

/** 属性 */
interface SearchDialogProps {
    open: boolean;
    onClose: () => void;
}

/**
 * 全局搜索
 * 跨项目搜正文，点结果直接跳过去
 */
export default function SearchDialog({ open, onClose }: SearchDialogProps) {
    const query = useAppStore((state) => state.searchQuery);
    const result = useAppStore((state) => state.searchResult);
    const searching = useAppStore((state) => state.searching);
    const runSearch = useAppStore((state) => state.runSearch);
    const jumpToDocument = useAppStore((state) => state.jumpToDocument);

    const inputRef = useRef<HTMLInputElement | null>(null);

    // 打开时自动聚焦输入框
    useEffect(() => {
        if (open) {
            window.setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [open]);

    /**
     * 点结果跳转
     * @param hit 命中
     */
    async function handleJump(hit: SearchHit): Promise<void> {
        await jumpToDocument(hit.bookId, hit.section, hit.path);
        onClose();
    }

    return (
        <Modal
            open={open}
            title="全局搜索"
            subtitle="搜的是磁盘上的正文内容，不区分项目类型"
            onClose={onClose}
            widthClass="max-w-2xl"
        >
            <input
                ref={inputRef}
                className="field mb-3"
                placeholder="输入关键词，回车搜索"
                value={query}
                onChange={(event) => void runSearch(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                        onClose();
                    }
                }}
            />

            <div className="max-h-[50vh] min-h-[120px] overflow-y-auto">
                {searching && <p className="py-4 text-center text-[13px] text-ink-500">搜索中…</p>}

                {!searching && query.trim().length === 0 && (
                    <p className="py-6 text-center text-[13px] text-ink-500">
                        输入关键词开始搜索。中文按字面匹配，不做分词。
                    </p>
                )}

                {!searching && query.trim().length > 0 && result && result.hits.length === 0 && (
                    <p className="py-6 text-center text-[13px] text-ink-500">
                        没找到「{query}」。扫了 {result.scanned} 个文件。
                    </p>
                )}

                {result && result.hits.length > 0 && (
                    <ul className="space-y-1">
                        {result.hits.map((hit, index) => (
                            <li key={`${hit.bookId}-${hit.path}-${index}`}>
                                <button
                                    type="button"
                                    onClick={() => void handleJump(hit)}
                                    className="w-full rounded-md border border-ink-800 bg-ink-900 px-3 py-2 text-left hover:border-jade-600 hover:bg-ink-850"
                                >
                                    <div className="flex items-baseline gap-2">
                                        <span className="truncate text-[13px] text-ink-100">{hit.title}</span>
                                        <span className="shrink-0 text-[13px] text-ink-600">
                                            {hit.bookTitle}
                                            {hit.section === 'xigang' ? ' · 细纲' : ''} · 第 {hit.lineNumber} 行
                                        </span>
                                    </div>
                                    <p className="mt-0.5 truncate text-[13px] text-ink-500">{hit.snippet}</p>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}

                {result?.truncated && (
                    <p className="mt-2 text-center text-[13px] text-amber-500">
                        结果太多已截断，换个更具体的关键词。
                    </p>
                )}
            </div>
        </Modal>
    );
}
