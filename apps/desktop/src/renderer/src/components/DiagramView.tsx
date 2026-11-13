import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    layoutFlow,
    layoutMindmap,
    parseFlow,
    parseMindmap,
    type DiagramLayout,
} from '@mojiang/core';
import { errorMessage } from '@/lib/format';
import { useAppStore } from '@/store/useAppStore';

/** 图表文件结构，存在书里的 图表.json */
interface DiagramFile {
    mode: 'mindmap' | 'flow';
    mindmapSource: string;
    flowSource: string;
}

/** 默认示例，空文件时先给个看得懂的模板 */
const DEFAULT_MINDMAP = ['- 墨匠\n  - 写作\n    - 章节管理\n    - 素材卡片\n  - 工具\n    - 码字统计\n    - 敏感词检查'];

const DEFAULT_FLOW = [
    '# 格式：A -> B，链条也行 A -> B -> C，连线文字用 : 说明',
    '# 节点带形状：步骤[解析]、判断{合法?}、起止(开始)',
    '(开始) -> 读取稿件[读取稿件]',
    '读取稿件[读取稿件] -> 判断{有章节标题?}',
    '判断{有章节标题?} -> 自动分章[自动分章] : 是',
    '判断{有章节标题?} -> 整篇导入[整篇导入] : 否',
    '自动分章[自动分章] -> (完成)',
    '整篇导入[整篇导入] -> (完成)',
];

/**
 * 布局并渲染一张 SVG 图
 * @param layout 布局结果
 * @param mode 图的类型
 * @returns SVG 元素
 */
function renderSvg(layout: DiagramLayout, mode: 'mindmap' | 'flow') {
    const boxMap = new Map(layout.boxes.map((box) => [box.id, box]));
    return (
        <svg
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            className="h-auto w-full"
            style={{ maxHeight: '70vh' }}
        >
            {/* 连线先画，压在框下面 */}
            {layout.edges.map((edge) => {
                const from = boxMap.get(edge.from);
                const to = boxMap.get(edge.to);
                if (!from || !to) {
                    return null;
                }
                // 思维导图从右缘连到左缘，流程图从底边连到顶边
                const isMind = mode === 'mindmap';
                const x1 = isMind ? from.x + from.width : from.x + from.width / 2;
                const y1 = isMind ? from.y + from.height / 2 : from.y + from.height;
                const x2 = isMind ? to.x : to.x + to.width / 2;
                const y2 = isMind ? to.y + to.height / 2 : to.y;
                // 贝塞尔曲线让连线带点弧度，不容易和别的线缠在一起
                const path = isMind
                    ? `M ${x1} ${y1} C ${x1 + 30} ${y1}, ${x2 - 30} ${y2}, ${x2} ${y2}`
                    : `M ${x1} ${y1} C ${x1} ${y1 + 24}, ${x2} ${y2 - 24}, ${x2} ${y2}`;
                return (
                    <g key={`${edge.from}-${edge.to}`}>
                        <path d={path} stroke="currentColor" strokeWidth={1.5} fill="none" className="text-ink-500" />
                        <polygon
                            points={
                                isMind
                                    ? `${x2},${y2} ${x2 + 8},${y2 - 4} ${x2 + 8},${y2 + 4}`
                                    : `${x2},${y2} ${x2 - 4},${y2 - 8} ${x2 + 4},${y2 - 8}`
                            }
                            className="fill-ink-500"
                        />
                        {edge.label && (
                            <text
                                x={(x1 + x2) / 2}
                                y={(y1 + y2) / 2 - 6}
                                textAnchor="middle"
                                className="fill-ink-300"
                                fontSize={11}
                            >
                                {edge.label}
                            </text>
                        )}
                    </g>
                );
            })}
            {/* 节点框 */}
            {layout.boxes.map((box) => {
                const isDiamond = box.shape === 'diamond';
                const isRound = box.shape === 'round';
                const points = isDiamond
                    ? `${box.x + box.width / 2},${box.y} ${box.x + box.width},${box.y + box.height / 2} ${box.x + box.width / 2},${box.y + box.height} ${box.x},${box.y + box.height / 2}`
                    : '';
                return (
                    <g key={box.id}>
                        {isDiamond ? (
                            <polygon points={points} className="fill-ink-900 stroke-ink-500" strokeWidth={1.5} />
                        ) : (
                            <rect
                                x={box.x}
                                y={box.y}
                                width={box.width}
                                height={box.height}
                                rx={isRound ? box.height / 2 : 6}
                                className="fill-ink-900 stroke-ink-500"
                                strokeWidth={1.5}
                            />
                        )}
                        <text
                            x={box.x + box.width / 2}
                            y={box.y + box.height / 2 + 4}
                            textAnchor="middle"
                            className="fill-ink-100"
                            fontSize={13}
                        >
                            {box.label}
                        </text>
                    </g>
                );
            })}
        </svg>
    );
}

/**
 * 图表工具：思维导图 + 流程图
 * 左边写文本源，右边实时出图；AI 一键从当前文档生成
 */
export default function DiagramView() {
    const book = useAppStore((state) => state.book);
    const chapterId = useAppStore((state) => state.chapterId);
    const content = useAppStore((state) => state.content);
    const settings = useAppStore((state) => state.settings);
    const pushToast = useAppStore((state) => state.pushToast);

    const [mode, setMode] = useState<'mindmap' | 'flow'>('mindmap');
    const [mindmapSource, setMindmapSource] = useState(DEFAULT_MINDMAP.join('\n'));
    const [flowSource, setFlowSource] = useState(DEFAULT_FLOW.join('\n'));
    const [aiTopic, setAiTopic] = useState('');
    const [generating, setGenerating] = useState(false);

    /**
     * 读图表文件
     */
    const reload = useCallback(async () => {
        if (!book) {
            return;
        }
        try {
            const file = await window.api.file.readJson<DiagramFile>(book.id, '图表.json', {
                mode: 'mindmap',
                mindmapSource: DEFAULT_MINDMAP.join('\n'),
                flowSource: DEFAULT_FLOW.join('\n'),
            });
            setMode(file.mode === 'flow' ? 'flow' : 'mindmap');
            setMindmapSource(file.mindmapSource || DEFAULT_MINDMAP.join('\n'));
            setFlowSource(file.flowSource || DEFAULT_FLOW.join('\n'));
        } catch (error) {
            pushToast('error', `读图表失败：${errorMessage(error)}`);
        }
    }, [book, pushToast]);

    useEffect(() => {
        void reload();
    }, [reload]);

    /**
     * 两个源都落盘（模式切换、改文本都存）
     * @param nextMode 当前模式
     * @param nextMindmap 思维导图源
     * @param nextFlow 流程图源
     */
    async function persist(
        nextMode: 'mindmap' | 'flow',
        nextMindmap: string,
        nextFlow: string,
    ): Promise<void> {
        if (!book) {
            return;
        }
        try {
            await window.api.file.writeJson(book.id, '图表.json', {
                mode: nextMode,
                mindmapSource: nextMindmap,
                flowSource: nextFlow,
            } satisfies DiagramFile);
        } catch (error) {
            pushToast('error', `存图表失败：${errorMessage(error)}`);
        }
    }

    /** 当前模式下的源文本 */
    const source = mode === 'mindmap' ? mindmapSource : flowSource;

    /** 实时布局，输入即出图 */
    const layout = useMemo(() => {
        if (mode === 'mindmap') {
            const roots = parseMindmap(source);
            return roots.length > 0 ? layoutMindmap(roots) : null;
        }
        const graph = parseFlow(source);
        return graph.nodes.length > 0 ? layoutFlow(graph) : null;
    }, [mode, source]);

    /**
     * 改源文本并存盘
     * @param text 新源文本
     */
    function updateSource(text: string): void {
        if (mode === 'mindmap') {
            setMindmapSource(text);
            void persist(mode, text, flowSource);
        } else {
            setFlowSource(text);
            void persist(mode, mindmapSource, text);
        }
    }

    /**
     * 让 AI 按当前模式的格式生成图源
     * 素材：用户填的主题，或者当前打开的文档
     */
    async function generateWithAi(): Promise<void> {
        if (!settings) {
            return;
        }
        const topic = aiTopic.trim();
        const base = topic.length > 0 ? topic : chapterId ? content : '';
        if (base.trim().length === 0) {
            pushToast('error', '先填个主题，或者打开一篇文档');
            return;
        }
        setGenerating(true);
        const requestId = crypto.randomUUID();
        let buffer = '';
        // 流式回包不断拼进编辑框，边生成边看
        window.api.llm.onStream((event) => {
            if (event.requestId !== requestId) {
                return;
            }
            if (event.type === 'chunk' && event.delta) {
                buffer += event.delta;
                if (mode === 'mindmap') {
                    setMindmapSource(buffer);
                } else {
                    setFlowSource(buffer);
                }
            }
        });
        try {
            const rule =
                mode === 'mindmap'
                    ? '输出思维导图大纲：Markdown 无序列表，用两个空格缩进表示层级，每行以「- 」开头。只输出列表本身，不要解释。'
                    : '输出流程图边列表：每行格式「A -> B」或「A -> B -> C」，连线文字用「A -> B : 是」。节点形状：步骤[名字]、判断{问题}、起止(名字)。只输出边列表，不要解释。';
            const result = await window.api.llm.chat({
                requestId,
                providerId: settings.provider.id,
                model: settings.provider.model,
                messages: [
                    { role: 'system', content: `你是图表助手，${rule}` },
                    { role: 'user', content: `根据下面的内容生成图：\n\n${base.slice(0, 4000)}` },
                ],
                temperature: 0.3,
                maxTokens: 1200,
                purpose: 'diagram-generate',
            });
            if (!result.accepted) {
                window.api.llm.offStream();
                pushToast('error', result.message ?? '请求被拒绝');
            }
        } catch (error) {
            pushToast('error', `生成失败：${errorMessage(error)}`);
        } finally {
            window.api.llm.offStream();
            setGenerating(false);
            // 生成完按最终文本存盘
            const finalText = mode === 'mindmap' ? buffer || mindmapSource : buffer || flowSource;
            if (mode === 'mindmap') {
                void persist(mode, finalText, flowSource);
            } else {
                void persist(mode, mindmapSource, finalText);
            }
        }
    }

    return (
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-ink-950">
            {/* 顶栏：模式切换 + AI 生成 */}
            <div className="flex h-11 shrink-0 items-center justify-between border-b border-ink-800 bg-ink-900 px-4">
                <div className="flex items-center gap-1.5">
                    <h2 className="mr-2 text-sm font-medium text-ink-100">图表</h2>
                    {(['mindmap', 'flow'] as const).map((item) => (
                        <button
                            key={item}
                            type="button"
                            className={mode === item ? 'btn-outline h-7 text-[13px] text-jade-400' : 'btn-ghost h-7 text-[13px]'}
                            onClick={() => {
                                setMode(item);
                                void persist(item, mindmapSource, flowSource);
                            }}
                        >
                            {item === 'mindmap' ? '思维导图' : '流程图'}
                        </button>
                    ))}
                </div>
                <div className="flex items-center gap-2">
                    <input
                        className="field h-7 w-52 text-[13px]"
                        placeholder="AI 主题，留空则用当前文档"
                        value={aiTopic}
                        onChange={(event) => setAiTopic(event.target.value)}
                    />
                    <button
                        type="button"
                        className="btn-primary h-7 text-[13px]"
                        onClick={() => void generateWithAi()}
                        disabled={generating}
                    >
                        {generating ? '生成中…' : 'AI 帮我画'}
                    </button>
                </div>
            </div>

            <div className="flex min-h-0 flex-1 overflow-hidden">
                {/* 左：文本源 */}
                <div className="flex w-80 shrink-0 flex-col border-r border-ink-800">
                    <p className="px-3 py-2 text-[13px] text-ink-500">
                        {mode === 'mindmap'
                            ? '缩进列表：两个空格一级，「- 」开头'
                            : '边列表：A -> B，形状用 [步骤] {判断} (起止)'}
                    </p>
                    <textarea
                        className="min-h-0 flex-1 resize-none bg-transparent p-3 font-mono text-[13px] leading-relaxed text-ink-200 outline-none"
                        value={source}
                        onChange={(event) => updateSource(event.target.value)}
                        spellCheck={false}
                    />
                </div>
                {/* 右：预览 */}
                <div className="min-w-0 flex-1 overflow-auto p-6">
                    {layout ? (
                        <div className="text-ink-300">{renderSvg(layout, mode)}</div>
                    ) : (
                        <p className="mt-10 text-center text-[13px] text-ink-500">
                            左边按格式写，这里实时出图。也能点右上角「AI 帮我画」自动生成。
                        </p>
                    )}
                </div>
            </div>
        </main>
    );
}
