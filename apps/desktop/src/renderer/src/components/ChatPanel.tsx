import { useEffect, useMemo, useRef, useState } from 'react';
import { composeSystemPrompt, parseChatOptions, splitProseBlocks } from '@mojiang/core';
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

/** 系统提示：把"作者主导"写成硬规则，不是口号 */
const SYSTEM_PROMPT = [
    '你是「墨匠」里的中文网文写作助手。作者主导，你只负责按指令写和改。',
    '硬规则：',
    '1. 不替作者决定剧情走向，需要决定时给选项让作者选，不要自作主张。',
    '2. 续写时紧贴给出的正文，句长和用词习惯要接得上，不要突然变文风。',
    '3. 不写章末总结升华，不直接报情绪名（例如"他很愤怒"），用动作和细节写。',
    '4. 不编造上下文里没有的设定、人物和伏笔。缺信息就直接问。',
    '5. 输出正文时不要加解释、不要加"以下是"之类的开场。',
    '6. 需要作者做选择时（剧情走向、改法方向等），在回复最后单独加一个选项块，格式严格如下：',
    '【选项】',
    '1. 具体方案一',
    '2. 具体方案二',
    '选项块每次 2-4 个，只在真的要作者选时才加；其他时候不要出现这个块。',
].join('\n');

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

const QUICK_ACTIONS: QuickAction[] = [
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
     * 组装上下文：有选中用选中，否则用整章（超预算截断）
     * @returns 上下文块与覆盖统计
     */
    function buildContext(): {
        block: string | null;
        sentChars: number;
        totalChars: number;
        usedSelection: boolean;
    } {
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
        if (withChapter && content.trim().length > 0) {
            if (content.length <= MAX_CONTEXT_CHARS) {
                return {
                    block: `【当前章节正文，只作参考，不要整段复述】\n${content}`,
                    sentChars: content.length,
                    totalChars,
                    usedSelection: false,
                };
            }
            // 超预算：开头四成 + 结尾六成（结尾是最近写的，更重要）
            const headLength = Math.floor(MAX_CONTEXT_CHARS * 0.4);
            const tailLength = MAX_CONTEXT_CHARS - headLength;
            const head = content.slice(0, headLength);
            const tail = content.slice(-tailLength);
            return {
                block:
                    '【当前章节正文（太长，只截取开头和结尾，中间省略）】\n' +
                    `${head}\n……（中间省略）……\n${tail}`,
                sentChars: MAX_CONTEXT_CHARS,
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
        const messages: ChatMessage[] = [
            {
                role: 'system',
                content: composeSystemPrompt(SYSTEM_PROMPT, settings?.ai.styleGuide ?? ''),
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

        const context = buildContext();
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
                    带本章正文
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
                {QUICK_ACTIONS.map((action) => (
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

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
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
                                    {parsed.body || (item.pending ? '…' : '')}
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
                                            {item.fromSelection && (
                                                <button
                                                    type="button"
                                                    className="rounded border border-jade-600/40 px-2 py-0.5 text-[13px] text-jade-600 transition-colors hover:bg-jade-500/10"
                                                    onClick={() => replaceSelection(parsed.body)}
                                                    title="把这段写回正文，替换你刚才选中的部分"
                                                >
                                                    替换选中
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                className="rounded border border-jade-600/40 px-2 py-0.5 text-[13px] text-jade-600 transition-colors hover:bg-jade-500/10"
                                                onClick={() => openInsert(parsed.body)}
                                            >
                                                用到正文
                                            </button>
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
