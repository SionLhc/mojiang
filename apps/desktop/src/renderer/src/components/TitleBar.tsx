import { formatCny } from '@/lib/format';
import { useAppStore } from '@/store/useAppStore';

/**
 * 自绘标题栏
 * 用 -webkit-app-region 实现拖动，按钮区必须 no-drag 否则点不动。
 */
export default function TitleBar() {
    const book = useAppStore((state) => state.book);
    const chapterId = useAppStore((state) => state.chapterId);
    const chapters = useAppStore((state) => state.chapters);
    const settings = useAppStore((state) => state.settings);
    const saving = useAppStore((state) => state.saving);
    const content = useAppStore((state) => state.content);
    const savedContent = useAppStore((state) => state.savedContent);

    const currentChapter = chapters.find((item) => item.id === chapterId);
    const dirty = content !== savedContent;

    const parts: string[] = [];
    if (book) {
        parts.push(`《${book.title}》`);
    }
    if (currentChapter) {
        parts.push(currentChapter.title);
    }

    return (
        <header className="drag-region flex h-10 shrink-0 items-center justify-between border-b border-ink-800 bg-ink-900 px-3">
            <div className="flex min-w-0 items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded bg-jade-500 text-[13px] font-bold text-ink-950">
                    墨
                </span>
                <span className="truncate text-[14px] text-ink-300">
                    {parts.length > 0 ? parts.join(' · ') : '墨匠 · 本地写作台'}
                </span>
                {saving ? (
                    <span className="text-[13px] text-ink-500">保存中…</span>
                ) : dirty ? (
                    <span className="text-[13px] text-amber-500">未保存</span>
                ) : null}
            </div>

            <div className="no-drag flex items-center gap-3">
                <button
                    type="button"
                    title="设置"
                    className="flex h-6 w-6 items-center justify-center rounded text-ink-400 transition-colors hover:bg-ink-800 hover:text-ink-100"
                    onClick={() => useAppStore.getState().openSettings()}
                >
                    <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.9"
                        strokeLinecap="round"
                    >
                        <path d="M4 7h16M4 12h16M4 17h16" />
                        <circle cx="9" cy="7" r="2.2" fill="currentColor" stroke="none" />
                        <circle cx="15" cy="12" r="2.2" fill="currentColor" stroke="none" />
                        <circle cx="8" cy="17" r="2.2" fill="currentColor" stroke="none" />
                    </svg>
                </button>
                <button
                    type="button"
                    title="全局搜索 Ctrl+Shift+F"
                    className="flex h-6 items-center gap-1 rounded px-2 text-[13px] text-ink-400 hover:bg-ink-800 hover:text-ink-100"
                    onClick={() => useAppStore.getState().openSearch()}
                >
                    搜索
                </button>
                <button
                    type="button"
                    title="快速记录 Ctrl+Shift+N"
                    className="flex h-6 items-center gap-1 rounded px-2 text-[13px] text-ink-400 hover:bg-ink-800 hover:text-ink-100"
                    onClick={() => useAppStore.getState().openQuickNote()}
                >
                    + 记一条
                </button>
                <span className="text-[13px] text-ink-400">
                    {settings ? `${settings.provider.model} · ${formatCny(settings.usage.costCny)}` : ''}
                </span>
                <div className="flex items-center">
                    <button
                        type="button"
                        title="最小化"
                        className="flex h-8 w-10 items-center justify-center text-ink-400 hover:bg-ink-800 hover:text-ink-100"
                        onClick={() => void window.api.app.minimize()}
                    >
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                            <path d="M1 5h8" stroke="currentColor" strokeWidth="1.2" />
                        </svg>
                    </button>
                    <button
                        type="button"
                        title="最大化"
                        className="flex h-8 w-10 items-center justify-center text-ink-400 hover:bg-ink-800 hover:text-ink-100"
                        onClick={() => void window.api.app.maximize()}
                    >
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                            <rect x="1" y="1" width="8" height="8" stroke="currentColor" strokeWidth="1.2" />
                        </svg>
                    </button>
                    <button
                        type="button"
                        title="关闭"
                        className="flex h-8 w-10 items-center justify-center text-ink-400 hover:bg-red-600 hover:text-white"
                        onClick={() => void window.api.app.close()}
                    >
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                            <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.2" />
                        </svg>
                    </button>
                </div>
            </div>
        </header>
    );
}
