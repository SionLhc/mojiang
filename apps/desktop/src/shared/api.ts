/**
 * 预加载脚本暴露给渲染进程的白名单 API 类型
 * 渲染进程只能看到这些方法，拿不到 fs / net / child_process。
 */

import type {
    Baseline,
    ChapterReport,
    ForeshadowFile,
    HumanTrace,
    LedgerFile,
    MarketSkillState,
    PlatformSnapshot,
    PreferenceModule,
    PreferencePair,
    PreferenceStats,
    Skill,
    StyleMetrics,
    WritingPackage,
    WritingStats,
} from '@mojiang/core';
import type { ChatMessage, PriceRule, ProviderId } from '@mojiang/llm';
import type {
    AppPaths,
    BookMeta,
    BookSummary,
    ChapterRecycleEntry,
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
    RecycleBookEntry,
    SearchResult,
    SnapshotEntry,
    TreeNode,
} from './types';

/** 设置结构（渲染进程视角，Key 不在其中） */
export interface SettingsView {
    version: number;
    firstRunDone: boolean;
    provider: {
        id: ProviderId;
        baseUrl: string;
        model: string;
        /** 模型上下文窗口（token），0 表示没填、按默认档带上下文 */
        contextWindow: number;
    };
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
        theme: 'mist' | 'dusk' | 'paper' | 'snow' | 'green' | 'night';
        uiScale: number;
        bodyFont: 'system' | 'song' | 'kai' | 'hei';
    };
    ai: {
        /** 小说的附加写作指令，会随每次请求发给模型 */
        novelStyleGuide: string;
        /** 工作文档的附加指令 */
        docsStyleGuide: string;
        /** 笔记的附加指令 */
        notesStyleGuide: string;
        /** 学作者的改法（偏好蒸馏） */
        preferenceLearn: boolean;
        /** 把学到的改法注入提示 */
        preferenceInject: boolean;
        /** 记录我的笔感（自蒸馏） */
        personalTraceLearn: boolean;
        /** 把我的笔感注入提示 */
        personalTraceInject: boolean;
    };
    skill: {
        /** 外部清单地址，空表示只用内置精选 */
        marketIndexUrl: string;
    };
    budget: { perChapterLimitCny: number; monthlyLimitCny: number };
    usage: {
        monthKey: string;
        costCny: number;
        calls: number;
        promptTokens: number;
        completionTokens: number;
    };
    /** AI 建议命中统计：采纳率 = adopted / suggestions */
    aiStats: { suggestions: number; adopted: number };
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

/** 安装技能的结果：失败用 message 带回中文原因，不抛异常 */
export type SkillInstallResponse =
    | { ok: true; skill: Skill; replaced: boolean }
    | { ok: false; message: string };

/** 加载外部技能清单的结果，形状同上：错误不当异常抛 */
export type MarketLoadResponse =
    | { ok: true; items: MarketSkillState[] }
    | { ok: false; message: string };

/** 偏好概览：设置页展示"学到了什么"用 */
export interface PreferenceOverview {
    /** 学到的改法，新的在前 */
    pairs: PreferencePair[];
    /** 累计计数 */
    stats: PreferenceStats;
    /** 还挂着几条待验证（作者保存后才会对齐） */
    pending: number;
}

/** 一份蒸馏素材的概要 */
export interface StyleFileInfo {
    /** 绝对路径 */
    path: string;
    /** 文件名 */
    name: string;
    /** 正文字数；读不了是 0 */
    chars: number;
}

/** 段落归属的累计计数 */
export interface PersonalTraceCounts {
    /** 自己写的段落 */
    human: number;
    /** 自己重写过的段落 */
    revised: number;
    /** AI 原样留着、被剔掉的段落 */
    ai: number;
}

/** 我的笔感概览：作者自己写出来的画像 */
export interface PersonalTraceOverview {
    /** 累计字数 */
    charCount: number;
    /** 累计加权字数（重写段落按半价） */
    effectiveChars: number;
    /** 人味分 0-100 */
    humanScore: number;
    /** 成熟度：收集 / 成型 / 稳定 */
    stage: 'collecting' | 'forming' | 'stable';
    /** 距成型还差多少字 */
    toForming: number;
    /** 距稳定还差多少字 */
    toStable: number;
    /** 最后更新时间（ISO） */
    updatedAt: string;
    /** 采过多少章 */
    chapterCount: number;
    /** 近 7 天采到的字数 */
    recentChars: number;
    /** 段落归属累计 */
    counts: PersonalTraceCounts;
    /** 画像指标 */
    trace: HumanTrace;
    /** 人味分折线的点 */
    points: Array<{ at: string; humanScore: number; effectiveChars: number }>;
    /** 写法漂移总结；样本不够时为 null */
    drift: PersonalDriftSummary | null;
    /** 当前是否会注入（收集阶段不注入） */
    injecting: boolean;
    /** 可以选作参照的历史快照 */
    snapshots: Array<{ at: string; effectiveChars: number; humanScore: number }>;
    /** 当前参照的旧写法时间；没设参照时为 null */
    anchorAt: string | null;
}

/** 写法漂移的白话总结 */
export interface PersonalDriftSummary {
    /** 一句话总述 */
    headline: string;
    /** 逐条变化 */
    items: string[];
}

/** 拼给模型的我的笔感提示 */
export interface PersonalPromptResult {
    /** 成熟度 */
    stage: 'collecting' | 'forming' | 'stable';
    /** 提示块；还在收集阶段时是空串 */
    block: string;
    /** 用了几段作者原文当示范 */
    excerptCount: number;
}

/** 已攒下的人味样本概览 */
export interface HumanTraceOverview {
    /** 参考过几本书 */
    sourceCount: number;
    /** 累计字数 */
    charCount: number;
    /** 人味分 0-100 */
    humanScore: number;
    /** 最后更新时间（ISO） */
    updatedAt: string;
    /** 参考过的书名 */
    names: string[];
}

/** 蒸馏结果：失败带中文原因，不抛异常 */
export type StyleDistillResponse =
    | {
          ok: true;
          skill: Skill;
          metrics: StyleMetrics;
          sources: Array<{ name: string; chars: number }>;
          /** 本次新增或更新的书名 */
          added: string[];
          /** 累积人味分 */
          humanScore: number;
      }
    | { ok: false; message: string };

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
        /** 列回收站（原书名 + 删除时间，新的在前） */
        listRecycleBin(): Promise<RecycleBookEntry[]>;
        /** 从回收站恢复，返回恢复后的书 id */
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
        /** 列本书回收站里的文章，新的在前 */
        listRecycle(bookId: string): Promise<ChapterRecycleEntry[]>;
        /** 从本书回收站恢复一篇文章，返回恢复后的章节 id */
        restoreRecycle(bookId: string, fileName: string): Promise<string>;
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
    recap: {
        /** 读前情提要，没有时内容为空串 */
        read(bookId: string): Promise<{ content: string; exists: boolean }>;
        /** 用剧情画板整理一份草稿（不调模型） */
        draft(
            bookId: string,
        ): Promise<{ content: string; nodes: number; chapters: number; unlocated: number }>;
        /** 保存前情提要 */
        save(bookId: string, content: string): Promise<void>;
    };
    mindboard: {
        /** 读导图画板，没有返回空图 */
        read(bookId: string): Promise<import('@mojiang/core').MindBoardGraph>;
        /** 保存导图画板 */
        write(bookId: string, graph: import('@mojiang/core').MindBoardGraph): Promise<void>;
    };
    writing: {
        /** 组装写作上下文包：当前章正文 + 细纲 + 开写包各项 + 剧情画板摘要 */
        context(
            bookId: string,
            chapterId: string | null,
        ): Promise<{
            body: string;
            outline: string;
            items: Array<{ key: string; label: string; content: string }>;
            plot: string;
            chapterNumber: number;
        }>;
    };
    attachment: {
        /** 打开系统选择框挑文档，返回提取后的纯文本（失败的项单独在 errors） */
        pick(): Promise<{
            items: Array<{ name: string; ext: string; text: string; chars: number; truncated: boolean }>;
            errors: Array<{ name: string; message: string }>;
        }>;
        /** 按路径提取（拖拽/粘贴进来的文件用） */
        extract(filePaths: string[]): Promise<{
            items: Array<{ name: string; ext: string; text: string; chars: number; truncated: boolean }>;
            errors: Array<{ name: string; message: string }>;
        }>;
        /** 取拖拽/粘贴文件的实际路径（Electron 32 起 File.path 已移除） */
        pathForFile(file: File): string;
        /** 图片识别：本地 OCR 提取图片里的文字 */
        ocrImage(
            bytes: Uint8Array,
            mimeType: string,
        ): Promise<{ ok: boolean; text: string; message?: string }>;
    };
    skill: {
        /** 列出全部技能（内置在前） */
        list(): Promise<Skill[]>;
        /** 弹文件框导入技能文件，返回导入的技能 */
        import(): Promise<{ canceled: boolean; skill?: Skill; message?: string }>;
        /** 拖拽安装：传本地文件路径（路径由 attachment.pathForFile 取得） */
        installPath(filePath: string): Promise<SkillInstallResponse>;
        /** 粘贴安装：从整段文本里抠出技能 JSON */
        installText(text: string): Promise<SkillInstallResponse>;
        /** 链接安装：下载并安装 */
        installUrl(url: string): Promise<SkillInstallResponse>;
        /** 商店：内置精选清单（写在代码里，断网可用），带本机安装状态 */
        market(): Promise<MarketSkillState[]>;
        /** 从精选商店一键安装 */
        marketInstall(id: string): Promise<SkillInstallResponse>;
        /** 加载外部清单（别人维护的 index.json） */
        marketLoad(url: string): Promise<MarketLoadResponse>;
        /** 导出自己写的技能清单 JSON，用于托管成外部清单 */
        exportIndex(): Promise<string>;
        /** 启用/禁用一个技能 */
        toggle(id: string, enabled: boolean): Promise<Skill>;
        /** 删除技能（内置技能不允许删） */
        remove(id: string): Promise<void>;
        /** 在系统文件管理器里打开技能目录 */
        reveal(): Promise<void>;
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
    style: {
        /** 选素材文件（小说正文 txt/md），返回文件名与字数 */
        pick(): Promise<{ canceled: boolean; files: StyleFileInfo[] }>;
        /** 跑一次人味蒸馏：把这次的书累积进基线，并更新那一份技能 */
        distill(request: { files: string[] }): Promise<StyleDistillResponse>;
        /** 看已经攒了多少样本；没蒸馏过返回 null */
        overview(): Promise<HumanTraceOverview | null>;
    };
    personal: {
        /** 我的笔感画像；还没采样过返回 null */
        overview(): Promise<PersonalTraceOverview | null>;
        /** 当前该注入的提示块（成熟度不够时 block 为空） */
        prompt(): Promise<PersonalPromptResult>;
        /** 回到从前的自己：把某个时间点的写法设为参照，传 null 取消 */
        setAnchor(at: string | null): Promise<PersonalTraceOverview | null>;
        /** 清空画像，重新开始攒 */
        clear(): Promise<void>;
        /** 打开写法目录（人味档案与我的笔感都在这里） */
        reveal(): Promise<void>;
    };
    preference: {
        /** 学到了哪些改法、目前还挂着几条待验证 */
        overview(): Promise<PreferenceOverview>;
        /** 记一笔"这段是 AI 写的"，等作者保存正文时对齐 */
        mark(input: {
            module: PreferenceModule;
            bookId: string;
            chapterId: string;
            text: string;
        }): Promise<{ pending: number }>;
        /** 删一条不想要的示范 */
        remove(id: string): Promise<PreferenceOverview>;
        /** 全部清空（示范 + 待验证 + 统计） */
        clear(): Promise<void>;
        /** 打开偏好目录，作者可以直接看/备份 */
        reveal(): Promise<void>;
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
