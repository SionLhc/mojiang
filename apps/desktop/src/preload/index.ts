/**
 * 预加载脚本
 * 渲染进程只能看到这里列出的方法，没有 fs、没有 net、没有 child_process。
 */

import { contextBridge, ipcRenderer, webFrame } from 'electron';
import type { MoJiangApi } from '../shared/api';
import type {
    AppPaths,
    BookMeta,
    ChapterSection,
    CreateBookInput,
    ExportFormat,
    LlmChatParams,
    LlmStreamEvent,
} from '../shared/types';
import type { ProviderId } from '@mojiang/llm';

/** 白名单 API 实现 */
const api: MoJiangApi = {
    library: {
        list: () => ipcRenderer.invoke('library:list'),
        create: (input: CreateBookInput) => ipcRenderer.invoke('library:create', input),
        remove: (bookId: string) => ipcRenderer.invoke('library:remove', bookId),
        readMeta: (bookId: string) => ipcRenderer.invoke('library:readMeta', bookId),
        saveMeta: (meta: BookMeta) => ipcRenderer.invoke('library:saveMeta', meta),
        listRecycleBin: () => ipcRenderer.invoke('library:listRecycleBin'),
        restore: (folderName: string) => ipcRenderer.invoke('library:restore', folderName),
    },
    chapter: {
        list: (bookId: string, section: ChapterSection) =>
            ipcRenderer.invoke('chapter:list', bookId, section),
        read: (bookId: string, section: ChapterSection, chapterId: string) =>
            ipcRenderer.invoke('chapter:read', bookId, section, chapterId),
        write: (bookId: string, section: ChapterSection, chapterId: string, content: string) =>
            ipcRenderer.invoke('chapter:write', bookId, section, chapterId, content),
        create: (bookId: string, section: ChapterSection, title?: string, parentPath?: string) =>
            ipcRenderer.invoke('chapter:create', bookId, section, title, parentPath),
        setTags: (bookId: string, section: ChapterSection, chapterId: string, tags: string[]) =>
            ipcRenderer.invoke('chapter:setTags', bookId, section, chapterId, tags),
        remove: (bookId: string, section: ChapterSection, chapterId: string) =>
            ipcRenderer.invoke('chapter:remove', bookId, section, chapterId),
        snapshots: (bookId: string, section: ChapterSection, chapterId: string) =>
            ipcRenderer.invoke('chapter:snapshots', bookId, section, chapterId),
        readSnapshot: (
            bookId: string,
            section: ChapterSection,
            chapterId: string,
            fileName: string,
        ) => ipcRenderer.invoke('chapter:readSnapshot', bookId, section, chapterId, fileName),
    },
    file: {
        readText: (bookId: string, relativePath: string) =>
            ipcRenderer.invoke('file:readText', bookId, relativePath),
        writeText: (bookId: string, relativePath: string, content: string) =>
            ipcRenderer.invoke('file:writeText', bookId, relativePath, content),
        readJson: <T,>(bookId: string, relativePath: string, fallback: T): Promise<T> =>
            ipcRenderer.invoke('file:readJson', bookId, relativePath, fallback),
        writeJson: (bookId: string, relativePath: string, data: unknown) =>
            ipcRenderer.invoke('file:writeJson', bookId, relativePath, data),
        list: (bookId: string, relativeDir: string, extension: string) =>
            ipcRenderer.invoke('file:list', bookId, relativeDir, extension),
        remove: (bookId: string, relativePath: string) =>
            ipcRenderer.invoke('file:remove', bookId, relativePath),
    },
    data: {
        readLedger: (bookId: string) => ipcRenderer.invoke('data:readLedger', bookId),
        writeLedger: (bookId: string, ledger: unknown) =>
            ipcRenderer.invoke('data:writeLedger', bookId, ledger),
        readForeshadow: (bookId: string) => ipcRenderer.invoke('data:readForeshadow', bookId),
        writeForeshadow: (bookId: string, file: unknown) =>
            ipcRenderer.invoke('data:writeForeshadow', bookId, file),
        readBaseline: (bookId: string) => ipcRenderer.invoke('data:readBaseline', bookId),
        writeBaseline: (bookId: string, baseline: unknown) =>
            ipcRenderer.invoke('data:writeBaseline', bookId, baseline),
    },
    health: {
        check: (request) => ipcRenderer.invoke('health:check', request),
        rebuildBaseline: (bookId: string, chapterIds: string[]) =>
            ipcRenderer.invoke('health:rebuildBaseline', bookId, chapterIds),
    },
    writingPackage: {
        build: (bookId: string, chapterId: string) =>
            ipcRenderer.invoke('package:build', bookId, chapterId),
    },
    export: {
        book: (bookId: string, format: ExportFormat) =>
            ipcRenderer.invoke('export:book', bookId, format),
    },
    importer: {
        pick: () => ipcRenderer.invoke('import:pick'),
    },
    market: {
        fetch: (bookId: string) => ipcRenderer.invoke('market:fetch', bookId),
        saveReport: (bookId: string, markdown: string) =>
            ipcRenderer.invoke('market:saveReport', bookId, markdown),
    },
    tree: {
        list: (bookId: string, section: ChapterSection) =>
            ipcRenderer.invoke('tree:list', bookId, section),
        createFolder: (bookId: string, section: ChapterSection, name: string, parentPath?: string) =>
            ipcRenderer.invoke('folder:create', bookId, section, name, parentPath),
    },
    search: {
        all: (query: string) => ipcRenderer.invoke('search:all', query),
    },
    note: {
        quick: (text: string) => ipcRenderer.invoke('note:quick', text),
    },
    plot: {
        read: (bookId: string) => ipcRenderer.invoke('plot:read', bookId),
        write: (bookId: string, graph: unknown) => ipcRenderer.invoke('plot:write', bookId, graph),
    },
    mindboard: {
        read: (bookId: string) => ipcRenderer.invoke('mindboard:read', bookId),
        write: (bookId: string, graph: unknown) => ipcRenderer.invoke('mindboard:write', bookId, graph),
    },
    stats: {
        read: () => ipcRenderer.invoke('stats:read'),
        record: (deltaChars: number, deltaSeconds: number) =>
            ipcRenderer.invoke('stats:record', deltaChars, deltaSeconds),
        setGoal: (goal: number) => ipcRenderer.invoke('stats:setGoal', goal),
    },
    ui: {
        setZoom: (factor: number) => {
            // 夹到合理区间，防止误传把界面缩成一条缝
            const safe = Math.min(Math.max(Number(factor) || 1, 0.8), 1.6);
            webFrame.setZoomFactor(safe);
        },
    },
    settings: {
        read: () => ipcRenderer.invoke('settings:read'),
        update: (patch) => ipcRenderer.invoke('settings:update', patch),
    },
    secrets: {
        set: (providerId: ProviderId, apiKey: string) =>
            ipcRenderer.invoke('secrets:set', providerId, apiKey),
        has: (providerId: ProviderId) => ipcRenderer.invoke('secrets:has', providerId),
        clear: (providerId: ProviderId) => ipcRenderer.invoke('secrets:clear', providerId),
        describe: () => ipcRenderer.invoke('secrets:describe'),
    },
    llm: {
        test: (providerId: ProviderId, baseUrl: string) =>
            ipcRenderer.invoke('llm:test', providerId, baseUrl),
        models: (providerId: ProviderId, baseUrl: string) =>
            ipcRenderer.invoke('llm:models', providerId, baseUrl),
        chat: (params: LlmChatParams) => ipcRenderer.invoke('llm:chat', params),
        cancel: (requestId: string) => ipcRenderer.invoke('llm:cancel', requestId),
        estimate: (promptContents: string[], outputTokens: number) =>
            ipcRenderer.invoke('llm:estimate', promptContents, outputTokens),
        onStream: (handler: (event: LlmStreamEvent) => void) => {
            ipcRenderer.removeAllListeners('llm:stream');
            ipcRenderer.on('llm:stream', (_event, payload: LlmStreamEvent) => handler(payload));
        },
        offStream: () => {
            ipcRenderer.removeAllListeners('llm:stream');
        },
    },
    app: {
        paths: (): Promise<AppPaths> => ipcRenderer.invoke('app:paths'),
        revealRoot: () => ipcRenderer.invoke('app:revealRoot'),
        changeRoot: () => ipcRenderer.invoke('app:changeRoot'),
        openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),
        minimize: () => ipcRenderer.invoke('app:minimize'),
        maximize: () => ipcRenderer.invoke('app:maximize'),
        close: () => ipcRenderer.invoke('app:close'),
        version: () => ipcRenderer.invoke('app:version'),
    },
};

if (process.contextIsolated) {
    contextBridge.exposeInMainWorld('api', api);
} else {
    // 理论上不会走到这里，contextIsolation 永远为 true
    (globalThis as unknown as { api: MoJiangApi }).api = api;
}
