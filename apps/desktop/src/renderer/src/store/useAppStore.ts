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
    /** 技能列表版本号：技能页增删改后 +1，AI 面板据此重新拉技能 */
    skillVersion: number;
    /** 编辑器里当前选中的文本，空字符串表示没有选中 */
    editorSelection: string;
    /** 待写回编辑器的文本（AI"替换选中"用），写完由编辑器消费掉 */
    pendingReplace: string | null;

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
    /** 新建文件夹，返回是否真的建成了（失败时已经弹过 toast） */
    createFolder: (name: string, parentPath?: string) => Promise<boolean>;
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
    /** 技能有增删改时通知 AI 面板重新拉取 */
    bumpSkills: () => void;
    /** 更新编辑器选中文本（相同值不触发更新） */
    setEditorSelection: (text: string) => void;
    /** 请求把文本替换到编辑器选区 */
    requestReplace: (text: string) => void;
    /** 编辑器写完清空替换请求 */
    consumeReplace: () => void;
    /** 段落改写请求（编辑器 hover 标注后置入，ChatPanel 负责发 AI） */
    segmentRequest: SegmentRewriteRequest | null;
    /** 段落改写结果（ChatPanel 收到 AI 回复后置入，EditorPane 弹对比） */
    segmentResult: SegmentRewriteResult | null;
    requestSegmentRewrite: (request: SegmentRewriteRequest) => void;
    clearSegmentRequest: () => void;
    setSegmentResult: (result: SegmentRewriteResult) => void;
    clearSegmentResult: () => void;
    restoreSnapshot: (fileName: string) => Promise<void>;
    /** 把一段文字追加到当前文档末尾并保存 */
    appendToChapter: (text: string) => Promise<void>;
    /** 把文字写到指定区（正文/细纲）：当前章优先，没有章节就新建 */
    appendToSection: (section: ChapterSection, text: string) => Promise<void>;
    /** 批量生成章节：正文建骨架、细纲按模板写大纲 */
    applyOutline: (items: Array<{ title: string; summary: string; content: string }>) => Promise<void>;
    /** 改书名：只改 book.json 的标题，目录名不动 */
    updateBookTitle: (title: string) => Promise<void>;
    refreshBooks: () => Promise<void>;
    createBook: (input: CreateBookInput) => Promise<void>;
    removeBook: (bookId: string) => Promise<void>;
    openBook: (book: BookSummary) => Promise<void>;
    closeBook: () => void;
    setSection: (section: ChapterSection) => Promise<void>;
    openChapter: (chapterId: string) => Promise<void>;
    /** 新建一篇内容，返回是否真的建成了（失败时已经弹过 toast） */
    createChapter: (title?: string, parentPath?: string) => Promise<boolean>;
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

/** 段落改写请求：编辑器里标注一段交给 AI 改 */
export interface SegmentRewriteRequest {
    /** 段落原文 */
    text: string;
    /** 作者的修改标注 */
    note: string;
    /** 文档内起止位置 */
    from: number;
    to: number;
}

/** 段落改写结果：AI 改完，编辑器弹对比 */
export interface SegmentRewriteResult {
    /** 原文（对比用） */
    original: string;
    /** AI 改后的文本 */
    rewritten: string;
    /** 文档内起止位置 */
    from: number;
    to: number;
}

/**
 * 细纲模板：菜单要写清楚这道菜是什么、用什么做的
 * 正文（成品）照它做菜，AI 也靠它判断本章要发生什么
 * @param item 章节数据
 * @returns 细纲 Markdown
 */
function buildOutlineMarkdown(item: { title: string; summary: string; content: string }): string {
    const points: string[] = [];
    if (item.summary) {
        points.push(`- ${item.summary}`);
    }
    if (item.content) {
        points.push(item.content);
    }
    if (points.length === 0) {
        points.push('（待补：这一章要发生什么）');
    }
    return [
        `# ${item.title}`,
        '',
        '## 本章要点',
        ...points,
        '',
        '## 世界观',
        '（本章涉及的设定、规则、地点）',
        '',
        '## 冲突原则',
        '（这一章的冲突从哪来、谁和谁、为什么不可调和）',
        '',
        '## 冲突事件',
        '（具体事件：起因、升级、收场）',
        '',
        '## 出场人物',
        '（谁出场、在这一章的诉求）',
        '',
        '## 涉及伏笔',
        '（本章要埋或要回收的伏笔）',
        '',
        '## 呼应前文',
        '（要呼应哪一章的什么）',
        '',
    ].join('\n');
}

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
    skillVersion: 0,
    editorSelection: '',
    pendingReplace: null,
    segmentRequest: null,
    segmentResult: null,
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
            return false;
        }
        try {
            await window.api.tree.createFolder(book.id, section, name, parentPath);
            await get().refreshTree();
            return true;
        } catch (error) {
            get().pushToast('error', errorMessage(error));
            return false;
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

    bumpSkills: () => {
        set({ skillVersion: get().skillVersion + 1 });
    },

    setEditorSelection: (text) => {
        // 光标随手一动就会调这里，值没变就不 set，免得整栏重渲染
        if (get().editorSelection === text) {
            return;
        }
        set({ editorSelection: text });
    },

    requestReplace: (text) => {
        set({ pendingReplace: text });
    },

    consumeReplace: () => {
        set({ pendingReplace: null });
    },

    requestSegmentRewrite: (request) => {
        set({ segmentRequest: request, segmentResult: null });
    },

    clearSegmentRequest: () => {
        set({ segmentRequest: null });
    },

    setSegmentResult: (result) => {
        set({ segmentResult: result });
    },

    clearSegmentResult: () => {
        set({ segmentResult: null });
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

    appendToSection: async (targetSection, text) => {
        const { book, section: currentSection, chapterId } = get();
        if (!book) {
            get().pushToast('info', '先打开一个项目');
            return;
        }
        const trimmed = text.trim();
        if (trimmed.length === 0) {
            return;
        }
        const sectionLabel = targetSection === 'xigang' ? '细纲' : '正文';
        try {
            // 目标区当前章优先；没有就取第一篇；一篇都没有就先建「大纲」
            let targetId: string | null = null;
            if (targetSection === currentSection && chapterId) {
                targetId = chapterId;
            } else {
                const list = await window.api.chapter.list(book.id, targetSection);
                targetId = list[0]?.id ?? null;
            }
            if (!targetId) {
                const created = await window.api.chapter.create(book.id, targetSection, '大纲');
                targetId = created.id;
            }
            const existing = await window.api.chapter.read(book.id, targetSection, targetId);
            const next = `${existing.replace(/\s+$/, '')}\n\n${trimmed}\n`;
            await window.api.chapter.write(book.id, targetSection, targetId, next);

            // 刷新区与树；正好是当前区当前章时同步编辑器内容
            const [chapters, tree] = await Promise.all([
                window.api.chapter.list(book.id, targetSection),
                window.api.tree.list(book.id, targetSection),
            ]);
            if (targetSection === get().section) {
                set({ chapters, tree });
            }
            if (targetSection === get().section && targetId === get().chapterId) {
                set({ content: next, savedContent: next });
            }
            get().pushToast('success', `已写入${sectionLabel}`);
        } catch (error) {
            get().pushToast('error', errorMessage(error));
        }
    },

    applyOutline: async (items) => {
        const { book } = get();
        if (!book || items.length === 0) {
            return;
        }
        try {
            const createdIds: string[] = [];
            for (const item of items) {
                // 正文：只建空骨架章，标题进正文一级标题（正文是成品，等「按细纲写本章」再填）
                const bodyChapter = await window.api.chapter.create(book.id, 'zhengwen', item.title);
                createdIds.push(bodyChapter.id);
                // 细纲：按模板写，菜单要写清这道菜是什么、用什么做的
                const outlineChapter = await window.api.chapter.create(book.id, 'xigang', item.title);
                await window.api.chapter.write(
                    book.id,
                    'xigang',
                    outlineChapter.id,
                    buildOutlineMarkdown(item),
                );
            }
            const [chapters, tree] = await Promise.all([
                window.api.chapter.list(book.id, get().section),
                window.api.tree.list(book.id, get().section),
            ]);
            set({ chapters, tree });
            if (createdIds.length > 0) {
                await get().openChapter(createdIds[0]);
            }
            get().pushToast('success', `已生成 ${items.length} 章：正文骨架 + 细纲大纲`);
        } catch (error) {
            get().pushToast('error', errorMessage(error));
        }
    },

    updateBookTitle: async (title) => {
        const { book } = get();
        if (!book) {
            return;
        }
        const trimmed = title.trim();
        if (trimmed.length === 0 || trimmed === book.title) {
            return;
        }
        try {
            const meta = await window.api.library.readMeta(book.id);
            if (!meta) {
                throw new Error('书的信息读不到');
            }
            await window.api.library.saveMeta({
                ...meta,
                title: trimmed,
                updatedAt: new Date().toISOString(),
            });
            set({ book: { ...book, title: trimmed } });
            await get().refreshBooks();
            get().pushToast('success', '书名已更新');
        } catch (error) {
            get().pushToast('error', errorMessage(error));
        }
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
            return false;
        }
        try {
            const chapter = await window.api.chapter.create(book.id, section, title, parentPath);
            const [chapters, tree] = await Promise.all([
                window.api.chapter.list(book.id, section),
                window.api.tree.list(book.id, section),
            ]);
            set({ chapters, tree });
            await get().openChapter(chapter.id);
            return true;
        } catch (error) {
            // 失败时把原因说清楚，调用方会保留输入框让用户重试
            get().pushToast('error', errorMessage(error));
            return false;
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
