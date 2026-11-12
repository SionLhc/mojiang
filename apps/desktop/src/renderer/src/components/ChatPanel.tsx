import { useEffect, useRef, useState } from 'react';
import { composeSystemPrompt } from '@mojiang/core';
import type { ChatMessage } from '@mojiang/llm';
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
}

/** 系统提示：把"作者主导"写成硬规则，不是口号 */
const SYSTEM_PROMPT = [
    '你是「墨匠」里的中文网文写作助手。作者主导，你只负责按指令写和改。',
    '硬规则：',
    '1. 不替作者决定剧情走向，需要决定时先问一句，不要自作主张。',
    '2. 续写时紧贴给出的正文，句长和用词习惯要接得上，不要突然变文风。',
    '3. 不写章末总结升华，不直接报情绪名（例如"他很愤怒"），用动作和细节写。',
    '4. 不编造上下文里没有的设定、人物和伏笔。缺信息就直接问。',
    '5. 输出正文时不要加解释、不要加"以下是"之类的开场。',
].join('\n');

/** 预估输出长度，用于算钱 */
const ESTIMATED_OUTPUT_TOKENS = 1500;



/**
 * 右侧 AI 对话
 * 模型请求走主进程，渲染进程只拿流式文本，Key 永远不出主进程
 */
export default function ChatPanel() {
    const content = useAppStore((state) => state.content);
    const book = useAppStore((state) => state.book);
    const settings = useAppStore((state) => state.settings);
    const pushToast = useAppStore((state) => state.pushToast);

    const pendingPrompt = useAppStore((state) => state.pendingPrompt);
    const setPendingPrompt = useAppStore((state) => state.setPendingPrompt);

    const [items, setItems] = useState<ChatItem[]>([]);
    const [draft, setDraft] = useState('');
    const [streaming, setStreaming] = useState(false);
    const [withChapter, setWithChapter] = useState(true);
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
                setItems((previous) =>
                    previous.map((item) =>
                        item.pending ? { ...item, pending: false, costCny: event.costCny } : item,
                    ),
                );
                setStreaming(false);
                currentRequestRef.current = null;
                // 刷新月度用量显示
                void useAppStore.getState().updateSettings({});
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
     * 组装发给模型的消息
     * @param input 作者这次的指令
     * @returns 消息数组
     */
    function buildMessages(input: string): ChatMessage[] {
        const messages: ChatMessage[] = [
            {
                role: 'system',
                content: composeSystemPrompt(SYSTEM_PROMPT, settings?.ai.styleGuide ?? ''),
            },
        ];

        if (withChapter && content.trim().length > 0) {
            messages.push({
                role: 'user',
                content: `【当前章节正文，只作参考，不要整段复述】\n${content}`,
            });
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
     */
    async function handleSend(): Promise<void> {
        const input = draft.trim();
        if (input.length === 0 || streaming) {
            return;
        }
        if (!settings) {
            return;
        }

        const stamp = Date.now().toString(36);
        const userItem: ChatItem = { id: `u_${stamp}`, role: 'user', content: input };
        const assistantItem: ChatItem = {
            id: `a_${stamp}`,
            role: 'assistant',
            content: '',
            pending: true,
        };
        const messages = buildMessages(input);

        setItems((previous) => [...previous, userItem, assistantItem]);
        setDraft('');
        setStreaming(true);

        try {
            // 先算钱，超预算让作者自己决定
            const estimate = await window.api.llm.estimate(
                messages.map((message) => message.content),
                ESTIMATED_OUTPUT_TOKENS,
            );
            if (estimate.overMonthlyLimit) {
                setStreaming(false);
                setItems((previous) =>
                    previous.filter((item) => item.id !== assistantItem.id),
                );
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
                    setItems((previous) =>
                        previous.filter((item) => item.id !== assistantItem.id),
                    );
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
    }

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

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
                {items.length === 0 ? (
                    <div className="text-[13px] leading-relaxed text-ink-500">
                        <p className="mb-2 text-ink-400">可以让它做的事：</p>
                        <ul className="space-y-1">
                            <li>· 接着上一章往下写 800 字，不要变文风</li>
                            <li>· 把这三段里"心中一喜"式的写法改掉</li>
                            <li>· 这段对话太像同一个人，帮我改出区别</li>
                        </ul>
                        <p className="mt-3 text-ink-600">
                            它会自动带上当前章正文作参考，正文不会上传到墨匠的服务器。
                        </p>
                    </div>
                ) : (
                    items.map((item) => (
                        <div key={item.id} className={item.role === 'user' ? 'text-right' : 'text-left'}>
                            <div
                                className={`inline-block max-w-full whitespace-pre-wrap rounded-lg px-2.5 py-2 text-left text-[13px] leading-relaxed ${
                                    item.role === 'user'
                                        ? 'bg-jade-600/20 text-ink-100'
                                        : item.error
                                          ? 'bg-red-500/10 text-red-300'
                                          : 'bg-ink-850 text-ink-200'
                                }`}
                            >
                                {item.content || (item.pending ? '…' : '')}
                            </div>
                            {item.costCny !== undefined && (
                                <p className="mt-0.5 text-[13px] text-ink-600">
                                    本次 {formatCny(item.costCny)}
                                </p>
                            )}
                        </div>
                    ))
                )}
                <div ref={bottomRef} />
            </div>

            <div className="shrink-0 border-t border-ink-800 p-2">
                <textarea
                    className="field h-20 resize-none text-[13px] leading-relaxed"
                    placeholder="说你要什么。Enter 发送，Shift+Enter 换行"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                            event.preventDefault();
                            void handleSend();
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
                            onClick={() => void handleSend()}
                            disabled={draft.trim().length === 0}
                        >
                            发送
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
