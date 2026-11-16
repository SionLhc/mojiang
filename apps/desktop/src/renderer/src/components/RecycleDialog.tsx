import { useEffect, useState } from 'react';
import type { ChapterRecycleEntry, RecycleBookEntry } from '@shared/types';
import Modal from '@/components/Modal';
import { errorMessage } from '@/lib/format';
import { useAppStore } from '@/store/useAppStore';

/** 回收站弹窗属性 */
interface RecycleDialogProps {
    open: boolean;
    onClose: () => void;
    /** 传了书 id 就是这本书的章节回收站；不传是全局的书回收站 */
    bookId?: string;
}

/**
 * 把 ISO 时间转成本地可读格式
 * @param iso ISO 字符串
 * @returns 形如 11-16 09:22；解析不出返回空串
 */
function formatDeletedAt(iso: string): string {
    if (!iso) {
        return '';
    }
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
        return iso;
    }
    const pad = (value: number): string => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 回收站弹窗：删掉的书 / 文章在这里都能一键捞回来
 * 书模式列出全局回收站；章节模式列出当前书内回收站
 */
export default function RecycleDialog({ open, onClose, bookId }: RecycleDialogProps) {
    const pushToast = useAppStore((state) => state.pushToast);
    const refreshBooks = useAppStore((state) => state.refreshBooks);
    const reloadBookData = useAppStore((state) => state.reloadBookData);

    const [books, setBooks] = useState<RecycleBookEntry[]>([]);
    const [chapters, setChapters] = useState<ChapterRecycleEntry[]>([]);
    const [loading, setLoading] = useState(false);
    /** 正在恢复的条目，防止连点 */
    const [restoring, setRestoring] = useState<string | null>(null);

    // 打开时拉列表
    useEffect(() => {
        if (!open) {
            return;
        }
        void (async () => {
            setLoading(true);
            try {
                if (bookId) {
                    setChapters(await window.api.chapter.listRecycle(bookId));
                } else {
                    setBooks(await window.api.library.listRecycleBin());
                }
            } catch (error) {
                pushToast('error', errorMessage(error));
            } finally {
                setLoading(false);
            }
        })();
    }, [open, bookId, pushToast]);

    /**
     * 恢复一本书
     * @param entry 回收站条目
     */
    async function restoreBook(entry: RecycleBookEntry): Promise<void> {
        setRestoring(entry.folderName);
        try {
            await window.api.library.restore(entry.folderName);
            await refreshBooks();
            setBooks((previous) => previous.filter((item) => item.folderName !== entry.folderName));
            pushToast('success', `「${entry.title}」已恢复回书库`);
        } catch (error) {
            pushToast('error', `恢复失败：${errorMessage(error)}`);
        } finally {
            setRestoring(null);
        }
    }

    /**
     * 恢复一篇文章
     * @param entry 回收站条目
     */
    async function restoreChapter(entry: ChapterRecycleEntry): Promise<void> {
        if (!bookId) {
            return;
        }
        setRestoring(entry.fileName);
        try {
            await window.api.chapter.restoreRecycle(bookId, entry.fileName);
            await reloadBookData();
            setChapters((previous) => previous.filter((item) => item.fileName !== entry.fileName));
            pushToast(
                'success',
                `「${entry.title}」已恢复到${entry.section === 'xigang' ? '细纲' : '正文'}`,
            );
        } catch (error) {
            pushToast('error', `恢复失败：${errorMessage(error)}`);
        } finally {
            setRestoring(null);
        }
    }

    const count = bookId ? chapters.length : books.length;

    return (
        <Modal
            open={open}
            title={bookId ? '书内回收站' : '回收站'}
            subtitle={
                loading
                    ? '读取中…'
                    : count === 0
                      ? '空的。删掉的内容会先进回收站，不会立刻消失'
                      : `共 ${count} 项，点「恢复」放回原处`
            }
            onClose={onClose}
            widthClass="max-w-xl"
            footer={
                <button type="button" className="btn-ghost" onClick={onClose}>
                    关闭
                </button>
            }
        >
            <div className="max-h-[52vh] space-y-1.5 overflow-y-auto pr-1">
                {loading && (
                    <p className="py-8 text-center text-[13px] text-ink-500">读取中…</p>
                )}

                {/* 书回收站 */}
                {!bookId && !loading && books.length === 0 && (
                    <p className="py-8 text-center text-[13px] leading-relaxed text-ink-500">
                        回收站是空的。
                        <br />
                        彻底清理可以在「设置」里打开回收站文件夹手动删除。
                    </p>
                )}
                {!bookId &&
                    books.map((entry) => (
                        <div
                            key={entry.folderName}
                            className="flex items-center justify-between gap-2 rounded-md border border-ink-800 px-2.5 py-2"
                        >
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-[13px] text-ink-100">{entry.title}</p>
                                <p className="text-[12px] text-ink-500">
                                    删除于 {formatDeletedAt(entry.deletedAt) || '未知时间'}
                                </p>
                            </div>
                            <button
                                type="button"
                                className="btn-outline shrink-0 h-7 text-[13px]"
                                onClick={() => void restoreBook(entry)}
                                disabled={restoring !== null}
                            >
                                {restoring === entry.folderName ? '恢复中…' : '恢复'}
                            </button>
                        </div>
                    ))}

                {/* 章节回收站 */}
                {bookId && !loading && chapters.length === 0 && (
                    <p className="py-8 text-center text-[13px] leading-relaxed text-ink-500">
                        这本书的回收站是空的。
                        <br />
                        删掉的章节会先挪到这里，随时可以恢复。
                    </p>
                )}
                {bookId &&
                    chapters.map((entry) => (
                        <div
                            key={entry.fileName}
                            className="flex items-center justify-between gap-2 rounded-md border border-ink-800 px-2.5 py-2"
                        >
                            <div className="min-w-0 flex-1">
                                <p className="flex items-center gap-1.5 truncate text-[13px] text-ink-100">
                                    <span className="shrink-0 rounded bg-ink-800 px-1 py-0.5 text-[12px] text-ink-400">
                                        {entry.section === 'xigang' ? '细纲' : '正文'}
                                    </span>
                                    <span className="truncate">{entry.title}</span>
                                </p>
                                <p className="text-[12px] text-ink-500">
                                    删除于 {formatDeletedAt(entry.deletedAt) || '未知时间'} ·{' '}
                                    {Math.max(1, Math.round(entry.size / 1024))} KB
                                </p>
                            </div>
                            <button
                                type="button"
                                className="btn-outline shrink-0 h-7 text-[13px]"
                                onClick={() => void restoreChapter(entry)}
                                disabled={restoring !== null}
                            >
                                {restoring === entry.fileName ? '恢复中…' : '恢复'}
                            </button>
                        </div>
                    ))}
            </div>
        </Modal>
    );
}
