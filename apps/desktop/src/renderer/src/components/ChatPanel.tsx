import { useEffect, useMemo, useRef, useState } from 'react';
import {
    chatRolePrompt,
    composeSystemPrompt,
    parseChatOptions,
    parseOutlineChapters,
    splitProseBlocks,
    type OutlineChapter,
    type ProjectKind,
} from '@mojiang/core';
import type { ChatMessage } from '@mojiang/llm';
import Modal from '@/components/Modal';
import { errorMessage, formatCny } from '@/lib/format';
import { useAppStore } from '@/store/useAppStore';

/** 一条聊天记录 */
interface ChatItem {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    /** 还在流式输出 */
    pending?: boolean;
    error?: boolean;
    costCny?: number;
    /** 输入 token */
    promptTokens?: number;
    /** 输出 token */
    completionTokens?: number;
    /** 服务端自报的模型标识 */
    model?: string;
    /** 发送这条请求时用了正文选中片段（用于「替换选中」） */
    fromSelection?: boolean;
}

/** 本次会话的统计，只在内存里算，不落盘 */
interface SessionStats {
    calls: number;
    promptTokens: number;
    completionTokens: number;
    costCny: number;
    /** AI 完成回复的次数（算一次建议） */
    suggestions: number;
    /** 被采纳的次数 */
    adopted: number;
}

/** 上下文预算：整章太长时只发开头+结尾，控制 token 也防止被截断 */
const MAX_CONTEXT_CHARS = 6000;

/**
 * 把超长文本压进预算：开头四成 + 结尾六成（结尾是最近写的，更重要）
 * @param text 原文
 * @param budget 字数预算
 * @returns 压缩后的文本，未超预算原样返回
 */
function clipToBudget(text: string, budget: number): string {
    if (text.length <= budget) {
        return text;
    }
    const headLength = Math.floor(budget * 0.4);
    const tailLength = budget - headLength;
    return `${text.slice(0, headLength)}\n……（中间省略）……\n${text.slice(-tailLength)}`;
}

/** 预估输出长度，用于算钱 */
const ESTIMATED_OUTPUT_TOKENS = 1500;

/** 快捷指令 */
interface QuickAction {
    key: string;
    label: string;
    prompt: string;
    /** 需要先在正文里选中一段 */
    needSelection: boolean;
}

/** 小说：围绕文风写 */
const NOVEL_ACTIONS: QuickAction[] = [
    {
        key: 'continue',
        label: '续写',
        prompt: '接着目前内容往下写 800 字，紧贴文风，不要解释，直接输出正文。',
        needSelection: false,
    },
    {
        key: 'polish',
        label: '润色',
        prompt: '润色下面这段，保持原意和文风，只输出改后的正文，不要解释。',
        needSelection: true,
    },
    {
        key: 'tighten',
        label: '精简',
        prompt: '把下面这段压缩三成左右，保留信息密度，只输出正文，不要解释。',
        needSelection: true,
    },
    {
        key: 'expand',
        label: '扩写',
        prompt: '把下面这段扩写到两倍，补动作和细节，只输出正文，不要解释。',
        needSelection: true,
    },
    {
        key: 'problems',
        label: '挑问题',
        prompt: '检查下面这段的逻辑漏洞、重复表达和 AI 腔，分条列出问题，不要改正文。',
        needSelection: true,
    },
];

/** 工作文档：重结构、术语和准确 */
const DOCS_ACTIONS: QuickAction[] = [
    {
        key: 'continue',
        label: '补要点',
        prompt: '接着目前内容往下，补充还没覆盖的要点或下一步，保持原有格式和术语，只输出正文，不要解释。',
        needSelection: false,
    },
    {
        key: 'polish',
        label: '润色',
        prompt: '润色下面这段，保持术语、编号和结构不变，只输出改后的正文，不要解释。',
        needSelection: true,
    },
    {
        key: 'tighten',
        label: '精简',
        prompt: '把下面这段压紧，去掉重复和空话，保留全部信息点，只输出正文，不要解释。',
        needSelection: true,
    },
    {
        key: 'expand',
        label: '展开',
        prompt: '把下面这段展开，补充必要的说明和步骤，保持术语准确，只输出正文，不要解释。',
        needSelection: true,
    },
    {
        key: 'problems',
        label: '挑问题',
        prompt: '检查下面这段的技术错误、前后矛盾、缺失的前提和步骤，分条列出问题，不要改正文。',
        needSelection: true,
    },
];

/** 笔记：提炼、归并、行动项 */
const NOTES_ACTIONS: QuickAction[] = [
    {
        key: 'points',
        label: '提炼要点',
        prompt: '把下面这段提炼成要点清单，只输出清单，不要解释。',
        needSelection: true,
    },
    {
        key: 'todos',
        label: '行动项',
        prompt: '从下面这段里提取待办和行动项，用清单列出，只输出清单，不要解释。',
        needSelection: true,
    },
    {
        key: 'merge',
        label: '归并整理',
        prompt: '把下面这段归并整理，合并同类项、去重，保留全部信息，只输出整理后的内容，不要解释。',
        needSelection: true,
    },
    {
        key: 'problems',
        label: '挑问题',
        prompt: '检查下面这段的重复、矛盾和信息缺口，分条列出问题，不要改正文。',
        needSelection: true,
    },
];

/**
 * 按项目类型取快捷指令
 * @param kind 项目类型
 * @returns 该类型可用的指令列表
 */
function quickActionsFor(kind: ProjectKind | undefined): QuickAction[] {
    if (kind === 'docs') {
        return DOCS_ACTIONS;
    }
    if (kind === 'notes') {
        return NOTES_ACTIONS;
    }
    return NOVEL_ACTIONS;
}

/** 对话记忆里一条记录 */
interface ChatMemoryEntry {
    items: ChatItem[];
    updatedAt: string;
}

/** 书内 AI对话.json：按文档分开存，切文档回来还能接上 */
interface ChatMemoryFile {
    conversations: Record<string, ChatMemoryEntry>;
}

/**
 * 把某个文档的对话写进 AI对话.json
 * 流式中的半截内容不落盘
 * @param bookId 书 id
 * @param key 文档 key（区/文档 id）
 * @param items 当前对话
 */
async function persistChatMemory(bookId: string, key: string, items: ChatItem[]): Promise<void> {
    try {
        const file = await window.api.file.readJson<ChatMemoryFile>(bookId, 'AI对话.json', {
            conversations: {},
        });
        const cleaned = items.filter((item) => !item.pending);
        if (cleaned.length === 0) {
            delete file.conversations[key];
        } else {
            file.conversations[key] = { items: cleaned, updatedAt: new Date().toISOString() };
        }
        await window.api.file.writeJson(bookId, 'AI对话.json', file);
    } catch {
        // 记忆存不上不影响写作，静默跳过
    }
}

/** 空会话统计 */
const EMPTY_SESSION: SessionStats = {
    calls: 0,
    promptTokens: 0,
    completionTokens: 0,
    costCny: 0,
    suggestions: 0,
    adopted: 0,
};

/**
 * 右侧 AI 对话
 * 和正文深度联动：能读整章或选中片段，回复里的选项可以点选，输出可以写回选区。
 * 模型请求走主进程，渲染进程只拿流式文本，Key 永远不出主进程。
 */
export default function ChatPanel() {
    const content = useAppStore((state) => state.content);
    const book = useAppStore((state) => state.book);
    const chapters = useAppStore((state) => state.chapters);
    const section = useAppStore((state) => state.section);
    const chapterId = useAppStore((state) => state.chapterId);
    const appendToSection = useAppStore((state) => state.appendToSection);
    const applyOutline = useAppStore((state) => state.applyOutline);
    const updateBookTitle = useAppStore((state) => state.updateBookTitle);
    const settings = useAppStore((state) => state.settings);
    const pushToast = useAppStore((state) => state.pushToast);
    const selection = useAppStore((state) => state.editorSelection);
    const requestReplace = useAppStore((state) => state.requestReplace);

    const pendingPrompt = useAppStore((state) => state.pendingPrompt);
    const setPendingPrompt = useAppStore((state) => state.setPendingPrompt);

    const [items, setItems] = useState<ChatItem[]>([]);
    const [draft, setDraft] = useState('');
    const [streaming, setStreaming] = useState(false);
    const [withChapter, setWithChapter] = useState(true);
    /** 当前 provider 是否已配 Key：没配时顶上给条提示 */
    const [hasKey, setHasKey] = useState(true);
    /** 开书引导卡里的书名草稿（留空表示让 AI 定） */
    const [bookTitleDraft, setBookTitleDraft] = useState('');
    /** 「生成章节和细纲」的预览数据，null 表示弹窗关着 */
    const [outlinePreview, setOutlinePreview] = useState<OutlineChapter[] | null>(null);
    const [session, setSession] = useState<SessionStats>(EMPTY_SESSION);
    /** 最近一次发送的上下文覆盖：发出去多少字 / 本章共多少字 */
    const [contextInfo, setContextInfo] = useState<{ sentChars: number; totalChars: number } | null>(
        null,
    );

    // 「用到正文」的分段选择：null 表示弹窗关闭
    const [insertBlocks, setInsertBlocks] = useState<string[] | null>(null);
    const [picked, setPicked] = useState<Set<number>>(new Set());
    const appendToChapter = useAppStore((state) => state.appendToChapter);
    const currentRequestRef = useRef<string | null>(null);
    const bottomRef = useRef<HTMLDivElement | null>(null);
    /** 刚加载完记忆时跳过一次存盘，免得把历史原样写回去 */
    const skipNextMemorySave = useRef(true);

    /** 是不是小说项目（老数据没有 kind 按小说算） */
    const isNovelProject = !book?.kind || book.kind === 'novel';

    /**
     * 对话记忆的 key：
     * 小说整本书共用一个对话——正文和细纲是同一条故事的两个面，切区不该换窗口；
     * 文档/笔记按篇记忆，每篇各记各的
     */
    const memoryKey = !book
        ? null
        : isNovelProject
          ? 'book'
          : chapterId
            ? `${section}/${chapterId}`
            : null;

    // 切文档时加载对应的对话记忆，切回来还能接着聊
    useEffect(() => {
        if (!book || !memoryKey) {
            setItems([]);
            return;
        }
        let cancelled = false;
        skipNextMemorySave.current = true;
        void (async () => {
            try {
                const file = await window.api.file.readJson<ChatMemoryFile>(book.id, 'AI对话.json', {
                    conversations: {},
                });
                if (cancelled) {
                    return;
                }
                setItems(file.conversations[memoryKey]?.items ?? []);
                setSession(EMPTY_SESSION);
                setContextInfo(null);
            } catch {
                if (!cancelled) {
                    setItems([]);
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [book, memoryKey]);

    // 对话变化后防抖写进书内 AI对话.json；流式中的半截内容不落盘
    useEffect(() => {
        if (!book || !memoryKey) {
            return;
        }
        if (skipNextMemorySave.current) {
            skipNextMemorySave.current = false;
            return;
        }
        const timer = window.setTimeout(() => {
            void persistChatMemory(book.id, memoryKey, items);
        }, 800);
        return () => window.clearTimeout(timer);
    }, [items, book, memoryKey]);

    // 最新对话的镜像：切换文档/关项目时要用它补存，不能读陈旧闭包
    const itemsRef = useRef<ChatItem[]>(items);
    useEffect(() => {
        itemsRef.current = items;
    }, [items]);

    // 切文档 / 切项目 / 卸载前补存一次：防抖还没到点就被切走时，最后一段对话不能丢
    useEffect(() => {
        if (!book || !memoryKey) {
            return;
        }
        const bookId = book.id;
        const key = memoryKey;
        return () => {
            const snapshot = itemsRef.current;
            if (snapshot.length === 0) {
                return;
            }
            void persistChatMemory(bookId, key, snapshot);
        };
    }, [book, memoryKey]);

    // 检查当前 provider 有没有 Key，没配就在面板上提示，别等发请求报鉴权错误
    useEffect(() => {
        if (!settings) {
            return;
        }
        void (async () => {
            try {
                setHasKey(await window.api.secrets.has(settings.provider.id));
            } catch {
                setHasKey(true);
            }
        })();
    }, [settings]);

    // 开写包点"发给 AI"时，把整包塞进输入框让作者补指令再发
    useEffect(() => {
        if (pendingPrompt && pendingPrompt.length > 0) {
            setDraft(pendingPrompt);
            setPendingPrompt(null);
        }
    }, [pendingPrompt, setPendingPrompt]);

    // 只注册一次全局监听，靠 requestId 区分是不是本次请求
    useEffect(() => {
        window.api.llm.onStream((event) => {
            if (event.requestId !== currentRequestRef.current) {
                return;
            }
            if (event.type === 'chunk') {
                const delta = event.delta ?? '';
                setItems((previous) =>
                    previous.map((item) =>
                        item.pending ? { ...item, content: item.content + delta } : item,
                    ),
                );
            }
            if (event.type === 'done') {
                const promptTokens = event.usage?.promptTokens ?? 0;
                const completionTokens = event.usage?.completionTokens ?? 0;
                setItems((previous) =>
                    previous.map((item) =>
                        item.pending
                            ? {
                                  ...item,
                                  pending: false,
                                  costCny: event.costCny,
                                  model: event.model,
                                  promptTokens,
                                  completionTokens,
                              }
                            : item,
                    ),
                );
                setStreaming(false);
                currentRequestRef.current = null;
                // 会话统计：一条完成的回复算一次建议
                setSession((previous) => ({
                    calls: previous.calls + 1,
                    promptTokens: previous.promptTokens + promptTokens,
                    completionTokens: previous.completionTokens + completionTokens,
                    costCny: previous.costCny + (event.costCny ?? 0),
                    suggestions: previous.suggestions + 1,
                    adopted: previous.adopted,
                }));
                // 全局采纳率统计落盘（同时刷新月度用量）
                const latest = useAppStore.getState().settings;
                const stats = latest?.aiStats ?? { suggestions: 0, adopted: 0 };
                void useAppStore.getState().updateSettings({
                    aiStats: { ...stats, suggestions: stats.suggestions + 1 },
                });
            }
            if (event.type === 'error') {
                setItems((previous) =>
                    previous.map((item) =>
                        item.pending
                            ? {
                                  ...item,
                                  pending: false,
                                  error: true,
                                  content: `${item.content}\n\n[出错] ${event.message ?? '未知错误'}`,
                              }
                            : item,
                    ),
                );
                setStreaming(false);
                currentRequestRef.current = null;
            }
        });

        return () => {
            window.api.llm.offStream();
        };
    }, []);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [items]);

    /**
     * 打开分段选择
     * @param text AI 回复全文
     */
    function openInsert(text: string): void {
        const blocks = splitProseBlocks(text);
        if (blocks.length === 0) {
            return;
        }
        setInsertBlocks(blocks);
        setPicked(new Set(blocks.map((_block, index) => index)));
    }

    /**
     * 勾选/取消某一段
     * @param index 段号
     */
    function toggleBlock(index: number): void {
        setPicked((previous) => {
            const next = new Set(previous);
            if (next.has(index)) {
                next.delete(index);
            } else {
                next.add(index);
            }
            return next;
        });
    }

    /**
     * 记一次采纳：会话内 +1，全局落盘
     */
    function markAdopted(): void {
        setSession((previous) => ({ ...previous, adopted: previous.adopted + 1 }));
        const latest = useAppStore.getState().settings;
        const stats = latest?.aiStats ?? { suggestions: 0, adopted: 0 };
        void useAppStore.getState().updateSettings({
            aiStats: { ...stats, adopted: stats.adopted + 1 },
        });
    }

    /**
     * 把选中的段落拼起来插到本章末尾
     */
    async function confirmInsert(): Promise<void> {
        if (!insertBlocks || picked.size === 0) {
            return;
        }
        const text = [...picked]
            .sort((left, right) => left - right)
            .map((index) => insertBlocks[index])
            .join('\n\n');
        await appendToChapter(text);
        markAdopted();
        setInsertBlocks(null);
    }

    /**
     * 把 AI 回复替换到正文选区（发送时用了选中的才有入口）
     * @param text AI 回复正文
     */
    function replaceSelection(text: string): void {
        requestReplace(text);
        markAdopted();
        pushToast('success', '已替换到正文选中处');
    }

    /**
     * 组装上下文
     * 小说：当前章正文 + 细纲一起带（同章细纲优先，没有就取第一篇/大纲），故事才连贯；
     * 文档/笔记：只带当前文档；有选中片段时只围绕选中处理
     * @returns 上下文块与覆盖统计
     */
    async function buildContext(): Promise<{
        block: string | null;
        sentChars: number;
        totalChars: number;
        usedSelection: boolean;
    }> {
        const totalChars = content.length;
        const selected = selection.trim();
        if (selected.length > 0) {
            // 有选中：只围绕选中片段，最相关
            return {
                block: `【作者选中的正文片段，重点围绕它处理】\n${selected}`,
                sentChars: selected.length,
                totalChars,
                usedSelection: true,
            };
        }
        if (!withChapter) {
            return { block: null, sentChars: 0, totalChars, usedSelection: false };
        }

        // 小说：正文、细纲、剧情画板、人物、伏笔、账本、文风全带上——AI 才能做出完整判断
        if (isNovelProject && book) {
            let pack: Awaited<ReturnType<typeof window.api.writing.context>> | null = null;
            try {
                pack = await window.api.writing.context(book.id, chapterId);
            } catch {
                pack = null;
            }
            if (!pack) {
                return { block: null, sentChars: 0, totalChars, usedSelection: false };
            }

            const blocks: string[] = [];
            let sentChars = 0;
            /**
             * 按预算塞一块，超了整体截断
             * @param label 块标题
             * @param text 块内容
             * @param budget 这块最多多少字
             */
            const push = (label: string, text: string, budget: number): void => {
                const trimmed = text.trim();
                if (trimmed.length === 0 || sentChars >= MAX_CONTEXT_CHARS) {
                    return;
                }
                const clipped = clipToBudget(trimmed, Math.min(budget, MAX_CONTEXT_CHARS - sentChars));
                blocks.push(`【${label}】\n${clipped}`);
                sentChars += clipped.length;
            };
            push('当前章正文', pack.body, 2500);
            push('本章细纲', pack.outline, 1000);
            push('剧情画板', pack.plot, 800);
            for (const item of pack.items) {
                // 工具数据每项给 400 字，够 AI 判断又不会挤爆预算
                push(item.label, item.content, 400);
            }
            if (blocks.length === 0) {
                return { block: null, sentChars: 0, totalChars, usedSelection: false };
            }
            return {
                block:
                    `${blocks.join('\n\n')}\n` +
                    '（细纲是菜单、正文是成品：写正文对齐细纲和工具设定；改细纲别和已有正文冲突；' +
                    '人物说话方式、伏笔、账本状态都以这些料为准）',
                sentChars,
                totalChars: totalChars + pack.outline.length,
                usedSelection: false,
            };
        }

        // 文档/笔记：只带当前文档
        if (content.trim().length > 0) {
            const clipped = clipToBudget(content, MAX_CONTEXT_CHARS);
            return {
                block: `【当前文档内容，只作参考，不要整段复述】\n${clipped}`,
                sentChars: clipped.length,
                totalChars,
                usedSelection: false,
            };
        }
        return { block: null, sentChars: 0, totalChars, usedSelection: false };
    }

    /**
     * 组装发给模型的消息
     * @param input 作者这次的指令
     * @param contextBlock 上下文块
     * @returns 消息数组
     */
    function buildMessages(input: string, contextBlock: string | null): ChatMessage[] {
        // 附加指令也按项目类型取：小说、文档、笔记各用各的那一栏
        const kind = book?.kind ?? 'novel';
        const styleGuide =
            kind === 'docs'
                ? (settings?.ai.docsStyleGuide ?? '')
                : kind === 'notes'
                  ? (settings?.ai.notesStyleGuide ?? '')
                  : (settings?.ai.novelStyleGuide ?? '');

        const messages: ChatMessage[] = [
            {
                role: 'system',
                // 提示按项目类型来：小说是小说，工作文档/笔记各用各的规则
                content: composeSystemPrompt(chatRolePrompt(book?.kind), styleGuide),
            },
        ];

        if (contextBlock) {
            messages.push({ role: 'user', content: contextBlock });
        }

        for (const item of items) {
            if (item.error || item.content.trim().length === 0) {
                continue;
            }
            messages.push({ role: item.role, content: item.content });
        }

        messages.push({ role: 'user', content: input });
        return messages;
    }

    /**
     * 发送一条消息
     * @param text 指令正文
     */
    async function sendMessage(text: string): Promise<void> {
        const input = text.trim();
        if (input.length === 0 || streaming) {
            return;
        }
        if (!settings) {
            pushToast('info', '先去设置里配模型');
            return;
        }

        const context = await buildContext();
        setContextInfo({ sentChars: context.sentChars, totalChars: context.totalChars });

        const stamp = Date.now().toString(36);
        const userItem: ChatItem = { id: `u_${stamp}`, role: 'user', content: input };
        const assistantItem: ChatItem = {
            id: `a_${stamp}`,
            role: 'assistant',
            content: '',
            pending: true,
            fromSelection: context.usedSelection,
        };
        const messages = buildMessages(input, context.block);

        setItems((previous) => [...previous, userItem, assistantItem]);
        setStreaming(true);

        try {
            // 先算钱，超预算让作者自己决定
            const estimate = await window.api.llm.estimate(
                messages.map((message) => message.content),
                ESTIMATED_OUTPUT_TOKENS,
            );
            if (estimate.overMonthlyLimit) {
                setStreaming(false);
                setItems((previous) => previous.filter((item) => item.id !== assistantItem.id));
                pushToast('error', '这个月的预算到顶了，去设置里调高上限');
                return;
            }
            if (estimate.overChapterLimit) {
                const ok = window.confirm(
                    `这次调用预计花 ${formatCny(estimate.costCny)}，超过你设的单章上限 ` +
                        `${formatCny(settings.budget.perChapterLimitCny)}。继续吗？`,
                );
                if (!ok) {
                    setStreaming(false);
                    setItems((previous) => previous.filter((item) => item.id !== assistantItem.id));
                    return;
                }
            }

            const requestId =
                typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `req_${stamp}`;
            currentRequestRef.current = requestId;

            const result = await window.api.llm.chat({
                requestId,
                providerId: settings.provider.id,
                model: settings.provider.model,
                messages,
                purpose: book ? `chat:${book.id}` : 'chat',
            });

            if (!result.accepted) {
                setStreaming(false);
                currentRequestRef.current = null;
                setItems((previous) =>
                    previous.map((item) =>
                        item.id === assistantItem.id
                            ? { ...item, pending: false, error: true, content: result.message ?? '调用失败' }
                            : item,
                    ),
                );
            }
        } catch (error) {
            setStreaming(false);
            currentRequestRef.current = null;
            setItems((previous) =>
                previous.map((item) =>
                    item.id === assistantItem.id
                        ? { ...item, pending: false, error: true, content: errorMessage(error) }
                        : item,
                ),
            );
        }
    }

    /**
     * 点快捷指令：直接发对应指令
     * @param action 快捷动作
     */
    function runQuick(action: QuickAction): void {
        if (streaming) {
            return;
        }
        if (action.needSelection && selection.trim().length === 0) {
            pushToast('info', '先在正文里选中一段，再用这个');
            return;
        }
        void sendMessage(action.prompt);
    }

    /**
     * 点 AI 给的选项：把选项当追问发出去，记一次采纳
     * @param option 选项文字
     */
    function adoptOption(option: string): void {
        if (streaming) {
            return;
        }
        markAdopted();
        void sendMessage(`用这个方案：${option}`);
    }

    /**
     * 发送输入框内容
     */
    function handleSend(): void {
        const input = draft.trim();
        if (input.length === 0 || streaming) {
            return;
        }
        setDraft('');
        void sendMessage(input);
    }

    /**
     * 停止当前生成
     */
    function handleStop(): void {
        if (currentRequestRef.current) {
            void window.api.llm.cancel(currentRequestRef.current);
        }
        setStreaming(false);
        setItems((previous) =>
            previous.map((item) => (item.pending ? { ...item, pending: false } : item)),
        );
        currentRequestRef.current = null;
    }

    /**
     * 清空对话
     */
    function handleClear(): void {
        setItems([]);
        setSession(EMPTY_SESSION);
        setContextInfo(null);
    }

    // 快捷指令按项目类型切换：小说续写，工作文档补要点，笔记提炼
    const quickActions = useMemo(() => quickActionsFor(book?.kind), [book?.kind]);

    /** 新书：小说项目且还没有任何章节 → 显示开书引导 */
    const isNewNovel = isNovelProject && chapters.length === 0;

    /**
     * 开书第一步：让 AI 定书名和题材
     */
    function startBookNaming(): void {
        const draft = bookTitleDraft.trim();
        const prompt =
            draft.length > 0
                ? `我要写一本小说，暂定书名《${draft}》。先判断这个书名和题材方向合不合适，再给我 3 个更好的书名候选（每个带题材标签），用选项块输出，不要展开解释。`
                : '我要开一本新书，还没定书名和题材。先用 2 个问题问清我想写什么方向，再给我 3 个书名候选（每个带题材标签），用选项块输出，不要展开解释。';
        void sendMessage(prompt);
    }

    /**
     * 开书第二步：按书名列大纲（每章一行，方便后面一键生成）
     */
    function startBookOutline(): void {
        const title = bookTitleDraft.trim() || book?.title || '未命名';
        void sendMessage(
            `书名《${title}》。请按这个书名把全书大纲列出来，分卷分章。` +
                '没给的设定你自己按常见网文套路定，不要反问、不要征求意见。' +
                '每章一行，格式严格用「第一章 标题：一句话内容」，章节之间空一行。' +
                '只输出大纲本身，不要解释、不要选项块。',
        );
    }

    /**
     * 开书第三步：把最后一份大纲落成章节和细纲
     */
    function openOutlineFromLastReply(): void {
        const last = [...items]
            .reverse()
            .find((item) => item.role === 'assistant' && !item.pending && !item.error);
        if (!last) {
            pushToast('info', '先让 AI 列好大纲，再来生成');
            return;
        }
        const parsed = parseOutlineChapters(last.content);
        if (parsed.length === 0) {
            pushToast('info', '没从回复里解析出章节，确认大纲用的是「第X章」格式');
            return;
        }
        setOutlinePreview(parsed);
    }

    /**
     * 确认生成：正文建骨架、细纲写大纲；书名草稿有内容就一起定下来
     */
    async function confirmOutline(): Promise<void> {
        if (!outlinePreview || outlinePreview.length === 0) {
            return;
        }
        await applyOutline(
            outlinePreview.map((item) => ({
                title: item.title,
                summary: item.summary,
                content: item.content,
            })),
        );
        const draft = bookTitleDraft.trim();
        if (draft.length > 0) {
            await updateBookTitle(draft);
        }
        setOutlinePreview(null);
    }

    // 上下文命中率：最近一次发送的正文覆盖比例
    const contextRatio = useMemo(() => {
        if (!contextInfo || contextInfo.totalChars === 0) {
            return null;
        }
        return Math.min(100, Math.round((contextInfo.sentChars / contextInfo.totalChars) * 100));
    }, [contextInfo]);

    // 采纳率：会话内 + 全局（都在 0-100 之间夹住）
    const sessionHit =
        session.suggestions > 0
            ? Math.min(100, Math.round((session.adopted / session.suggestions) * 100))
            : null;
    const globalHit =
        (settings?.aiStats.suggestions ?? 0) > 0
            ? Math.min(
                  100,
                  Math.round(
                      ((settings?.aiStats.adopted ?? 0) / (settings?.aiStats.suggestions ?? 1)) * 100,
                  ),
              )
            : null;

    return (
        <div className="flex h-full flex-col overflow-hidden">
            <div className="flex h-9 shrink-0 items-center justify-between border-b border-ink-800 px-3">
                <label className="flex cursor-pointer items-center gap-1.5 text-[13px] text-ink-400">
                    <input
                        type="checkbox"
                        className="h-3 w-3 accent-jade-500"
                        checked={withChapter}
                        onChange={(event) => setWithChapter(event.target.checked)}
                    />
                    {isNovelProject ? '带正文和细纲' : '带本章正文'}
                </label>
                <div className="flex items-center gap-2">
                    <span className="text-[13px] text-ink-500">
                        {settings ? settings.provider.model : ''}
                    </span>
                    <button
                        type="button"
                        className="text-[13px] text-ink-500 hover:text-ink-300"
                        onClick={handleClear}
                    >
                        清空
                    </button>
                </div>
            </div>

            {/* 快捷指令：手边常做的几种改动，一键发起 */}
            <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-ink-800 px-3 py-1.5">
                {quickActions.map((action) => (
                    <button
                        key={action.key}
                        type="button"
                        className="shrink-0 rounded-full border border-ink-700 px-2 py-0.5 text-[12px] text-ink-300 transition-colors hover:border-jade-600 hover:text-jade-400 disabled:opacity-50"
                        onClick={() => runQuick(action)}
                        disabled={streaming}
                        title={action.needSelection ? '先在正文里选中一段' : action.prompt}
                    >
                        {action.label}
                    </button>
                ))}
            </div>

            {/* 没配 Key 时给一条清楚的提示，别等发请求被服务商甩英文鉴权错误 */}
            {!hasKey && (
                <div className="shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[12px] leading-relaxed text-amber-500">
                    还没配置 API Key，AI 暂时用不了。去「设置 → 模型」里填一个，填完这里会自动消失。
                </div>
            )}

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
                {/* 新书引导：定书名 → 列大纲 → 生成章节和细纲，全程不用复制 */}
                {isNewNovel && items.length === 0 && (
                    <div className="rounded-lg border border-jade-600/40 bg-jade-500/5 p-2.5">
                        <p className="mb-1 text-[13px] font-medium text-jade-500">开新书三步走</p>
                        <p className="mb-2 text-[12px] leading-relaxed text-ink-500">
                            生成的大纲会直接变成细纲，正文骨架也一起建好，不用复制粘贴。
                        </p>
                        <input
                            className="field h-7 w-full text-[13px]"
                            placeholder="书名（可留空，让 AI 定）"
                            value={bookTitleDraft}
                            onChange={(event) => setBookTitleDraft(event.target.value)}
                        />
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                            <button
                                type="button"
                                className="btn-outline h-7 text-[12px]"
                                onClick={startBookNaming}
                                disabled={streaming}
                                title="让 AI 给书名和题材候选"
                            >
                                ① 定书名和题材
                            </button>
                            <button
                                type="button"
                                className="btn-outline h-7 text-[12px]"
                                onClick={startBookOutline}
                                disabled={streaming}
                                title="按书名把全书大纲按「第X章」格式列出来"
                            >
                                ② 按书名列大纲
                            </button>
                            <button
                                type="button"
                                className="btn-outline h-7 text-[12px]"
                                onClick={openOutlineFromLastReply}
                                disabled={streaming}
                                title="把刚才的大纲变成章节：正文建骨架、细纲写大纲"
                            >
                                ③ 生成章节和细纲
                            </button>
                        </div>
                    </div>
                )}

                {items.length === 0 ? (
                    <div className="text-[13px] leading-relaxed text-ink-500">
                        <p className="mb-2 text-ink-400">可以让它做的事：</p>
                        <ul className="space-y-1">
                            <li>· 接着上一章往下写 800 字，不要变文风</li>
                            <li>· 选中一段正文，点「润色」就地改</li>
                            <li>· 这段对话太像同一个人，帮我改出区别</li>
                        </ul>
                        <p className="mt-3 text-ink-600">
                            会自动带上当前章正文或你选中的片段作参考。它给的方案会列成选项，点一下就用。
                            正文不会上传到墨匠的服务器。
                        </p>
                    </div>
                ) : (
                    items.map((item) => {
                        // 选项块和正文分开：正文照常显示，选项渲染成按钮
                        const parsed =
                            item.role === 'assistant' && !item.pending && !item.error
                                ? parseChatOptions(item.content)
                                : { body: item.content, options: [] };
                        // 能解析出多章 = 大纲/规划类内容：只进细纲，不给「用到正文」
                        // 顺序是先把大纲做出来，再照细纲写正文
                        const outlineChapters =
                            item.role === 'assistant' && !item.pending && !item.error
                                ? parseOutlineChapters(item.content)
                                : [];
                        const isPlanningReply = outlineChapters.length >= 2;
                        return (
                            <div
                                key={item.id}
                                className={item.role === 'user' ? 'text-right' : 'text-left'}
                            >
                                <div
                                    className={`inline-block max-w-full whitespace-pre-wrap rounded-lg px-2.5 py-2 text-left text-[13px] leading-relaxed ${
                                        item.role === 'user'
                                            ? 'bg-jade-600/20 text-ink-100'
                                            : item.error
                                              ? 'bg-red-500/10 text-red-300'
                                              : 'bg-ink-850 text-ink-200'
                                    }`}
                                >
                                    {parsed.body}
                                    {/* 等待首个字时三点跳动，流式输出中末尾闪烁光标 */}
                                    {item.pending && parsed.body.length === 0 && (
                                        <span className="chat-typing" aria-label="正在生成">
                                            <span />
                                            <span />
                                            <span />
                                        </span>
                                    )}
                                    {item.pending && parsed.body.length > 0 && (
                                        <span className="chat-caret" aria-hidden="true" />
                                    )}
                                </div>

                                {/* AI 给的选项：点一下就把该方案发给它 */}
                                {parsed.options.length > 0 && (
                                    <div className="mt-1.5 flex flex-col items-start gap-1">
                                        {parsed.options.map((option, index) => (
                                            <button
                                                key={index}
                                                type="button"
                                                className="max-w-full rounded-md border border-jade-600/40 px-2 py-1 text-left text-[13px] leading-relaxed text-jade-600 transition-colors hover:bg-jade-500/10 disabled:opacity-50"
                                                onClick={() => adoptOption(option)}
                                                disabled={streaming}
                                                title="点这个方案继续"
                                            >
                                                {index + 1}. {option}
                                            </button>
                                        ))}
                                    </div>
                                )}

                                {(item.costCny !== undefined ||
                                    item.model ||
                                    item.promptTokens !== undefined) && (
                                    <p className="mt-0.5 text-[12px] text-ink-600">
                                        {item.model ? `${item.model} · ` : ''}
                                        {item.promptTokens !== undefined
                                            ? `入 ${item.promptTokens} / 出 ${item.completionTokens ?? 0} tokens · `
                                            : ''}
                                        {item.costCny !== undefined
                                            ? `本次 ${formatCny(item.costCny)}`
                                            : ''}
                                    </p>
                                )}

                                {/* 生成完了才给操作入口，太短的回复（比如一句回答）不弹入口 */}
                                {item.role === 'assistant' &&
                                    !item.pending &&
                                    !item.error &&
                                    item.content.trim().length > 80 && (
                                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                            {/* 规划类内容（大纲）只给细纲入口，正文等「按细纲写本章」再产出 */}
                                            {item.fromSelection && !isPlanningReply && (
                                                <button
                                                    type="button"
                                                    className="rounded border border-jade-600/40 px-2 py-0.5 text-[13px] text-jade-600 transition-colors hover:bg-jade-500/10"
                                                    onClick={() => replaceSelection(parsed.body)}
                                                    title="把这段写回正文，替换你刚才选中的部分"
                                                >
                                                    替换选中
                                                </button>
                                            )}
                                            {!isPlanningReply && (
                                                <button
                                                    type="button"
                                                    className="rounded border border-jade-600/40 px-2 py-0.5 text-[13px] text-jade-600 transition-colors hover:bg-jade-500/10"
                                                    onClick={() => openInsert(parsed.body)}
                                                >
                                                    用到正文
                                                </button>
                                            )}
                                            {isNovelProject && (
                                                <button
                                                    type="button"
                                                    className="rounded border border-jade-600/40 px-2 py-0.5 text-[13px] text-jade-600 transition-colors hover:bg-jade-500/10"
                                                    onClick={() => void appendToSection('xigang', parsed.body)}
                                                    title="写到细纲区：大纲和剧情规划归细纲，正文只放成品"
                                                >
                                                    写到细纲
                                                </button>
                                            )}
                                            {isNovelProject && isPlanningReply && (
                                                <button
                                                    type="button"
                                                    className="rounded border border-jade-600/40 px-2 py-0.5 text-[13px] text-jade-600 transition-colors hover:bg-jade-500/10"
                                                    onClick={() => setOutlinePreview(outlineChapters)}
                                                    title="把这份大纲变成章节：正文建骨架章，细纲按模板写大纲"
                                                >
                                                    生成章节和细纲
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                className="rounded px-2 py-0.5 text-[13px] text-ink-500 transition-colors hover:bg-ink-800 hover:text-ink-300"
                                                onClick={() => {
                                                    void navigator.clipboard.writeText(item.content);
                                                    pushToast('success', '已复制');
                                                }}
                                            >
                                                复制
                                            </button>
                                        </div>
                                    )}
                            </div>
                        );
                    })
                )}
                <div ref={bottomRef} />
            </div>

            <div className="shrink-0 border-t border-ink-800 p-2">
                {/* 选中提示 + 命中率：上下文用了多少、建议被采纳多少 */}
                <div className="mb-1.5 px-0.5 text-[11px] leading-relaxed text-ink-600">
                    {selection.trim().length > 0 ? (
                        <span className="text-jade-500">
                            已选中 {selection.trim().length} 字，将作为上下文
                        </span>
                    ) : (
                        <span>
                            上下文 {contextRatio === null ? '—' : `${contextRatio}%`}
                            {contextInfo
                                ? `（${contextInfo.sentChars}/${contextInfo.totalChars} 字）`
                                : ''}
                        </span>
                    )}
                    <span className="mx-1">·</span>
                    <span>
                        采纳率 {sessionHit === null ? '—' : `${sessionHit}%`}
                        {globalHit !== null ? `（全局 ${globalHit}%）` : ''}
                    </span>
                    <br />
                    <span>
                        本次 {session.calls} 轮 · 入 {session.promptTokens} / 出{' '}
                        {session.completionTokens} tokens · {formatCny(session.costCny)}
                    </span>
                </div>
                <textarea
                    className="field h-20 resize-none text-[13px] leading-relaxed"
                    placeholder="说你要什么。Enter 发送，Shift+Enter 换行"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                            event.preventDefault();
                            handleSend();
                        }
                    }}
                />
                <div className="mt-1.5 flex items-center justify-between">
                    <span className="text-[13px] text-ink-600">
                        {settings
                            ? `本月 ${formatCny(settings.usage.costCny)} / 上限 ${formatCny(
                                  settings.budget.monthlyLimitCny,
                              )}`
                            : ''}
                    </span>
                    {streaming ? (
                        <button type="button" className="btn-outline text-[13px]" onClick={handleStop}>
                            停止
                        </button>
                    ) : (
                        <button
                            type="button"
                            className="btn-primary text-[13px]"
                            onClick={handleSend}
                            disabled={draft.trim().length === 0}
                        >
                            发送
                        </button>
                    )}
                </div>
            </div>

            {/* 大纲预览：确认后正文建骨架、细纲写大纲，一次到位 */}
            <Modal
                open={outlinePreview !== null}
                title="生成章节和细纲"
                subtitle={`解析出 ${outlinePreview?.length ?? 0} 章：正文建骨架章，细纲写每章大纲`}
                onClose={() => setOutlinePreview(null)}
                widthClass="max-w-2xl"
                footer={
                    <>
                        <span className="mr-auto text-[13px] text-ink-500">
                            确认后立即创建，之后可以自己改
                        </span>
                        <button
                            type="button"
                            className="btn-ghost"
                            onClick={() => setOutlinePreview(null)}
                        >
                            取消
                        </button>
                        <button
                            type="button"
                            className="btn-primary"
                            onClick={() => void confirmOutline()}
                        >
                            生成
                        </button>
                    </>
                }
            >
                <div className="max-h-[52vh] space-y-1.5 overflow-y-auto pr-1">
                    {(outlinePreview ?? []).map((item, index) => (
                        <div key={index} className="rounded-md border border-ink-800 p-2">
                            <p className="text-[13px] text-ink-100">
                                {index + 1}. {item.title}
                            </p>
                            <p className="mt-0.5 text-[12px] leading-relaxed text-ink-500">
                                {item.summary || item.content.slice(0, 90) || '（无大纲内容，只建标题）'}
                            </p>
                        </div>
                    ))}
                </div>
            </Modal>

            {/* 分段选用：默认全选，取消勾选就不要那一段 */}
            <Modal
                open={insertBlocks !== null}
                title="把段落插入正文"
                subtitle={`共 ${insertBlocks?.length ?? 0} 段，取消勾选不需要的`}
                onClose={() => setInsertBlocks(null)}
                widthClass="max-w-2xl"
                footer={
                    <>
                        <span className="mr-auto text-[13px] text-ink-500">
                            已选 {picked.size} 段
                        </span>
                        <button
                            type="button"
                            className="btn-ghost"
                            onClick={() =>
                                setPicked(new Set((insertBlocks ?? []).map((_block, index) => index)))
                            }
                        >
                            全选
                        </button>
                        <button type="button" className="btn-ghost" onClick={() => setPicked(new Set())}>
                            全不选
                        </button>
                        <button type="button" className="btn-primary" onClick={() => void confirmInsert()}>
                            插入到本章末尾
                        </button>
                    </>
                }
            >
                <div className="max-h-[52vh] space-y-2 overflow-y-auto pr-1">
                    {(insertBlocks ?? []).map((block, index) => (
                        <label
                            key={index}
                            className={`flex cursor-pointer gap-2 rounded-md border p-2 transition-colors ${
                                picked.has(index)
                                    ? 'border-jade-600 bg-jade-500/5'
                                    : 'border-ink-800 hover:border-ink-700'
                            }`}
                        >
                            <input
                                type="checkbox"
                                className="mt-1 shrink-0"
                                checked={picked.has(index)}
                                onChange={() => toggleBlock(index)}
                                style={{ accentColor: 'rgb(var(--jade-500))' }}
                            />
                            <span className="min-w-0 flex-1">
                                <span className="mb-0.5 block text-[12px] text-ink-600">
                                    第 {index + 1} 段 · {block.replace(/\s/g, '').length} 字
                                </span>
                                <span className="block whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink-200">
                                    {block}
                                </span>
                            </span>
                        </label>
                    ))}
                </div>
            </Modal>
        </div>
    );
}
