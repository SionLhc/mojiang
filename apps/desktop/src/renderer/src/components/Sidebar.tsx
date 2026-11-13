import { useMemo, useState } from 'react';
import { PROJECT_KINDS, getProjectFeatures, type ProjectKind } from '@mojiang/core';
import DocumentTree from '@/components/DocumentTree';
import { errorMessage, formatCharCount, formatTime } from '@/lib/format';
import { collectTags, filterTreeByTag } from '@/lib/tree';
import { useAppStore, type WorkspaceView } from '@/store/useAppStore';
import type { ChapterSection } from '@shared/types';

/** 侧边栏属性 */
interface SidebarProps {
    onOpenOutline: () => void;
    onOpenSettings: () => void;
    onOpenExport: () => void;
}

/** 工具视图入口，按项目类型过滤后才显示 */
const TOOL_VIEWS: Array<{
    key: WorkspaceView;
    label: string;
    /** 非小说项目用的名字，不填就沿用 label */
    generalLabel?: string;
    feature:
        | 'ledger'
        | 'foreshadow'
        | 'characters'
        | 'golden3'
        | 'writingPackage'
        | 'market'
        | 'plot'
        | 'stats'
        | 'materials'
        | 'sensitive'
        | 'diagram'
        | 'mindboard';
}> = [
    { key: 'plot', label: '剧情编排', generalLabel: '画板', feature: 'plot' },
    { key: 'ledger', label: '账本', feature: 'ledger' },
    { key: 'foreshadow', label: '伏笔', feature: 'foreshadow' },
    { key: 'characters', label: '人设', feature: 'characters' },
    { key: 'golden3', label: '三章诊断', feature: 'golden3' },
    { key: 'package', label: '开写包', feature: 'writingPackage' },
    { key: 'market', label: '市场调研', feature: 'market' },
    { key: 'stats', label: '码字统计', feature: 'stats' },
    { key: 'materials', label: '素材卡片', feature: 'materials' },
    { key: 'sensitive', label: '敏感词', feature: 'sensitive' },
    { key: 'diagram', label: '图表', generalLabel: '图表', feature: 'diagram' },
    { key: 'mindboard', label: '导图画板', generalLabel: '导图画板', feature: 'mindboard' },
];

/** 书库排序方式 */
type BookSort = 'recent' | 'chars' | 'title';

/** 类型徽章的配色 */
const KIND_TONE: Record<ProjectKind, string> = {
    novel: 'bg-jade-600/20 text-jade-400',
    notes: 'bg-ink-700 text-ink-200',
    docs: 'bg-amber-500/15 text-amber-500',
};

/**
 * 左栏：书库列表 / 项目目录树
 * 小说显示章节和写作工具，笔记和文档显示目录树和通用操作
 */
export default function Sidebar({ onOpenOutline, onOpenSettings, onOpenExport }: SidebarProps) {
    const book = useAppStore((state) => state.book);
    const books = useAppStore((state) => state.books);
    const section = useAppStore((state) => state.section);
    const tree = useAppStore((state) => state.tree);
    const chapterId = useAppStore((state) => state.chapterId);
    const content = useAppStore((state) => state.content);
    const savedContent = useAppStore((state) => state.savedContent);
    const activeView = useAppStore((state) => state.activeView);
    const activeTag = useAppStore((state) => state.activeTag);

    const openBook = useAppStore((state) => state.openBook);
    const closeBook = useAppStore((state) => state.closeBook);
    const createBook = useAppStore((state) => state.createBook);
    const removeBook = useAppStore((state) => state.removeBook);
    const refreshBooks = useAppStore((state) => state.refreshBooks);
    const pushToast = useAppStore((state) => state.pushToast);
    const setSection = useAppStore((state) => state.setSection);
    const openChapter = useAppStore((state) => state.openChapter);
    const createChapter = useAppStore((state) => state.createChapter);
    const removeChapter = useAppStore((state) => state.removeChapter);
    const setActiveView = useAppStore((state) => state.setActiveView);
    const createFolder = useAppStore((state) => state.createFolder);
    const setActiveTag = useAppStore((state) => state.setActiveTag);

    const [creating, setCreating] = useState(false);
    const [newTitle, setNewTitle] = useState('');
    const [newKind, setNewKind] = useState<ProjectKind>('novel');
    const [newGenre, setNewGenre] = useState('');

    const [docInputOpen, setDocInputOpen] = useState(false);
    const [docTitle, setDocTitle] = useState('');
    const [folderInputOpen, setFolderInputOpen] = useState(false);
    const [folderName, setFolderName] = useState('');
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const [bookQuery, setBookQuery] = useState('');
    const [bookSort, setBookSort] = useState<BookSort>('recent');

    const features = getProjectFeatures(book?.kind);
    const dirty = content !== savedContent;

    // 书库列表：先按关键词过滤，再按选定方式排序
    const visibleBooks = useMemo(() => {
        const keyword = bookQuery.trim().toLowerCase();
        const filtered = keyword.length
            ? books.filter((item) => item.title.toLowerCase().includes(keyword))
            : books;
        const sorted = [...filtered];
        if (bookSort === 'chars') {
            sorted.sort((left, right) => right.charCount - left.charCount);
        } else if (bookSort === 'title') {
            sorted.sort((left, right) => left.title.localeCompare(right.title, 'zh'));
        } else {
            sorted.sort((left, right) => (right.lastEditedAt ?? '').localeCompare(left.lastEditedAt ?? ''));
        }
        return sorted;
    }, [books, bookQuery, bookSort]);

    const tags = useMemo(() => collectTags(tree), [tree]);
    const visibleTree = useMemo(() => filterTreeByTag(tree, activeTag), [tree, activeTag]);
    const visibleTools = useMemo(
        () => TOOL_VIEWS.filter((tool) => features[tool.feature]),
        [features],
    );

    /**
     * 建项目
     */
    async function handleCreateBook(): Promise<void> {
        if (newTitle.trim().length === 0) {
            return;
        }
        await createBook({
            title: newTitle.trim(),
            genre: newKind === 'novel' ? newGenre : '',
            chapterWordTarget: newKind === 'novel' ? 3000 : 2000,
            kind: newKind,
        });
        setNewTitle('');
        setNewGenre('');
        setCreating(false);
    }

    /**
     * 导入已有稿件
     * 一个文件 = 一本新书，主进程按章节标题自动拆分
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
                pushToast(
                    'error',
                    `${failed.length} 个文件没导进来：${failed[0].error ?? '未知原因'}`,
                );
            }
        } catch (error) {
            pushToast('error', errorMessage(error));
        }
    }

    /**
     * 删书前二次确认
     * @param bookId 书 id
     * @param title 书名
     */
    function handleRemoveBook(bookId: string, title: string): void {
        const ok = window.confirm(`把「${title}」放进回收站？\n\n回收站在「文档/墨匠/回收站」，能恢复。`);
        if (ok) {
            void removeBook(bookId);
        }
    }

    /**
     * 切换内容区
     * @param next 区
     */
    function handleSection(next: ChapterSection): void {
        if (dirty && !window.confirm('当前文档还有没保存的改动，切换会先保存。继续？')) {
            return;
        }
        void setSection(next);
    }

    /**
     * 新建文档：小说直接建编号章，笔记先要个标题
     */
    function handleNewDocument(): void {
        if (features.numberedFiles) {
            void createChapter();
            return;
        }
        setDocInputOpen(true);
    }

    /**
     * 提交新建文档
     */
    async function submitNewDocument(): Promise<void> {
        const title = docTitle.trim();
        if (title.length === 0) {
            return;
        }
        await createChapter(title);
        setDocTitle('');
        setDocInputOpen(false);
    }

    /**
     * 提交新建文件夹
     */
    async function submitNewFolder(): Promise<void> {
        const name = folderName.trim();
        if (name.length === 0) {
            return;
        }
        await createFolder(name);
        setFolderName('');
        setFolderInputOpen(false);
    }

    /**
     * 折叠/展开文件夹
     * @param path 文件夹路径
     */
    function toggleFolder(path: string): void {
        setExpanded((previous) => ({ ...previous, [path]: !previous[path] }));
    }

    /**
     * 删除文档前确认
     * @param id 文档 id
     * @param title 标题
     */
    function handleRemoveDocument(id: string, title: string): void {
        if (window.confirm(`删除「${title}」？会移入项目内的回收站。`)) {
            void removeChapter(id);
        }
    }

    // ---------- 书库视图 ----------
    if (!book) {
        return (
            <aside className="flex w-60 shrink-0 flex-col border-r border-ink-800 bg-ink-900">
                <div className="flex h-11 items-center justify-between border-b border-ink-800 px-3">
                    <span className="text-[14px] font-semibold tracking-wide text-ink-300">书库</span>
                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            className="btn-ghost h-6 px-2 text-[13px]"
                            onClick={() => void handleImport()}
                            title="导入 TXT / Markdown 稿件，按章节标题自动拆分"
                        >
                            导入
                        </button>
                        <button
                            type="button"
                            className="btn-ghost h-6 px-2 text-[13px]"
                            onClick={() => setCreating((value) => !value)}
                        >
                            + 新建
                        </button>
                    </div>
                </div>

                {books.length > 0 && (
                    <div className="space-y-1.5 border-b border-ink-800 p-2">
                        <input
                            className="field h-7 text-[13px]"
                            placeholder="搜索名称"
                            value={bookQuery}
                            onChange={(event) => setBookQuery(event.target.value)}
                        />
                        <div className="flex gap-1">
                            {(
                                [
                                    { key: 'recent', label: '最近' },
                                    { key: 'chars', label: '字数' },
                                    { key: 'title', label: '名称' },
                                ] as Array<{ key: BookSort; label: string }>
                            ).map((item) => (
                                <button
                                    type="button"
                                    key={item.key}
                                    onClick={() => setBookSort(item.key)}
                                    className={`flex-1 rounded px-1 py-0.5 text-[13px] ${
                                        bookSort === item.key
                                            ? 'bg-jade-500/15 text-jade-400'
                                            : 'text-ink-500 hover:bg-ink-800 hover:text-ink-300'
                                    }`}
                                >
                                    {item.label}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {creating && (
                    <div className="space-y-2 border-b border-ink-800 p-3">
                        <input
                            className="field text-[14px]"
                            placeholder="名称"
                            value={newTitle}
                            autoFocus
                            onChange={(event) => setNewTitle(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    void handleCreateBook();
                                }
                            }}
                        />
                        <div className="grid grid-cols-3 gap-1">
                            {PROJECT_KINDS.map((item) => (
                                <button
                                    type="button"
                                    key={item.kind}
                                    onClick={() => setNewKind(item.kind)}
                                    className={`rounded-md border px-1 py-1.5 text-[13px] ${
                                        newKind === item.kind
                                            ? 'border-jade-500 bg-jade-500/10 text-jade-400'
                                            : 'border-ink-700 text-ink-300 hover:border-ink-600'
                                    }`}
                                >
                                    {item.name}
                                </button>
                            ))}
                        </div>
                        <p className="text-[13px] leading-relaxed text-ink-500">
                            {PROJECT_KINDS.find((item) => item.kind === newKind)?.description}
                        </p>
                        {newKind === 'novel' && (
                            <input
                                className="field text-[14px]"
                                placeholder="题材（例如 都市 / 仙侠）"
                                value={newGenre}
                                onChange={(event) => setNewGenre(event.target.value)}
                            />
                        )}
                        <div className="flex justify-end gap-1">
                            <button type="button" className="btn-ghost" onClick={() => setCreating(false)}>
                                取消
                            </button>
                            <button type="button" className="btn-primary" onClick={() => void handleCreateBook()}>
                                创建
                            </button>
                        </div>
                    </div>
                )}

                <div className="min-h-0 flex-1 overflow-y-auto p-2">
                    {books.length === 0 ? (
                        <p className="px-2 py-6 text-center text-[13px] leading-relaxed text-ink-500">
                            还没有项目。
                            <br />
                            点右上角「+ 新建」或「导入」开始。
                        </p>
                    ) : visibleBooks.length === 0 ? (
                        <p className="px-2 py-6 text-center text-[13px] leading-relaxed text-ink-500">
                            没有匹配「{bookQuery}」的项目
                        </p>
                    ) : (
                        <ul className="space-y-1">
                            {visibleBooks.map((item) => {
                                const kind = item.kind ?? 'novel';
                                return (
                                    <li key={item.id} className="group relative">
                                        <button
                                            type="button"
                                            onClick={() => void openBook(item)}
                                            className="w-full rounded-md px-2 py-2 text-left hover:bg-ink-800"
                                        >
                                            <div className="flex items-center gap-1.5">
                                                <span className="min-w-0 flex-1 truncate text-[14px] text-ink-100">
                                                    {item.title}
                                                </span>
                                                <span
                                                    className={`shrink-0 rounded px-1 py-0.5 text-[13px] ${KIND_TONE[kind]}`}
                                                >
                                                    {PROJECT_KINDS.find((k) => k.kind === kind)?.name ?? '小说'}
                                                </span>
                                            </div>
                                            <p className="mt-0.5 text-[13px] text-ink-500">
                                                {item.chapterCount} 篇 · {formatCharCount(item.charCount)}
                                                {item.lastEditedAt ? ` · ${formatTime(item.lastEditedAt)}` : ''}
                                            </p>
                                        </button>
                                        <button
                                            type="button"
                                            title="删除到回收站"
                                            onClick={() => handleRemoveBook(item.id, item.title)}
                                            className="absolute right-1 top-1.5 hidden h-5 w-5 items-center justify-center rounded text-ink-500 hover:bg-red-500/20 hover:text-red-400 group-hover:flex"
                                        >
                                            ×
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>

                <div className="border-t border-ink-800 p-2">
                    <button type="button" className="btn-ghost w-full justify-start" onClick={onOpenSettings}>
                        设置
                    </button>
                </div>
            </aside>
        );
    }

    // ---------- 项目视图 ----------
    return (
        <aside className="flex w-60 shrink-0 flex-col border-r border-ink-800 bg-ink-900">
            <div className="flex h-11 items-center gap-1 border-b border-ink-800 px-2">
                <button
                    type="button"
                    className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-ink-700 px-1.5 text-ink-300 transition-colors hover:border-jade-600 hover:bg-jade-500/10 hover:text-jade-400"
                    title="返回书库"
                    onClick={() => {
                        if (dirty) {
                            void useAppStore.getState().save();
                        }
                        closeBook();
                    }}
                >
                    <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    >
                        <path d="M15 18l-6-6 6-6" />
                    </svg>
                    <span className="text-[13px]">书库</span>
                </button>
                <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink-100">
                    {book.title}
                </span>
                <span
                    className={`shrink-0 rounded px-1 py-0.5 text-[13px] ${KIND_TONE[book.kind ?? 'novel']}`}
                >
                    {PROJECT_KINDS.find((k) => k.kind === (book.kind ?? 'novel'))?.name ?? '小说'}
                </span>
            </div>

            {/* 小说才有正文/细纲两栏 */}
            {features.beatSheet && (
                <div className="flex shrink-0 border-b border-ink-800">
                    {(
                        [
                            { key: 'zhengwen', label: '正文' },
                            { key: 'xigang', label: '细纲' },
                        ] as Array<{ key: ChapterSection; label: string }>
                    ).map((item) => (
                        <button
                            type="button"
                            key={item.key}
                            onClick={() => handleSection(item.key)}
                            className={`flex-1 border-b-2 py-2 text-[13px] transition-colors ${
                                section === item.key
                                    ? 'border-jade-500 text-jade-400'
                                    : 'border-transparent text-ink-500 hover:text-ink-300'
                            }`}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
            )}

            {/* 标签过滤 */}
            {tags.length > 0 && (
                <div className="flex shrink-0 flex-wrap gap-1 border-b border-ink-800 px-2 py-1.5">
                    {tags.slice(0, 12).map((tag) => (
                        <button
                            type="button"
                            key={tag}
                            onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                            className={`rounded px-1.5 py-0.5 text-[13px] ${
                                activeTag === tag
                                    ? 'bg-jade-500/20 text-jade-400'
                                    : 'bg-ink-800 text-ink-400 hover:text-ink-200'
                            }`}
                        >
                            #{tag}
                        </button>
                    ))}
                    {activeTag && (
                        <button
                            type="button"
                            onClick={() => setActiveTag(null)}
                            className="rounded px-1.5 py-0.5 text-[13px] text-ink-500 hover:text-ink-300"
                        >
                            清除
                        </button>
                    )}
                </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {visibleTree.length === 0 ? (
                    <p className="px-2 py-6 text-center text-[13px] leading-relaxed text-ink-500">
                        {activeTag ? `没有带 #${activeTag} 的文档` : '这里还没有内容。'}
                    </p>
                ) : (
                    <DocumentTree
                        nodes={visibleTree}
                        activeId={chapterId}
                        expanded={expanded}
                        onToggle={toggleFolder}
                        onOpen={(id) => void openChapter(id)}
                        onRemove={handleRemoveDocument}
                    />
                )}
            </div>

            <div className="space-y-1 border-t border-ink-800 p-2">
                {/* 新建文档 */}
                {docInputOpen ? (
                    <div className="flex gap-1">
                        <input
                            className="field h-7 flex-1 text-[13px]"
                            placeholder="文档标题"
                            autoFocus
                            value={docTitle}
                            onChange={(event) => setDocTitle(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    void submitNewDocument();
                                }
                                if (event.key === 'Escape') {
                                    setDocInputOpen(false);
                                }
                            }}
                        />
                        <button
                            type="button"
                            className="btn-outline h-7 shrink-0 px-2 text-[13px]"
                            onClick={() => void submitNewDocument()}
                        >
                            建
                        </button>
                    </div>
                ) : (
                    <button
                        type="button"
                        className="btn-outline w-full justify-start text-[13px]"
                        onClick={handleNewDocument}
                    >
                        + {features.createLabel}
                    </button>
                )}

                {/* 新建文件夹，仅非小说类型需要 */}
                {!features.numberedFiles &&
                    (folderInputOpen ? (
                        <div className="flex gap-1">
                            <input
                                className="field h-7 flex-1 text-[13px]"
                                placeholder="文件夹名"
                                autoFocus
                                value={folderName}
                                onChange={(event) => setFolderName(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                        void submitNewFolder();
                                    }
                                    if (event.key === 'Escape') {
                                        setFolderInputOpen(false);
                                    }
                                }}
                            />
                            <button
                                type="button"
                                className="btn-outline h-7 shrink-0 px-2 text-[13px]"
                                onClick={() => void submitNewFolder()}
                            >
                                建
                            </button>
                        </div>
                    ) : (
                        <button
                            type="button"
                            className="btn-ghost w-full justify-start text-[13px]"
                            onClick={() => setFolderInputOpen(true)}
                        >
                            + 新建文件夹
                        </button>
                    ))}

                {/* 写作工具，按项目类型显隐 */}
                {visibleTools.length > 0 && (
                    <>
                        <p className="px-1 pt-1 text-[13px] tracking-wider text-ink-600">工具</p>
                        <div className="grid grid-cols-2 gap-1">
                            {visibleTools.map((tool) => (
                                <button
                                    type="button"
                                    key={tool.key}
                                    onClick={() => setActiveView(tool.key)}
                                    className={`rounded-md px-1 py-1.5 text-[13px] transition-colors ${
                                        activeView === tool.key
                                            ? 'bg-jade-500/15 text-jade-400'
                                            : 'bg-ink-850 text-ink-300 hover:bg-ink-800 hover:text-ink-100'
                                    }`}
                                >
                                    {tool.generalLabel && !features.beatSheet
                                        ? tool.generalLabel
                                        : tool.label}
                                </button>
                            ))}
                        </div>
                    </>
                )}

                {features.outline8 && (
                    <button
                        type="button"
                        className="btn-ghost w-full justify-start text-[13px]"
                        onClick={onOpenOutline}
                    >
                        八问大纲
                    </button>
                )}
                <button
                    type="button"
                    className="btn-ghost w-full justify-start text-[13px]"
                    onClick={onOpenExport}
                >
                    导出
                </button>
                <button
                    type="button"
                    className="btn-ghost w-full justify-start text-[13px]"
                    onClick={onOpenSettings}
                >
                    设置
                </button>
            </div>
        </aside>
    );
}
