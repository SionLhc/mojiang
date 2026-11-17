import { useEffect, useMemo, useRef, useState } from 'react';
import {
    buildRetryPrompt,
    chatRolePrompt,
    composeSystemPrompt,
    computeContextBudget,
    formatWindowTokens,
    matchAllSkills,
    matchSkill,
    MAX_SKILL_RETRY,
    parseChatOptions,
    parseOutlineChapters,
    pickPreferencePairs,
    preferencePromptBlock,
    skillPromptBlock,
    splitProseBlocks,
    toSkillKind,
    validateSkillOutput,
    type OutlineChapter,
    type PreferencePair,
    type ProjectKind,
    type Skill,
} from '@mojiang/core';
import type { ChatMessage } from '@mojiang/llm';
import Modal from '@/components/Modal';
import SkillDialog from '@/components/SkillDialog';
import { errorMessage, formatCharCount, formatCny } from '@/lib/format';
import { markAiText } from '@/lib/preference';
import { useAppStore } from '@/store/useAppStore';

/** 一个已添加的附件（提取后的纯文本） */
interface ChatAttachment {
    name: string;
    text: string;
    chars: number;
    truncated: boolean;
}

/** 一条聊天记录 */
interface ChatItem {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    /** 本条消息附带的文档名（只用于显示，内容已并进上下文） */
    attachmentNames?: string[];
    /** 还在流式输出 */
    pending?: boolean;
    error?: boolean;
    costCny?: number;
    /** 这条回复命中的技能名（显示用） */
    skillName?: string;
    /** 输出校验没通过时的说明（自动重写前给作者一个交代） */
    checkerNote?: string;
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

/**
 * 按字数预算保留最近的对话历史
 * 界面照旧显示全部，只是请求里不带最早的几轮——否则越聊越贵，迟早撞上模型窗口
 * @param items 全部记录
 * @param budgetChars 历史预算（字），小于等于 0 表示不裁剪
 * @returns 要发出去的历史
 */
function trimHistory(items: ChatItem[], budgetChars: number): ChatItem[] {
    if (budgetChars <= 0) {
        return items;
    }
    const kept: ChatItem[] = [];
    let used = 0;
    for (let index = items.length - 1; index >= 0; index -= 1) {
        const item = items[index];
        const cost = item.content.length;
        if (used + cost > budgetChars && kept.length > 0) {
            break;
        }
        kept.unshift(item);
        used += cost;
    }
    return kept;
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
    {
        key: 'outlineCheck',
        label: '对照细纲检查',
        prompt: '对照本章细纲检查正文：细纲要写到的点是否都写了、有没有和细纲冲突、缺了哪些。分条列出问题，不要改正文。',
        needSelection: false,
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
    const skillVersion = useAppStore((state) => state.skillVersion);
    const segmentRequest = useAppStore((state) => state.segmentRequest);
    const clearSegmentRequest = useAppStore((state) => state.clearSegmentRequest);

    /** 上下文预算：按作者填的模型窗口算，没填就是默认档 */
    const budget = useMemo(
        () => computeContextBudget(settings?.provider.contextWindow),
        [settings?.provider.contextWindow],
    );

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
    /** 本次要带给 AI 的文档附件（提取后的纯文本） */
    const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
    const [session, setSession] = useState<SessionStats>(EMPTY_SESSION);
    /** 最近一次发送的上下文覆盖：发出去多少字 / 本章共多少字 / 省了几条历史 */
    const [contextInfo, setContextInfo] = useState<{
        sentChars: number;
        totalChars: number;
        omitted: number;
    } | null>(null);
    /** 已安装的技能（启用与否在技能对象里） */
    const [skills, setSkills] = useState<Skill[]>([]);
    /** 学到的改法：注入提示用，按当前项目类型过滤后再拼 */
    const [preferencePairs, setPreferencePairs] = useState<PreferencePair[]>([]);
    /** 我的笔感拼好的提示块：成熟度不够时是空串，等于不注入 */
    const [personalPrompt, setPersonalPrompt] = useState('');
    /** 技能管理弹窗是否打开 */
    const [skillDialogOpen, setSkillDialogOpen] = useState(false);
    /** 临时跳过的技能 id：只想这一轮不用，不动全局开关 */
    const [skippedSkills, setSkippedSkills] = useState<Set<string>>(new Set());
    /** 本轮真正参与匹配的技能：全局启用的减去临时跳过的 */
    const activeSkills = useMemo(
        () => skills.filter((skill) => !skippedSkills.has(skill.id)),
        [skills, skippedSkills],
    );
    /** 已启用的技能数，给顶部按钮显示，作者一眼知道有几条规则在生效 */
    const enabledSkillCount = skills.filter((skill) => skill.enabled).length;

    // 「用到正文」的分段选择：null 表示弹窗关闭
    const [insertBlocks, setInsertBlocks] = useState<string[] | null>(null);
    const [picked, setPicked] = useState<Set<number>>(new Set());
    const appendToChapter = useAppStore((state) => state.appendToChapter);
    const currentRequestRef = useRef<string | null>(null);
    const bottomRef = useRef<HTMLDivElement | null>(null);
    /** 刚加载完记忆时跳过一次存盘，免得把历史原样写回去 */
    const skipNextMemorySave = useRef(true);
    /** 正在等段落改写结果：记下位置和原文，AI 改完写 segmentResult */
    const pendingSegmentRef = useRef<{ from: number; to: number; original: string } | null>(null);
    /** 本轮流式回复的累积文本（段落改写结果从这拿） */
    const pendingReplyRef = useRef('');
    /** 本轮命中的技能：自动重试时继续沿用，不能重新匹配 */
    const activeSkillRef = useRef<Skill | null>(null);
    /** 本轮已自动重试次数，防止校验一直不过烧钱 */
    const retryCountRef = useRef(0);
    /** 校验没过时要补发的重写指令，置入后由 effect 发出去（避免陈旧闭包） */
    const retryPromptRef = useRef<{ prompt: string; skill: Skill } | null>(null);
    /** 重试触发计数：变化一次就发一次重写请求 */
    const [retryTick, setRetryTick] = useState(0);

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

    // 加载技能：技能页增删改后 skillVersion +1，这里跟着重新拉
    useEffect(() => {
        void (async () => {
            try {
                setSkills(await window.api.skill.list());
            } catch {
                setSkills([]);
            }
        })();
    }, [skillVersion]);

    // 加载学到的改法与我自己的笔感：换书时重拉一次，刚学到的东西下次进面板就能用上
    useEffect(() => {
        void (async () => {
            try {
                const data = await window.api.preference.overview();
                setPreferencePairs(data.pairs);
            } catch {
                // 读不到就按"还没学到东西"处理，不影响对话
                setPreferencePairs([]);
            }
            try {
                const prompt = await window.api.personal.prompt();
                setPersonalPrompt(prompt.block);
            } catch {
                // 笔感读不出来只少一段提示，对话照常
                setPersonalPrompt('');
            }
        })();
    }, [book?.id]);

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
                pendingReplyRef.current += delta;
                setItems((previous) =>
                    previous.map((item) =>
                        item.pending ? { ...item, content: item.content + delta } : item,
                    ),
                );
            }
            if (event.type === 'done') {
                const promptTokens = event.usage?.promptTokens ?? 0;
                const completionTokens = event.usage?.completionTokens ?? 0;
                const finishedText = pendingReplyRef.current;
                const skill = activeSkillRef.current;

                // 技能校验：声明了规则就检查一遍，不合格自动重写（最多 2 次）
                if (skill && skill.checkers.length > 0 && !pendingSegmentRef.current) {
                    const failures = validateSkillOutput(finishedText, skill.checkers);
                    if (failures.length > 0 && retryCountRef.current < MAX_SKILL_RETRY) {
                        retryCountRef.current += 1;
                        const attempt = retryCountRef.current;
                        const reasons = failures.map((failure) => failure.message).join('；');
                        // 把这一条标成"没通过"，作者能看到为什么又重写了一轮
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
                                          checkerNote: `没通过校验：${reasons}（自动重写第 ${attempt} 次）`,
                                      }
                                    : item,
                            ),
                        );
                        setStreaming(false);
                        currentRequestRef.current = null;
                        pendingReplyRef.current = '';
                        // 这一轮也花了钱，统计照记
                        setSession((previous) => ({
                            calls: previous.calls + 1,
                            promptTokens: previous.promptTokens + promptTokens,
                            completionTokens: previous.completionTokens + completionTokens,
                            costCny: previous.costCny + (event.costCny ?? 0),
                            suggestions: previous.suggestions + 1,
                            adopted: previous.adopted,
                        }));
                        retryPromptRef.current = { prompt: buildRetryPrompt(failures), skill };
                        setRetryTick((previous) => previous + 1);
                        return;
                    }
                }

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
                // 段落改写：AI 改完了，把结果交给编辑器弹对比
                const pendingSegment = pendingSegmentRef.current;
                if (pendingSegment) {
                    pendingSegmentRef.current = null;
                    useAppStore.getState().setSegmentResult({
                        original: pendingSegment.original,
                        rewritten: pendingReplyRef.current.trim(),
                        from: pendingSegment.from,
                        to: pendingSegment.to,
                    });
                }
                pendingReplyRef.current = '';
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
                pendingSegmentRef.current = null;
                pendingReplyRef.current = '';
            }
        });

        return () => {
            window.api.llm.offStream();
        };
    }, []);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [items]);

    // 校验没过：等上一轮收尾渲染完成（streaming 复位）后再补发重写请求
    useEffect(() => {
        if (retryTick === 0) {
            return;
        }
        const payload = retryPromptRef.current;
        if (!payload) {
            return;
        }
        retryPromptRef.current = null;
        void sendMessage(payload.prompt, payload.skill);
    }, [retryTick]);

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
        // 必须写在落盘之后：对齐发生在下一次保存，先记会被这次保存直接吃掉
        markAiText(text);
        markAdopted();
        setInsertBlocks(null);
    }

    /**
     * 把 AI 回复替换到正文选区（发送时用了选中的才有入口）
     * @param text AI 回复正文
     */
    function replaceSelection(text: string): void {
        requestReplace(text);
        markAiText(text);
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
             * @param limit 这块最多多少字
             */
            const push = (label: string, text: string, limit: number): void => {
                const trimmed = text.trim();
                if (trimmed.length === 0 || sentChars >= budget.totalChars) {
                    return;
                }
                const clipped = clipToBudget(
                    trimmed,
                    Math.min(limit, budget.totalChars - sentChars),
                );
                blocks.push(`【${label}】\n${clipped}`);
                sentChars += clipped.length;
            };
            push('当前章正文', pack.body, budget.body);
            push('本章细纲', pack.outline, budget.outline);
            push('剧情画板', pack.plot, budget.plot);
            for (const item of pack.items) {
                // 前情提要要装几十章的摘要，单独给预算；其余工具项按项预算
                push(
                    item.label,
                    item.content,
                    item.key === 'recap' ? budget.recap : budget.packItem,
                );
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
            const clipped = clipToBudget(content, budget.totalChars);
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
     * @param skill 本轮命中的技能，null 表示没命中
     * @returns 消息数组
     */
    function buildMessages(
        input: string,
        contextBlock: string | null,
        skill: Skill | null,
        personalOverride?: string,
    ): ChatMessage[] {
        // 附加指令也按项目类型取：小说、文档、笔记各用各的那一栏
        const kind = book?.kind ?? 'novel';
        const styleGuide =
            kind === 'docs'
                ? (settings?.ai.docsStyleGuide ?? '')
                : kind === 'notes'
                  ? (settings?.ai.notesStyleGuide ?? '')
                  : (settings?.ai.novelStyleGuide ?? '');

        // 技能指令排在角色提示之后、附加指令之前：越靠后的系统提示，模型越当回事
        const baseSystem = composeSystemPrompt(chatRolePrompt(book?.kind), styleGuide);

        // 我的笔感排在通用规则之后、具体改法之前：
        // "我是个怎么写的人"比"这一句我改成了什么"更靠近角色本身；
        // 只在小说里注入，文档和笔记不该被叙事习惯影响
        const personalBlock =
            kind === 'novel' && settings?.ai.personalTraceInject !== false
                ? (personalOverride ?? personalPrompt)
                : '';
        const withPersonal =
            personalBlock.length > 0 ? `${baseSystem}\n\n${personalBlock}` : baseSystem;

        // 作者的真实改法排在技能之前：技能的硬规则更该压轴，不能被风格示范盖过
        const preferenceBlock =
            settings?.ai.preferenceInject === false
                ? ''
                : preferencePromptBlock(pickPreferencePairs(preferencePairs, toSkillKind(kind)));
        const withPreference =
            preferenceBlock.length > 0 ? `${withPersonal}\n\n${preferenceBlock}` : withPersonal;

        const messages: ChatMessage[] = [
            {
                role: 'system',
                // 提示按项目类型来：小说是小说，工作文档/笔记各用各的规则
                content: skill
                    ? `${withPreference}\n\n${skillPromptBlock(skill)}`
                    : withPreference,
            },
        ];

        if (contextBlock) {
            messages.push({ role: 'user', content: contextBlock });
        }

        // 历史按预算保留最近的：界面还是全的，发出去的只带能装下的部分
        for (const item of trimHistory(items, budget.history)) {
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
     * @param retryOf 传入表示这是校验重试，沿用它指定的技能；不传表示作者新发的一轮
     */
    async function sendMessage(text: string, retryOf?: Skill | null): Promise<void> {
        const input = text.trim();
        if (input.length === 0 || streaming) {
            return;
        }
        if (!settings) {
            pushToast('info', '先去设置里配模型');
            return;
        }

        // 作者新发的一轮才重新匹配技能；重试沿用上一轮，并保留重试计数
        if (retryOf === undefined) {
            const matched = matchSkill(input, toSkillKind(book?.kind), activeSkills);
            activeSkillRef.current = matched?.skill ?? null;
            retryCountRef.current = 0;
        }
        const skill = activeSkillRef.current;

        // 笔感可能刚在设置里被切换（比如"回到从前"），不能还拿挂载时那一份；
        // 主进程对这个块有 60 秒缓存，命中时几乎不花时间
        let personalBlock = personalPrompt;
        try {
            personalBlock = (await window.api.personal.prompt()).block;
        } catch {
            // 取不到就沿用上次的，不影响这一轮对话
        }

        const context = await buildContext();
        // 附件并进上下文：本次发送的文档当作参考资料，气泡上只显示文件名
        const attachmentBlock = attachments
            .map(
                (item) =>
                    `【附件：${item.name}（${item.chars} 字${item.truncated ? '，已截断' : ''}）】\n${item.text}`,
            )
            .join('\n\n');
        const contextBlock = [context.block, attachmentBlock]
            .filter((part): part is string => (part ?? '').trim().length > 0)
            .join('\n\n');
        setContextInfo({
            sentChars: context.sentChars + attachmentBlock.length,
            totalChars: context.totalChars + attachmentBlock.length,
            omitted: items.length - trimHistory(items, budget.history).length,
        });

        const stamp = Date.now().toString(36);
        const userItem: ChatItem = {
            id: `u_${stamp}`,
            role: 'user',
            content: input,
            attachmentNames:
                attachments.length > 0 ? attachments.map((item) => item.name) : undefined,
        };
        const assistantItem: ChatItem = {
            id: `a_${stamp}`,
            role: 'assistant',
            content: '',
            pending: true,
            fromSelection: context.usedSelection,
            skillName: skill?.name,
        };
        const messages = buildMessages(
            input,
            contextBlock.length > 0 ? contextBlock : null,
            skill,
            personalBlock,
        );

        pendingReplyRef.current = '';
        setItems((previous) => [...previous, userItem, assistantItem]);
        // 附件只在这一轮用，发完清掉；要再用就重新加
        setAttachments([]);
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

    // 编辑器里标注了段落要改：自动发给 AI，改完回编辑器弹对比
    useEffect(() => {
        if (!segmentRequest) {
            return;
        }
        const { text, note, from, to } = segmentRequest;
        clearSegmentRequest();
        if (streaming) {
            pushToast('info', 'AI 正在回复，等这一轮结束再试');
            return;
        }
        pendingSegmentRef.current = { from, to, original: text };
        void sendMessage(
            `请只改写下面这一段，按我的标注处理。原文共 ${text.length} 字，改后字数要接近原文，` +
                '不要扩写成别的内容、不要动其他段落。只输出改后的这一段文字本身，不要解释、不要加引号。\n' +
                `\n我的标注：${note.length > 0 ? note : '（没写标注，按语境优化这一段）'}\n` +
                `\n这一段原文：\n${text}`,
        );
    }, [segmentRequest, clearSegmentRequest, streaming, pushToast]);

    // 快捷指令按项目类型切换：小说续写，工作文档补要点，笔记提炼
    const quickActions = useMemo(() => quickActionsFor(book?.kind), [book?.kind]);

    /**
     * 按细纲写本章：读细纲 + 全部工具上下文，直接落进正文
     * 没有细纲就不生成——先做菜单再做菜
     */
    async function startWriteChapter(): Promise<void> {
        if (!book || streaming) {
            return;
        }
        try {
            const outlineList = await window.api.chapter.list(book.id, 'xigang');
            const outlineText =
                outlineList.length > 0
                    ? await window.api.chapter.read(book.id, 'xigang', outlineList[0].id)
                    : '';
            if (outlineText.trim().length < 20) {
                pushToast('info', '这一章还没有细纲。先让 AI 列大纲、写到细纲，再来写正文');
                return;
            }
        } catch {
            // 读不到细纲就让 AI 按已有上下文判断
        }
        const title = chapters.find((item) => item.id === chapterId)?.title ?? '本章';
        void sendMessage(
            `按《${title}》的细纲写这一章的正文，1500-2500 字。` +
                '要求：按细纲要写的顺序和冲突展开；人物说话方式、伏笔、账本状态都以参考材料为准；' +
                '只输出正文本身，不要输出标题行、不要解释、不要选项块。',
        );
    }

    /** 新书：小说项目且还没有任何章节 → 显示开书引导 */
    const isNewNovel = isNovelProject && chapters.length === 0;

    /**
     * 拖文件进输入框也能加附件
     * @param files 拖进来的文件
     */
    async function dropAttachments(files: FileList): Promise<void> {
        const list = [...files];
        // Electron 32 起 File.path 已移除，必须走 webUtils（preload 暴露的 pathForFile）
        const paths = list
            .map((file) => {
                try {
                    return window.api.attachment.pathForFile(file);
                } catch {
                    return '';
                }
            })
            .filter((path) => path.length > 0);
        if (paths.length === 0) {
            // 没有真实路径的是截图/网页图片这类，直接走 OCR
            const images = list.filter((file) => file.type.startsWith('image/'));
            if (images.length > 0) {
                await recognizeImages(images);
            }
            return;
        }
        try {
            const result = await window.api.attachment.extract(paths);
            if (result.items.length > 0) {
                setAttachments((previous) => [...previous, ...result.items].slice(0, 5));
            }
            for (const error of result.errors) {
                pushToast('error', `${error.name || '附件'}：${error.message}`);
            }
        } catch (error) {
            pushToast('error', errorMessage(error));
        }
    }

    /**
     * 图片识别：用本地 OCR 把图里的文字提出来当附件
     * 不需要视觉模型，Windows 自带引擎，离线可用
     * @param images 图片文件
     */
    async function recognizeImages(images: File[]): Promise<void> {
        pushToast('info', '正在识别图片里的文字…');
        for (const file of images.slice(0, 3)) {
            try {
                const bytes = new Uint8Array(await file.arrayBuffer());
                const result = await window.api.attachment.ocrImage(
                    bytes,
                    file.type || 'image/png',
                );
                if (!result.ok) {
                    pushToast('error', result.message ?? '图片识别失败');
                    continue;
                }
                const text = result.text.trim();
                setAttachments((previous) =>
                    [
                        ...previous,
                        {
                            name: `图片文字 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`,
                            text,
                            chars: text.length,
                            truncated: false,
                        },
                    ].slice(0, 5),
                );
                pushToast('success', `已识别图片文字（${text.length} 字）`);
            } catch (error) {
                pushToast('error', errorMessage(error));
            }
        }
    }

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

    // 输入草稿会命中哪些技能：第一个是本轮生效的，其余只作提示，避免作者以为技能全都一起上
    const draftMatches = useMemo(
        () =>
            draft.trim().length > 0
                ? matchAllSkills(draft, toSkillKind(book?.kind), activeSkills)
                : [],
        [draft, book?.kind, activeSkills],
    );
    const draftMatch = draftMatches[0] ?? null;

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
            {/* 顶部两行：开关/模型/清空 + 按细纲写本章（右栏窄，塞一行会挤成一团） */}
            <div className="shrink-0 border-b border-ink-800 px-3 py-1.5">
                <div className="flex items-center justify-between gap-2">
                    <label
                        className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[12px] text-ink-400"
                        title={isNovelProject ? '带当前章正文和细纲作为上下文' : '带当前文档作为上下文'}
                    >
                        <input
                            type="checkbox"
                            className="h-3 w-3 accent-jade-500"
                            checked={withChapter}
                            onChange={(event) => setWithChapter(event.target.checked)}
                        />
                        {isNovelProject ? '正文+细纲' : '带本章正文'}
                    </label>
                    <div className="flex min-w-0 items-center gap-2">
                        <span
                            className="truncate text-[12px] text-ink-500"
                            title={settings ? settings.provider.model : ''}
                        >
                            {settings ? settings.provider.model : ''}
                        </span>
                        <button
                            type="button"
                            className="shrink-0 text-[12px] text-ink-500 hover:text-ink-300"
                            onClick={() => setSkillDialogOpen(true)}
                            title="管理技能包：装、停用、删除"
                        >
                            技能 {enabledSkillCount}/{skills.length}
                        </button>
                        <button
                            type="button"
                            className="shrink-0 text-[12px] text-ink-500 hover:text-ink-300"
                            onClick={handleClear}
                        >
                            清空
                        </button>
                    </div>
                </div>
                {isNovelProject && (
                    <button
                        type="button"
                        className="mt-1.5 w-full rounded border border-jade-600/40 py-0.5 text-[12px] text-jade-500 transition-colors hover:bg-jade-500/10 disabled:opacity-50"
                        onClick={() => void startWriteChapter()}
                        disabled={streaming}
                        title="读本章细纲和全部工具，直接写出这一章正文"
                    >
                        按细纲写本章
                    </button>
                )}
            </div>

            {/* 快捷指令：手边常做的几种改动，一键发起；窄栏换行而不是横向滚动 */}
            <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-ink-800 px-3 py-1.5">
                {quickActions.map((action) => (
                    <button
                        key={action.key}
                        type="button"
                        className="shrink-0 rounded-full border border-ink-700 px-2.5 py-0.5 text-[12px] text-ink-300 transition-all hover:-translate-y-px hover:border-jade-500/60 hover:bg-jade-500/10 hover:text-jade-400 active:translate-y-0 disabled:opacity-50"
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
                                className={`bubble-enter ${item.role === 'user' ? 'text-right' : 'text-left'}`}
                            >
                                {/* 命中的技能挂在气泡上方，作者知道这一轮用了哪套套路 */}
                                {item.role === 'assistant' && item.skillName && (
                                    <div className="mb-1">
                                        <span className="inline-flex items-center gap-1 rounded-full bg-jade-500/10 px-2 py-0.5 text-[11px] text-jade-500">
                                            <span className="h-1 w-1 rounded-full bg-jade-500" />
                                            技能 · {item.skillName}
                                        </span>
                                    </div>
                                )}
                                <div
                                    className={`inline-block max-w-full whitespace-pre-wrap rounded-2xl px-2.5 py-2 text-left text-[13px] leading-relaxed ${
                                        item.role === 'user'
                                            ? 'bubble-user text-ink-100'
                                            : item.error
                                              ? 'rounded-bl-md bg-red-500/10 text-red-300 ring-1 ring-red-500/20'
                                              : 'rounded-bl-md bg-ink-850 text-ink-200'
                                    }`}
                                >
                                    {parsed.body}
                                    {/* 这条消息带了的文档附件（内容已并进上下文，这里只显示文件名） */}
                                    {item.attachmentNames && item.attachmentNames.length > 0 && (
                                        <div className="mt-1 flex flex-wrap gap-1 border-t border-jade-600/20 pt-1">
                                            {item.attachmentNames.map((name) => (
                                                <span
                                                    key={name}
                                                    className="max-w-[140px] truncate text-[11px] text-jade-500"
                                                    title={name}
                                                >
                                                    📄 {name}
                                                </span>
                                            ))}
                                        </div>
                                    )}
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

                                {/* 校验没通过：告诉作者为什么重写，以及重写了几次 */}
                                {item.checkerNote && (
                                    <p className="mt-1 rounded-md bg-amber-500/10 px-2 py-1 text-[11px] leading-relaxed text-amber-500">
                                        {item.checkerNote}
                                    </p>
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
                            {contextInfo && contextInfo.omitted > 0
                                ? `，已省略最早 ${contextInfo.omitted} 条对话`
                                : ''}
                            {budget.scaled
                                ? ` · 按 ${formatWindowTokens(settings?.provider.contextWindow ?? 0)} 窗口`
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
                {/* 已添加的附件：文件名 + 字数，可单独移除 */}
                {attachments.length > 0 && (
                    <div className="mb-1.5 flex flex-wrap items-center gap-1">
                        {attachments.map((item, index) => (
                            <span
                                key={`${item.name}-${index}`}
                                className="flex items-center gap-1 rounded border border-jade-600/40 bg-jade-500/10 px-1.5 py-0.5 text-[12px] text-jade-500"
                            >
                                <span className="max-w-[120px] truncate" title={item.name}>
                                    📄 {item.name}
                                </span>
                                <span className="text-ink-500">{formatCharCount(item.chars)}</span>
                                <button
                                    type="button"
                                    className="text-ink-500 hover:text-red-400"
                                    onClick={() =>
                                        setAttachments((previous) =>
                                            previous.filter((_, i) => i !== index),
                                        )
                                    }
                                    title="移除这个附件"
                                >
                                    ×
                                </button>
                            </span>
                        ))}
                    </div>
                )}
                {/* 卡片式输入框：圆角卡片包裹，内部无边框，右下角圆形发送按钮 */}
                <div className="rounded-2xl border border-ink-750 bg-ink-850/60 p-2 transition-colors focus-within:border-jade-500/50">
                    {/* 触发词命中技能时提前提示，避免作者以为技能没生效 */}
                    {draftMatch && (
                        <div className="mb-1 flex items-center gap-1 px-1 text-[11px] text-jade-500">
                            <span className="h-1 w-1 shrink-0 rounded-full bg-jade-500" />
                            <span className="min-w-0 flex-1">
                                <span className="block truncate">
                                    将使用技能「{draftMatch.skill.name}」· 触发词「
                                    {draftMatch.trigger}」
                                </span>
                                {/* 同时命中多个时说明白：一轮只用一个技能，不是全部叠加 */}
                                {draftMatches.length > 1 && (
                                    <span className="block truncate text-ink-600">
                                        另有{' '}
                                        {draftMatches
                                            .slice(1)
                                            .map((match) => match.skill.name)
                                            .join('、')}{' '}
                                        也匹配，本轮不用
                                    </span>
                                )}
                            </span>
                            <button
                                type="button"
                                className="shrink-0 text-ink-500 hover:text-ink-300"
                                onClick={() =>
                                    setSkippedSkills((previous) =>
                                        new Set(previous).add(draftMatch.skill.id),
                                    )
                                }
                                title="这一轮先不用这个技能，下次输入还会正常命中"
                            >
                                这次不用
                            </button>
                        </div>
                    )}
                    {/* 临时跳过之后给个撤销口，不然作者会以为技能坏了 */}
                    {skippedSkills.size > 0 && (
                        <div className="mb-1 flex items-center gap-1 px-1 text-[11px] text-ink-500">
                            <span className="min-w-0 flex-1 truncate">
                                已临时跳过 {skippedSkills.size} 个技能
                            </span>
                            <button
                                type="button"
                                className="shrink-0 text-jade-500 hover:underline"
                                onClick={() => setSkippedSkills(new Set())}
                            >
                                恢复
                            </button>
                        </div>
                    )}
                    <textarea
                        className="h-20 w-full resize-none bg-transparent text-[13px] leading-relaxed placeholder:text-ink-500 focus:outline-none"
                        placeholder="说你要什么。Enter 发送，Shift+Enter 换行。文档/图片可以直接粘贴或拖进来"
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.shiftKey) {
                                event.preventDefault();
                                handleSend();
                            }
                        }}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                            event.preventDefault();
                            void dropAttachments(event.dataTransfer.files);
                        }}
                        onPaste={(event) => {
                            // 截图/复制的图片：本地 OCR 认字，直接变附件，不用点 📎
                            const images = [...event.clipboardData.items]
                                .filter((item) => item.type.startsWith('image/'))
                                .map((item) => item.getAsFile())
                                .filter((file): file is File => file !== null);
                            if (images.length > 0) {
                                event.preventDefault();
                                void recognizeImages(images);
                                return;
                            }
                            // 从资源管理器复制的文档：直接变成附件
                            const files = event.clipboardData.files;
                            if (files.length > 0) {
                                event.preventDefault();
                                void dropAttachments(files);
                            }
                            // 纯文本走默认粘贴
                        }}
                    />
                    <div className="mt-1 flex items-center justify-between">
                        <span className="px-1 text-[11px] text-ink-600">
                            {settings
                                ? `本月 ${formatCny(settings.usage.costCny)} / 上限 ${formatCny(
                                      settings.budget.monthlyLimitCny,
                                  )}`
                                : ''}
                        </span>
                        {streaming ? (
                            <button
                                type="button"
                                className="btn-outline h-8 rounded-full px-3 text-[12px]"
                                onClick={handleStop}
                                title="停止生成"
                            >
                                停止
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={handleSend}
                                disabled={draft.trim().length === 0}
                                className="flex h-8 w-8 items-center justify-center rounded-full bg-jade-500 text-ink-950 transition-all hover:bg-jade-400 active:scale-95 disabled:opacity-40"
                                title="发送（Enter）"
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
                                    <path d="M12 19V5" />
                                    <path d="m5 12 7-7 7 7" />
                                </svg>
                            </button>
                        )}
                    </div>
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

            <SkillDialog open={skillDialogOpen} onClose={() => setSkillDialogOpen(false)} />
        </div>
    );
}
