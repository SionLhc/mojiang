import { useMemo, useState } from 'react';
import { PROJECT_KINDS, type ProjectKind } from '@mojiang/core';
import Modal from '@/components/Modal';
import { errorMessage, formatCharCount, formatTime } from '@/lib/format';
import { useAppStore } from '@/store/useAppStore';

/** 属性 */
interface HomeViewProps {
    onOpenSettings: () => void;
}

/** 入口卡片的外观与文案 */
const ENTRIES: Array<{
    kind: ProjectKind;
    title: string;
    subtitle: string;
    /** 卡片底纹的强调色 */
    accent: string;
    /** 图标路径 */
    icon: string;
}> = [
    {
        kind: 'novel',
        title: '写小说',
        subtitle: '章节体系 + 体检 + 八问大纲 + 账本伏笔',
        accent: '#1f7a5c',
        icon: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z',
    },
    {
        kind: 'docs',
        title: '写文档',
        subtitle: '目录结构 + 干净编辑器，不打扰',
        accent: '#a9701a',
        icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5',
    },
    {
        kind: 'notes',
        title: '记笔记',
        subtitle: '随手记、标签、全局搜索',
        accent: '#2f6fb8',
        icon: 'M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3zM15 3v6h6M8 14l2 2 4-4',
    },
];

/** 每种类型的徽章配色 */
const KIND_TONE: Record<ProjectKind, string> = {
    novel: 'bg-jade-600/20 text-jade-400',
    notes: 'bg-ink-700 text-ink-200',
    docs: 'bg-amber-500/15 text-amber-500',
};

/**
 * 首页：先选做什么，再进对应界面
 * 没有打开项目时显示，替代原来的书库侧栏
 */
export default function HomeView({ onOpenSettings }: HomeViewProps) {
    const books = useAppStore((state) => state.books);
    const createBook = useAppStore((state) => state.createBook);
    const openBook = useAppStore((state) => state.openBook);
    const removeBook = useAppStore((state) => state.removeBook);
    const refreshBooks = useAppStore((state) => state.refreshBooks);
    const pushToast = useAppStore((state) => state.pushToast);

    const [picked, setPicked] = useState<ProjectKind | null>(null);
    const [title, setTitle] = useState('');
    const [genre, setGenre] = useState('');
    const [query, setQuery] = useState('');
    const [creating, setCreating] = useState(false);

    const visibleBooks = useMemo(() => {
        const keyword = query.trim().toLowerCase();
        const list = keyword.length
            ? books.filter((item) => item.title.toLowerCase().includes(keyword))
            : books;
        return [...list].sort((left, right) =>
            (right.lastEditedAt ?? '').localeCompare(left.lastEditedAt ?? ''),
        );
    }, [books, query]);

    /**
     * 点入口卡片 → 打开命名表单
     * @param kind 项目类型
     */
    function startCreate(kind: ProjectKind): void {
        setPicked(kind);
        setTitle('');
        setGenre('');
    }

    /**
     * 确认创建，建完自动进工作台
     */
    async function submitCreate(): Promise<void> {
        if (!picked || title.trim().length === 0 || creating) {
            return;
        }
        setCreating(true);
        try {
            await createBook({
                title: title.trim(),
                genre: picked === 'novel' ? genre : '',
                chapterWordTarget: picked === 'novel' ? 3000 : 2000,
                kind: picked,
            });
            setPicked(null);
        } catch (error) {
            pushToast('error', errorMessage(error));
        } finally {
            setCreating(false);
        }
    }

    /**
     * 导入稿件
     */
    async function handleImport(): Promise<void> {
        try {
            const result = await window.api.importer.pick();
            if (result.canceled || result.results.length === 0) {
                return;
            }
            await refreshBooks();
            const succeeded = result.results.filter((item) => item.ok);
            const failed = result.results.filter((item) => !item.ok);
            if (succeeded.length > 0) {
                const chapters = succeeded.reduce((sum, item) => sum + item.chapters, 0);
                pushToast('success', `已导入 ${succeeded.length} 本，共 ${chapters} 章`);
            }
            if (failed.length > 0) {
                pushToast('error', `${failed.length} 个文件没导进来：${failed[0].error ?? '未知原因'}`);
            }
        } catch (error) {
            pushToast('error', errorMessage(error));
        }
    }

    /**
     * 删项目前确认
     * @param bookId 项目 id
     * @param bookTitle 项目名
     */
    function handleRemove(bookId: string, bookTitle: string): void {
        const ok = window.confirm(`把「${bookTitle}」放进回收站？\n\n回收站在「文档/墨匠/回收站」，能恢复。`);
        if (ok) {
            void removeBook(bookId);
        }
    }

    const pickedMeta = picked ? PROJECT_KINDS.find((item) => item.kind === picked) : null;

    return (
        <div className="flex h-full flex-col overflow-y-auto bg-ink-950">
            <div className="mx-auto w-full max-w-4xl px-8 py-12">
                {/* 标题 */}
                <header
                    className="mb-10"
                    style={{ animation: 'home-title-in 420ms cubic-bezier(0.2, 0.9, 0.3, 1) both' }}
                >
                    <h1 className="text-[34px] font-semibold tracking-wide text-ink-100">墨匠</h1>
                    <p className="mt-1.5 text-[14px] text-ink-500">
                        先选要做什么。小说有章节目录和写作工具，文档和笔记是干净编辑器。
                    </p>
                </header>

                {/* 三个入口 */}
                <div className="grid grid-cols-3 gap-4">
                    {ENTRIES.map((entry, index) => (
                        <button
                            type="button"
                            key={entry.kind}
                            onClick={() => startCreate(entry.kind)}
                            className="home-entry group relative flex flex-col items-start gap-2 rounded-xl border border-ink-750 bg-ink-900 p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-jade-500 hover:bg-ink-850 hover:shadow-md"
                            style={{
                                animation: 'home-card-in 440ms cubic-bezier(0.2, 0.9, 0.3, 1) both',
                                animationDelay: `${120 + index * 80}ms`,
                            }}
                        >
                            <span
                                className="home-entry-icon flex h-11 w-11 items-center justify-center rounded-lg"
                                style={{
                                    backgroundColor: `${entry.accent}14`,
                                    color: entry.accent,
                                    boxShadow: `inset 0 0 0 1px ${entry.accent}24`,
                                }}
                            >
                                <svg
                                    width="22"
                                    height="22"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.8"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <path d={entry.icon} />
                                </svg>
                            </span>
                            <span className="text-[17px] font-medium text-ink-100">{entry.title}</span>
                            <span className="text-[13px] leading-relaxed text-ink-500">
                                {entry.subtitle}
                            </span>
                            <span className="mt-1 flex items-center gap-1 text-[13px] text-ink-600 transition-colors group-hover:text-jade-500">
                                开始
                                <svg
                                    width="12"
                                    height="12"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <path d="M9 18l6-6-6-6" />
                                </svg>
                            </span>
                        </button>
                    ))}
                </div>

                {/* 已有项目 */}
                <section className="mt-12">
                    <div className="mb-3 flex items-center justify-between">
                        <h2 className="text-[15px] font-medium text-ink-200">
                            已有项目
                            <span className="ml-2 text-[13px] font-normal text-ink-500">
                                {books.length} 个
                            </span>
                        </h2>
                        <div className="flex items-center gap-2">
                            <input
                                className="field h-8 w-44 text-[13px]"
                                placeholder="搜索名称"
                                value={query}
                                onChange={(event) => setQuery(event.target.value)}
                            />
                            <button
                                type="button"
                                className="btn-outline h-8 text-[13px]"
                                onClick={() => void handleImport()}
                            >
                                导入稿件
                            </button>
                            <button
                                type="button"
                                className="btn-ghost h-8 text-[13px]"
                                onClick={onOpenSettings}
                            >
                                设置
                            </button>
                        </div>
                    </div>

                    {visibleBooks.length === 0 ? (
                        <p className="rounded-lg border border-dashed border-ink-750 py-10 text-center text-[13px] text-ink-500">
                            {books.length === 0
                                ? '还没有项目。点上面的卡片开始，或者「导入稿件」把旧稿拿进来。'
                                : `没有匹配「${query}」的项目`}
                        </p>
                    ) : (
                        <ul className="grid grid-cols-3 gap-3">
                            {visibleBooks.map((item, index) => {
                                const kind = item.kind ?? 'novel';
                                return (
                                    <li key={item.id} className="group relative">
                                        <button
                                            type="button"
                                            onClick={() => void openBook(item)}
                                            className="home-project w-full rounded-lg border border-ink-750 bg-ink-900 px-3 py-3 pr-9 text-left shadow-sm hover:border-jade-600"
                                            style={{
                                                animation:
                                                    'home-card-in 380ms cubic-bezier(0.2, 0.9, 0.3, 1) both',
                                                animationDelay: `${index * 40}ms`,
                                            }}
                                        >
                                            <div className="flex items-center gap-1.5">
                                                <span className="min-w-0 flex-1 truncate text-[14px] text-ink-100">
                                                    {item.title}
                                                </span>
                                                <span
                                                    className={`shrink-0 rounded-full px-1.5 py-0.5 text-[12px] ${KIND_TONE[kind]}`}
                                                >
                                                    {PROJECT_KINDS.find((k) => k.kind === kind)?.name ?? '小说'}
                                                </span>
                                            </div>
                                            <p className="mt-1 text-[13px] text-ink-500">
                                                {item.chapterCount} 篇 · {formatCharCount(item.charCount)}
                                                {item.lastEditedAt ? ` · ${formatTime(item.lastEditedAt)}` : ''}
                                            </p>
                                        </button>
                                        <button
                                            type="button"
                                            title="删除到回收站"
                                            onClick={() => handleRemove(item.id, item.title)}
                                            className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full text-ink-500 opacity-0 transition-colors hover:bg-red-500 hover:text-white group-hover:opacity-100"
                                        >
                                            <svg
                                                width="11"
                                                height="11"
                                                viewBox="0 0 24 24"
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="2.6"
                                                strokeLinecap="round"
                                            >
                                                <path d="M18 6L6 18M6 6l12 12" />
                                            </svg>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </section>

                <footer className="mt-14 text-center text-[13px] leading-relaxed text-ink-600">
                    所有数据存在本机「文档 / 墨匠」，Markdown + JSON，
                    <br />
                    随时可以用别的编辑器打开，不锁在应用里。
                </footer>
            </div>

            {/* 命名表单 */}
            <Modal
                open={picked !== null}
                title={`新建${pickedMeta?.name ?? ''}`}
                subtitle={pickedMeta?.description}
                onClose={() => setPicked(null)}
                widthClass="max-w-md"
                footer={
                    <>
                        <button type="button" className="btn-ghost" onClick={() => setPicked(null)}>
                            取消
                        </button>
                        <button
                            type="button"
                            className="btn-primary"
                            onClick={() => void submitCreate()}
                            disabled={title.trim().length === 0 || creating}
                        >
                            {creating ? '创建中…' : '创建'}
                        </button>
                    </>
                }
            >
                <div className="space-y-3">
                    <input
                        className="field"
                        placeholder="名称"
                        autoFocus
                        value={title}
                        onChange={(event) => setTitle(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                void submitCreate();
                            }
                        }}
                    />
                    {picked === 'novel' && (
                        <input
                            className="field"
                            placeholder="题材（例如 都市 / 仙侠，可留空）"
                            value={genre}
                            onChange={(event) => setGenre(event.target.value)}
                        />
                    )}
                    <p className="text-[13px] leading-relaxed text-ink-500">
                        {picked === 'novel'
                            ? '小说项目有章节目录、词库体检、八问大纲、账本、伏笔、开写包。'
                            : '文档项目只有目录树和编辑器，不会出现写作工具。'}
                    </p>
                </div>
            </Modal>
        </div>
    );
}
