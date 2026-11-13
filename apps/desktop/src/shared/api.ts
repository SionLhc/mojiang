/**
 * 预加载脚本暴露给渲染进程的白名单 API 类型
 * 渲染进程只能看到这些方法，拿不到 fs / net / child_process。
 */

import type {
    Baseline,
    ChapterReport,
    ForeshadowFile,
    LedgerFile,
    PlatformSnapshot,
    WritingPackage,
    WritingStats,
} from '@mojiang/core';
import type { ChatMessage, PriceRule, ProviderId } from '@mojiang/llm';
import type {
    AppPaths,
    BookMeta,
    BookSummary,
    ChapterSection,
    ChapterSummary,
    ConnectionResult,
    CreateBookInput,
    ExportFormat,
    ExportResult,
    ImportResult,
    LlmChatParams,
    LlmStreamEvent,
    ProviderModels,
    QuickNoteResult,
    SearchResult,
    SnapshotEntry,
    TreeNode,
} from './types';

/** 设置结构（渲染进程视角，Key 不在其中） */
export interface SettingsView {
    version: number;
    firstRunDone: boolean;
    provider: { id: ProviderId; baseUrl: string; model: string };
    writing: {
        chapterWordTarget: number;
        forbiddenWords: string[];
        checklist: string[];
        perspective: 'first' | 'third';
    };
    ui: {
        rightPanelOpen: boolean;
        focusMode: boolean;
        fontSize: number;
        autoSnapshot: boolean;
        snapshotKeep: number;
        theme: 'paper' | 'snow' | 'green' | 'night';
        uiScale: number;
        bodyFont: 'system' | 'song' | 'kai' | 'hei';
    };
    ai: {
        /** 附加到系统提示的写作指令，会随每次请求发给模型 */
        styleGuide: string;
    };
    budget: { perChapterLimitCny: number; monthlyLimitCny: number };
    usage: {
        monthKey: string;
        costCny: number;
        calls: number;
        promptTokens: number;
        completionTokens: number;
    };
    prices?: PriceRule[];
}

/** 花费预估 */
export interface CostEstimate {
    promptTokens: number;
    estimatedOutputTokens: number;
    costCny: number;
    overChapterLimit: boolean;
    overMonthlyLimit: boolean;
}

/** 体检请求 */
export interface HealthCheckRequest {
    bookId: string;
    chapterId: string;
    title: string;
    text: string;
    /** 用于专有名词豁免 */
    properNouns: string[];
}

/** 渲染进程可用的全部能力 */
export interface MoJiangApi {
    library: {
        /** 列出所有书 */
        list(): Promise<BookSummary[]>;
        /** 建书 */
        create(input: CreateBookInput): Promise<BookMeta>;
        /** 删除到回收站 */
        remove(bookId: string): Promise<string>;
        /** 读元数据 */
        readMeta(bookId: string): Promise<BookMeta | null>;
        /** 保存元数据 */
        saveMeta(meta: BookMeta): Promise<void>;
        /** 列回收站 */
        listRecycleBin(): Promise<string[]>;
        /** 从回收站恢复 */
        restore(folderName: string): Promise<string>;
    };
    chapter: {
        list(bookId: string, section: ChapterSection): Promise<ChapterSummary[]>;
        read(bookId: string, section: ChapterSection, chapterId: string): Promise<string>;
        write(
            bookId: string,
            section: ChapterSection,
            chapterId: string,
            content: string,
        ): Promise<{ charCount: number; snapshotCreated: boolean }>;
        /** 新建文档，支持在指定文件夹下创建 */
        create(
            bookId: string,
            section: ChapterSection,
            title?: string,
            parentPath?: string,
        ): Promise<ChapterSummary>;
        /** 写标签到 frontmatter，返回新内容 */
        setTags(
            bookId: string,
            section: ChapterSection,
            chapterId: string,
            tags: string[],
        ): Promise<string>;
        remove(bookId: string, section: ChapterSection, chapterId: string): Promise<void>;
        /** 列快照 */
        snapshots(bookId: string, section: ChapterSection, chapterId: string): Promise<SnapshotEntry[]>;
        /** 读某份快照 */
        readSnapshot(
            bookId: string,
            section: ChapterSection,
            chapterId: string,
            fileName: string,
        ): Promise<string>;
    };
    file: {
        readText(bookId: string, relativePath: string): Promise<string>;
        writeText(bookId: string, relativePath: string, content: string): Promise<void>;
        readJson<T>(bookId: string, relativePath: string, fallback: T): Promise<T>;
        writeJson(bookId: string, relativePath: string, data: unknown): Promise<void>;
        list(bookId: string, relativeDir: string, extension: string): Promise<string[]>;
        remove(bookId: string, relativePath: string): Promise<void>;
    };
    data: {
        /** 读账本 */
        readLedger(bookId: string): Promise<LedgerFile>;
        /** 写账本 */
        writeLedger(bookId: string, ledger: LedgerFile): Promise<void>;
        /** 读伏笔 */
        readForeshadow(bookId: string): Promise<ForeshadowFile>;
        /** 写伏笔 */
        writeForeshadow(bookId: string, file: ForeshadowFile): Promise<void>;
        /** 读基线 */
        readBaseline(bookId: string): Promise<Baseline | null>;
        /** 写基线 */
        writeBaseline(bookId: string, baseline: Baseline): Promise<void>;
    };
    health: {
        /** 跑一次章节体检，纯本地计算 */
        check(request: HealthCheckRequest): Promise<ChapterReport>;
        /** 用若干章重建基线 */
        rebuildBaseline(bookId: string, chapterIds: string[]): Promise<Baseline>;
    };
    writingPackage: {
        /** 组装某一章的开写包；取不到的项会进 degraded */
        build(bookId: string, chapterId: string): Promise<WritingPackage>;
    };
    export: {
        /** 导出整本书，路径由用户在系统对话框里选 */
        book(bookId: string, format: ExportFormat): Promise<ExportResult>;
    };
    importer: {
        /** 选文件并导入，一个文件 = 一本新书，按章节标题自动拆分 */
        pick(): Promise<{ canceled: boolean; results: ImportResult[] }>;
    };
    market: {
        /** 抓取各平台榜单，失败的平台会在结果里标 degraded */
        fetch(bookId: string): Promise<PlatformSnapshot[]>;
        /** 把报告写进 报告/市场.md */
        saveReport(bookId: string, markdown: string): Promise<void>;
    };
    tree: {
        /** 读目录树，支持嵌套文件夹 */
        list(bookId: string, section: ChapterSection): Promise<TreeNode[]>;
        /** 新建文件夹 */
        createFolder(
            bookId: string,
            section: ChapterSection,
            name: string,
            parentPath?: string,
        ): Promise<string>;
    };
    search: {
        /** 跨项目全文搜索 */
        all(query: string): Promise<SearchResult>;
    };
    note: {
        /** 快速记录，落在收件箱 */
        quick(text: string): Promise<QuickNoteResult>;
    };
    plot: {
        /** 读剧情图，没有返回空图 */
        read(bookId: string): Promise<import('@mojiang/core').PlotGraph>;
        /** 保存剧情图 */
        write(bookId: string, graph: import('@mojiang/core').PlotGraph): Promise<void>;
    };
    stats: {
        /** 读码字统计 */
        read(): Promise<WritingStats>;
        /** 记一笔写作增量 */
        record(deltaChars: number, deltaSeconds: number): Promise<WritingStats>;
        /** 设置每日字数目标 */
        setGoal(goal: number): Promise<WritingStats>;
    };
    ui: {
        /** 设置界面缩放，超出 0.8-1.6 会被夹住 */
        setZoom(factor: number): void;
    };
    settings: {
        read(): Promise<SettingsView>;
        update(patch: Partial<SettingsView>): Promise<SettingsView>;
    };
    secrets: {
        set(providerId: ProviderId, apiKey: string): Promise<void>;
        has(providerId: ProviderId): Promise<boolean>;
        clear(providerId: ProviderId): Promise<void>;
        /** 当前加密方式说明 */
        describe(): Promise<string>;
    };
    llm: {
        test(providerId: ProviderId, baseUrl: string): Promise<ConnectionResult>;
        models(providerId: ProviderId, baseUrl: string): Promise<ProviderModels>;
        /** 发起流式对话，结果通过 onStream 事件推送 */
        chat(params: LlmChatParams): Promise<{ accepted: boolean; message?: string }>;
        cancel(requestId: string): Promise<void>;
        estimate(promptContents: string[], outputTokens: number): Promise<CostEstimate>;
        onStream(handler: (event: LlmStreamEvent) => void): void;
        offStream(): void;
    };
    app: {
        paths(): Promise<AppPaths>;
        /** 在系统文件管理器里打开书库根目录 */
        revealRoot(): Promise<void>;
        /** 弹目录选择框换书库位置 */
        changeRoot(): Promise<string | null>;
        openExternal(url: string): Promise<void>;
        minimize(): Promise<void>;
        maximize(): Promise<void>;
        close(): Promise<void>;
        version(): Promise<string>;
    };
}

/** 供渲染进程复用的聊天消息类型 */
export type { ChatMessage };
