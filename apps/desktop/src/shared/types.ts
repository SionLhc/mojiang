/**
 * 主进程 / 预加载 / 渲染进程三方共享的类型
 * 只放跨进程传输的数据结构，不放实现。
 */

import type { ChatMessage, ProviderId, TokenUsage } from '@mojiang/llm';
import type { ProjectKind } from '@mojiang/core';

/** 一本书的元数据，对应 book.json */
export interface BookMeta {
    /** 等于书库目录名 */
    id: string;
    title: string;
    genre: string;
    /** 单章字数目标 */
    chapterWordTarget: number;
    /**
     * 项目类型：小说 / 笔记 / 工作文档
     * 老数据没有这个字段，按小说处理
     */
    kind?: ProjectKind;
    createdAt: string;
    updatedAt: string;
}

/** 内容目录里的一个节点 */
export interface TreeNode {
    type: 'folder' | 'file';
    /** 显示名，文件是去掉 .md 的名字，文件夹是目录名 */
    name: string;
    /** 相对内容根目录的路径，如 "项目A/会议" */
    path: string;
    /** 文件才有 */
    chapter?: ChapterSummary;
    children?: TreeNode[];
}

/** 全局搜索命中 */
export interface SearchHit {
    bookId: string;
    bookTitle: string;
    /** 文件所在的区，跳转时要先切过去 */
    section: ChapterSection;
    /** 文件相对内容目录的路径，可以直接当 chapterId 用 */
    path: string;
    title: string;
    /** 命中行前后的一小段文字 */
    snippet: string;
    lineNumber: number;
    /** 命中在正文里的字符偏移，用于编辑器定位 */
    offset: number;
}

/** 搜索结果 */
export interface SearchResult {
    hits: SearchHit[];
    /** 扫描了多少个文件 */
    scanned: number;
    /** 是否因为上限被截断 */
    truncated: boolean;
}

/** 快速记录结果 */
export interface QuickNoteResult {
    bookId: string;
    /** 文档相对路径 */
    path: string;
    title: string;
}

/** 书列表里显示的一行 */
export interface BookSummary extends BookMeta {
    chapterCount: number;
    charCount: number;
    lastEditedAt: string;
}

/** 章节列表里显示的一行 */
export interface ChapterSummary {
    /**
     * 相对内容根目录的路径，去掉 .md
     * 小说是 "001"，笔记可能是 "项目A/会议记录"
     */
    id: string;
    /** 章节序号，从 1 开始；笔记项目为 0 */
    index: number;
    title: string;
    charCount: number;
    updatedAt: string;
    /** 标签，来自 frontmatter */
    tags?: string[];
}

/** 章节所属区 */
export type ChapterSection = 'zhengwen' | 'xigang';

/** 快照条目 */
export interface SnapshotEntry {
    /** 文件名 */
    fileName: string;
    /** 相对书的路径 */
    relativePath: string;
    createdAt: string;
    size: number;
}

/** 建书输入 */
export interface CreateBookInput {
    title: string;
    genre: string;
    chapterWordTarget: number;
    /** 项目类型，不传按小说处理 */
    kind?: ProjectKind;
}

/** 应用要展示给用户的路径 */
export interface AppPaths {
    rootDir: string;
    libraryDir: string;
    recycleDir: string;
    logDir: string;
    settingsPath: string;
}

/** 一次模型调用的参数 */
export interface LlmChatParams {
    /** 由渲染进程生成的唯一 id，用于把流式片段对上号 */
    requestId: string;
    providerId: ProviderId;
    model: string;
    messages: ChatMessage[];
    temperature?: number;
    maxTokens?: number;
    /** 本次调用的用途说明，写进日志便于对账 */
    purpose?: string;
}

/** 流式事件 */
export interface LlmStreamEvent {
    requestId: string;
    type: 'chunk' | 'done' | 'error';
    /** 增量文本 */
    delta?: string;
    /** 错误人话说明 */
    message?: string;
    /** 用量 */
    usage?: TokenUsage;
    /** 本次花费 */
    costCny?: number;
}

/** 连接测试结果 */
export interface ConnectionResult {
    ok: boolean;
    message: string;
}

/** provider 的可选模型 */
export interface ProviderModels {
    providerId: ProviderId;
    models: Array<{ id: string; name: string }>;
}

/** 导出格式 */
export type ExportFormat = 'txt' | 'markdown' | 'docx' | 'epub';

/** 导出结果 */
export interface ExportResult {
    ok: boolean;
    /** 写到哪里了；用户取消时为空 */
    path?: string;
    message: string;
}
