/**
 * 全局状态
 * 用 Zustand 而不是 Redux：桌面应用只有一个窗口，状态树不大，轻量够用。
 * 所有磁盘读写都从这里发，组件里不直接调 window.api，方便统一错误处理。
 */

import { create } from 'zustand';
import { getProjectFeatures, type ChapterReport, type ForeshadowFile, type LedgerFile } from '@mojiang/core';
import type { SettingsView } from '@shared/api';
import type {
    AppPaths,
    BookSummary,
    ChapterSection,
    ChapterSummary,
    CreateBookInput,
    SearchResult,
    TreeNode,
} from '@shared/types';
import { errorMessage } from '@/lib/format';

/** 提示条类型 */
export type ToastKind = 'info' | 'success' | 'error';

/** 中栏当前显示的视图：正文编辑器或各类工具面板 */
export type WorkspaceView =
    | 'chapter'
    | 'ledger'
    | 'foreshadow'
    | 'characters'
    | 'golden3'
    | 'package'
    | 'market'
    | 'plot'
    | 'stats'
    | 'materials'
    | 'sensitive'
    | 'diagram'
    | 'mindboard';

/** 最近一次编辑正文的时间戳，给码字计时用 */
let lastEditAt = 0;

/**
 * 最近 3 分钟内有没有编辑过正文
 * 计时心跳用它判断这一分钟算不算"在写作"
 * @returns 是否在写
 */
export function hasRecentEdit(): boolean {
    return Date.now() - lastEditAt < 3 * 60 * 1000;
}

/** 一条提示 */
export interface Toast {
    id: number;
    kind: ToastKind;
    message: string;
}

/** 全局状态 */
interface AppStore {
    ready: boolean;
    paths: AppPaths | null;
    settings: SettingsView | null;
    books: BookSummary[];
    book: BookSummary | null;
    section: ChapterSection;
    chapters: ChapterSummary[];
    /** 目录树，支持嵌套文件夹 */
    tree: TreeNode[];
    chapterId: string | null;
    content: string;
    savedContent: string;
    saving: boolean;
    report: ChapterReport | null;
    checking: boolean;
    /** 专有名词豁免表：账本主体 + 人设文件名 */
    properNouns: string[];
    ledger: LedgerFile | null;
    foreshadow: ForeshadowFile | null;
    toasts: Toast[];
    /** 中栏显示哪个视图 */
    activeView: WorkspaceView;
    /** 右栏当前页签 */
    rightTab: 'health' | 'chat';
    /** 待注入 AI 对话输入框的内容（开写包"发给 AI"用） */
    pendingPrompt: string | null;

    /** 搜索面板 */
    searchOpen: boolean;
    searchQuery: string;
    searchResult: SearchResult | null;
    searching: boolean;
    /** 快速记录弹窗 */
    quickNoteOpen: boolean;
    /** 设置弹窗（放全局，顶栏和侧栏都能打开） */
    settingsOpen: boolean;
    /** 当前按哪个标签过滤，null 表示不筛 */
    activeTag: string | null;

    bootstrap: () => Promise<void>;
    refreshTree: () => Promise<void>;
    createFolder: (name: string, parentPath?: string) => Promise<void>;
    setDocumentTags: (chapterId: string, tags: string[]) => Promise<void>;
    openSearch: () => void;
    closeSearch: () => void;
    runSearch: (query: string) => Promise<void>;
    openQuickNote: () => void;
    closeQuickNote: () => void;
    submitQuickNote: (text: string) => Promise<void>;
    openSettings: () => void;
    closeSettings: () => void;
    setActiveTag: (tag: string | null) => void;
    /** 从搜索结果跳到某个文档 */
    jumpToDocument: (
        bookId: string,
        section: ChapterSection,
        chapterId: string,
    ) => Promise<void>;
    setActiveView: (view: WorkspaceView) => void;
    setRightTab: (tab: 'health' | 'chat') => void;
    saveLedger: (ledger: LedgerFile) => Promise<void>;
    saveForeshadow: (file: ForeshadowFile) => Promise<void>;
    setPendingPrompt: (text: string | null) => void;
    restoreSnapshot: (fileName: string) => Promise<void>;
    /** 把一段文字追加到当前文档末尾并保存 */
    appendToChapter: (text: string) => Promise<void>;
    refreshBooks: () => Promise<void>;
    createBook: (input: CreateBookInput) => Promise<void>;
    removeBook: (bookId: string) => Promise<void>;
    openBook: (book: BookSummary) => Promise<void>;
    closeBook: () => void;
    setSection: (section: ChapterSection) => Promise<void>;
    openChapter: (chapterId: string) => Promise<void>;
    createChapter: (title?: string, parentPath?: string) => Promise<void>;
    removeChapter: (chapterId: string) => Promise<void>;
    setContent: (text: string) => void;
    save: () => Promise<void>;
    check: () => Promise<void>;
    rebuildBaseline: (chapterIds: string[]) => Promise<void>;
    updateSettings: (patch: Partial<SettingsView>) => Promise<void>;
    reloadBookData: () => Promise<void>;
    pushToast: (kind: ToastKind, message: string) => void;
    dismissToast: (id: number) => void;
}

/** 提示条自增 id */
let toastSequence = 0;

/**
 * 创建状态
 */
export const useAppStore = create<AppStore>((set, get) => ({
    ready: false,
    paths: null,
    settings: null,
    books: [],
    book: null,
    section: 'zhengwen',
    chapters: [],
    tree: [],
    chapterId: null,
    content: '',
    savedContent: '',
    saving: false,
    report: null,
    checking: false,
    properNouns: [],
    ledger: null,
    foreshadow: null,
    toasts: [],
    activeView: 'chapter',
    rightTab: 'health',
    pendingPrompt: null,
    searchOpen: false,
    searchQuery: '',
    searchResult: null,
    searching: false,
    quickNoteOpen: false,
    settingsOpen: false,
    activeTag: null,

    refreshTree: async () => {
        const { book, section } = get();
        if (!book) {
            set({ tree: [] });
            return;
        }
        try {
            const tree = await window.api.tree.list(book.id, section);
            set({ tree });
        } catch (error) {
            get().pushToast('error', errorMessage(error));
        }
    },

    createFolder: async (name, parentPath) => {
        const { book, section } = get();
        if (!book) {
            return;
        }
        try {
            await window.api.tree.createFolder(book.id, section, name, parentPath);
            await get().refreshTree();
        } catch (error) {
            get().pushToast('error', errorMessage(error));
        }
    },

    setDocumentTags: async (chapterId, tags) => {
        const { book, section, content } = get();
        if (!book) {
            return;
        }
        try {
            const next = await window.api.chapter.setTags(book.id, section, chapterId, tags);
            // 只有改的是当前这篇才同步编辑器内容
            if (get().chapterId === chapterId) {
                set({ content: next, savedContent: next });
            }
            await get().refreshTree();
            void content;
        } catch (error) {
            get().pushToast('error', errorMessage(error));
        }
    },

    openSearch: () => {
        set({ searchOpen: true });
    },

    closeSearch: () => {
        set({ searchOpen: false, searchQuery: '', searchResult: null });
    },

    runSearch: async (query) => {
        set({ searchQuery: query });
        if (query.trim().length === 0) {
            set({ searchResult: null });
            return;
        }
        set({ searching: true });
        try {
            const result = await window.api.search.all(query);
            set({ searchResult: result });
        } catch (error) {
            get().pushToast('error', errorMessage(error));
        } finally {
            set({ searching: false });
        }
    },

    openQuickNote: () => {
        set({ quickNoteOpen: true });
    },

    closeQuickNote: () => {
        set({ quickNoteOpen: false });
    },

    openSettings: () => {
        set({ settingsOpen: true });
    },

    closeSettings: () => {
        set({ settingsOpen: false });
    },

    submitQuickNote: async (text) => {
        try {
            const result = await window.api.note.quick(text);
            set({ quickNoteOpen: false });
            await get().refreshBooks();
            get().pushToast('success', `已记到「收件箱 / ${result.title}」`);
        } catch (error) {
            get().pushToast('error', errorMessage(error));
        }
    },

    setActiveTag: (tag) => {
        set({ activeTag: tag });
    },

    jumpToDocument: async (bookId, section, chapterId) => {
        const { books, book } = get();
        if (book?.id !== bookId) {
            const target = books.find((item) => item.id === bookId);
            if (!target) {
                get().pushToast('error', '找不到这个项目，可能已经被删了');
                return;
            }
            await get().openBook(target);
        }
        if (get().section !== section) {
            await get().setSection(section);
        }
        await get().openChapter(chapterId);
    },

    setActiveView: (view) => {
        set({ activeView: view });
    },

    setRightTab: (tab) => {
        set({ rightTab: tab });
    },

    setPendingPrompt: (text) => {
        set({ pendingPrompt: text });
    },

    appendToChapter: async (text) => {
        const { book, chapterId, content } = get();
        if (!book || !chapterId) {
            get().pushToast('info', '先在左边打开一篇文档再接');
            return;
        }
        const trimmed = text.trim();
        if (trimmed.length === 0) {
            return;
        }
        // 追加到末尾，保留原有段落间距
        const next = `${content.replace(/\s+$/, '')}\n\n${trimmed}\n`;
        set({ content: next, activeView: 'chapter' });
        await get().save();
        get().pushToast('success', '已追加到本章末尾');
    },

    restoreSnapshot: async (fileName) => {
        const { book, section, chapterId } = get();
        if (!book || !chapterId) {
            return;
        }
        try {
            const text = await window.api.chapter.readSnapshot(book.id, section, chapterId, fileName);
            // 写回时主进程会先把当前内容存成快照，所以这次回滚本身也能再撤销
            await window.api.chapter.write(book.id, section, chapterId, text);
            set({ content: text, savedContent: text, report: null, activeView: 'chapter' });
            await get().check();
            const chapters = await window.api.chapter.list(book.id, section);
            set({ chapters });
            get().pushToast('success', '已回滚到该版本；回滚前的内文也已存成快照');
        } catch (error) {
            get().pushToast('error', `回滚失败：${errorMessage(error)}`);
        }
    },

    saveLedger: async (ledger) => {
        const { book } = get();
        if (!book) {
            return;
        }
        try {
            await window.api.data.writeLedger(book.id, ledger);
            const characterFiles = await window.api.file.list(book.id, '人设', '.md');
            set({
                ledger,
                properNouns: [
                    ...Object.keys(ledger.tree),
                    ...characterFiles.map((name) => name.replace(/\.md$/, '')),
                ],
            });
        } catch (error) {
            get().pushToast('error', errorMessage(error));
        }
    },

    saveForeshadow: async (file) => {
        const { book } = get();
        if (!book) {
            return;
        }
        try {
            await window.api.data.writeForeshadow(book.id, file);
            set({ foreshadow: file });
        } catch (error) {
            get().pushToast('error', errorMessage(error));
        }
    },

    bootstrap: async () => {
        try {
            const [paths, settings] = await Promise.all([
                window.api.app.paths(),
                window.api.settings.read(),
            ]);
            set({ paths, settings, ready: true });
            await get().refreshBooks();
        } catch (error) {
            set({ ready: true });
            get().pushToast('error', errorMessage(error));
        }
    },

    refreshBooks: async () => {
        try {
            const books = await window.api.library.list();
            set({ books });
        } catch (error) {
            get().pushToast('error', errorMessage(error));
        }
    },

    createBook: async (input) => {
        try {
            const meta = await window.api.library.create(input);
            await get().refreshBooks();
            const created = get().books.find((item) => item.id === meta.id);
            if (created) {
                await get().openBook(created);
            }
        } catch (error) {
            get().pushToast('error', errorMessage(error));
        }
    },

    removeBook: async (bookId) => {
        try {
            await window.api.library.remove(bookId);
            if (get().book?.id === bookId) {
                get().closeBook();
            }
            await get().refreshBooks();
            get().pushToast('success', '已经放进回收站，可以恢复');
        } catch (error) {
            get().pushToast('error', errorMessage(error));
        }
    },

    openBook: async (book) => {
        set({
            book,
            section: 'zhengwen',
            chapterId: null,
            chapters: [],
            content: '',
            savedContent: '',
            report: null,
            ledger: null,
            foreshadow: null,
            activeView: 'chapter',
        });
        try {
            const [chapters, tree, ledger, foreshadow, characterFiles] = await Promise.all([
                window.api.chapter.list(book.id, 'zhengwen'),
                window.api.tree.list(book.id, 'zhengwen'),
                window.api.data.readLedger(book.id),
                window.api.data.readForeshadow(book.id),
                window.api.file.list(book.id, '人设', '.md'),
            ]);
            const properNouns = [
                ...Object.keys(ledger.tree),
                ...characterFiles.map((name) => name.replace(/\.md$/, '')),
            ];
            // 笔记项目没有体检，右栏直接落在 AI 对话上
            const rightTab = getProjectFeatures(book.kind).health ? get().rightTab : 'chat';
            set({ chapters, tree, ledger, foreshadow, properNouns, rightTab });
            if (chapters.length > 0) {
                await get().openChapter(chapters[0].id);
            }
        } catch (error) {
            get().pushToast('error', errorMessage(error));
        }
    },

    closeBook: () => {
        set({
            book: null,
            chapters: [],
            tree: [],
            chapterId: null,
            content: '',
            savedContent: '',
            report: null,
            ledger: null,
            foreshadow: null,
            activeView: 'chapter',
            activeTag: null,
        });
    },

    setSection: async (section) => {
        const { book } = get();
        if (!book) {
            return;
        }
        set({ section, chapterId: null, content: '', savedContent: '', report: null, activeTag: null });
        try {
            const [chapters, tree] = await Promise.all([
                window.api.chapter.list(book.id, section),
                window.api.tree.list(book.id, section),
            ]);
            set({ chapters, tree });
            if (chapters.length > 0) {
                await get().openChapter(chapters[0].id);
            }
        } catch (error) {
            get().pushToast('error', errorMessage(error));
        }
    },

    openChapter: async (chapterId) => {
        const { book, section, content, savedContent } = get();
        if (!book) {
            return;
        }
        // 有未保存改动时先落盘，避免切章丢字
        if (content !== savedContent) {
            await get().save();
        }
        try {
            const text = await window.api.chapter.read(book.id, section, chapterId);
            set({ chapterId, content: text, savedContent: text, report: null, activeView: 'chapter' });
            await get().check();
        } catch (error) {
            get().pushToast('error', errorMessage(error));
        }
    },

    createChapter: async (title, parentPath) => {
        const { book, section } = get();
        if (!book) {
            return;
        }
        try {
            const chapter = await window.api.chapter.create(book.id, section, title, parentPath);
            const [chapters, tree] = await Promise.all([
                window.api.chapter.list(book.id, section),
                window.api.tree.list(book.id, section),
            ]);
            set({ chapters, tree });
            await get().openChapter(chapter.id);
        } catch (error) {
            get().pushToast('error', errorMessage(error));
        }
    },

    removeChapter: async (chapterId) => {
        const { book, section } = get();
        if (!book) {
            return;
        }
        try {
            await window.api.chapter.remove(book.id, section, chapterId);
            const [chapters, tree] = await Promise.all([
                window.api.chapter.list(book.id, section),
                window.api.tree.list(book.id, section),
            ]);
            set({ chapters, tree, chapterId: null, content: '', savedContent: '', report: null });
            if (chapters.length > 0) {
                await get().openChapter(chapters[0].id);
            }
            get().pushToast('success', '章节已移入书内回收站');
        } catch (error) {
            get().pushToast('error', errorMessage(error));
        }
    },

    setContent: (text) => {
        // 记一下最近编辑时间，给码字计时心跳判断"还在不在写"
        lastEditAt = Date.now();
        set({ content: text });
    },

    save: async () => {
        const { book, section, chapterId, content, savedContent, saving } = get();
        if (!book || !chapterId || saving) {
            return;
        }
        set({ saving: true });
        try {
            await window.api.chapter.write(book.id, section, chapterId, content);
            // 码字统计：只记新增字数，删改不倒扣
            const addedChars = Math.max(
                0,
                content.replace(/\s/g, '').length - savedContent.replace(/\s/g, '').length,
            );
            if (addedChars > 0) {
                void window.api.stats.record(addedChars, 0);
            }
            set({ savedContent: content });
            const chapters = await window.api.chapter.list(book.id, section);
            set({ chapters });
            // 标题和字数可能变了，后台刷一下树，不阻塞保存
            void get().refreshTree();
        } catch (error) {
            get().pushToast('error', `保存失败：${errorMessage(error)}`);
        } finally {
            set({ saving: false });
        }
    },

    check: async () => {
        const { book, chapterId, content, properNouns } = get();
        if (!book || !chapterId) {
            return;
        }
        if (content.trim().length === 0) {
            set({ report: null });
            return;
        }
        set({ checking: true });
        try {
            const chapter = get().chapters.find((item) => item.id === chapterId);
            const report = await window.api.health.check({
                bookId: book.id,
                chapterId,
                title: chapter?.title ?? '',
                text: content,
                properNouns,
            });
            set({ report });
        } catch (error) {
            get().pushToast('error', `体检失败：${errorMessage(error)}`);
        } finally {
            set({ checking: false });
        }
    },

    rebuildBaseline: async (chapterIds) => {
        const { book } = get();
        if (!book) {
            return;
        }
        try {
            const baseline = await window.api.health.rebuildBaseline(book.id, chapterIds);
            get().pushToast(
                'success',
                `基线已更新，取样 ${baseline.sampleChapters.length} 章`,
            );
            await get().check();
        } catch (error) {
            get().pushToast('error', errorMessage(error));
        }
    },

    updateSettings: async (patch) => {
        try {
            const settings = await window.api.settings.update(patch);
            set({ settings });
        } catch (error) {
            get().pushToast('error', errorMessage(error));
        }
    },

    reloadBookData: async () => {
        const { book } = get();
        if (!book) {
            return;
        }
        try {
            const [ledger, foreshadow, characterFiles] = await Promise.all([
                window.api.data.readLedger(book.id),
                window.api.data.readForeshadow(book.id),
                window.api.file.list(book.id, '人设', '.md'),
            ]);
            set({
                ledger,
                foreshadow,
                properNouns: [
                    ...Object.keys(ledger.tree),
                    ...characterFiles.map((name) => name.replace(/\.md$/, '')),
                ],
            });
        } catch (error) {
            get().pushToast('error', errorMessage(error));
        }
    },

    pushToast: (kind, message) => {
        toastSequence += 1;
        const id = toastSequence;
        set((state) => ({ toasts: [...state.toasts, { id, kind, message }] }));
        window.setTimeout(() => {
            get().dismissToast(id);
        }, 4000);
    },

    dismissToast: (id) => {
        set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
    },
}));

// 调试出口：自动化验证和无头截图需要读当前状态
if (typeof window !== 'undefined') {
    (window as unknown as { __mojiangStore: typeof useAppStore }).__mojiangStore = useAppStore;
}
