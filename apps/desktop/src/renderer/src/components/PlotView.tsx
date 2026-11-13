import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Background,
    Controls,
    ReactFlow,
    ReactFlowProvider,
    addEdge,
    useEdgesState,
    useNodesState,
    useReactFlow,
    type Connection,
    type Edge,
    type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
    CANVAS_SYSTEM_PROMPT,
    PLOT_SYSTEM_PROMPT,
    buildCanvasUserPrompt,
    createPlotNode,
    getProjectFeatures,
    layoutMindmap,
    layoutToPlotItems,
    nextPlotNodeId,
    parseMindmap,
    parsePlotDiagnosis,
    plotKindsFor,
    type PlotDiagnosis,
    type PlotEdge,
    type PlotEdgeKind,
    type PlotGraph,
    type PlotNode,
    type PlotNodeKind,
} from '@mojiang/core';
import PlotNodeCard, { type PlotNodePayload } from '@/components/PlotNodeCard';
import { errorMessage } from '@/lib/format';
import { useAppStore } from '@/store/useAppStore';

/** 节点组件映射，必须定义在组件外，否则每次渲染都会重建 */
const NODE_TYPES = { plot: PlotNodeCard };

/**
 * 从画布节点里取出领域节点
 * React Flow 的 data 是 Record<string, unknown>，统一在这里断言
 * @param node 画布节点
 * @returns 领域节点，取不到返回 null
 */
function payloadOf(node: Node): PlotNode | null {
    const payload = node.data as unknown as PlotNodePayload | undefined;
    return payload?.node ?? null;
}

/** 诊断结果的类型说明 */
const FINDING_LABELS: Record<string, string> = {
    pacing: '节奏',
    'broken-chain': '断链',
    'weak-cause': '关系薄弱',
    absence: '人物缺席',
    'climax-position': '高潮位置',
    'branch-overload': '支线过载',
    isolated: '孤立节点',
    'missing-support': '缺少支撑',
};

/**
 * 剧情编排画布
 * 左侧节点图，右侧编辑面板与 AI 诊断结果
 */
export default function PlotView() {
    return (
        <ReactFlowProvider>
            <PlotCanvas />
        </ReactFlowProvider>
    );
}

function PlotCanvas() {
    const book = useAppStore((state) => state.book);
    const settings = useAppStore((state) => state.settings);
    const pushToast = useAppStore((state) => state.pushToast);
    const setActiveView = useAppStore((state) => state.setActiveView);
    const properNouns = useAppStore((state) => state.properNouns);

    // 小说用剧情语义，笔记和工作文档用通用语义
    const isNovel = getProjectFeatures(book?.kind).beatSheet;
    const kinds = plotKindsFor(isNovel);
    const primaryKind: PlotNodeKind = isNovel ? 'setup' : 'idea';
    const secondaryKind: PlotNodeKind = isNovel ? 'foreshadow' : 'task';

    const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [loaded, setLoaded] = useState(false);
    const [diagnosis, setDiagnosis] = useState<PlotDiagnosis | null>(null);
    const [diagnosing, setDiagnosing] = useState(false);
    const [rawOutput, setRawOutput] = useState('');
    const [drawing, setDrawing] = useState(false);
    const content = useAppStore((state) => state.content);

    const { screenToFlowPosition, setCenter } = useReactFlow();
    const skipNextSave = useRef(true);

    // 载入已有剧情图
    useEffect(() => {
        if (!book) {
            return;
        }
        void (async () => {
            try {
                const graph = await window.api.plot.read(book.id);
                setNodes(graph.nodes.map((node) => toFlowNode(node)));
                setEdges(graph.edges.map((edge) => toFlowEdge(edge)));
                skipNextSave.current = true;
                setLoaded(true);
            } catch (error) {
                pushToast('error', errorMessage(error));
            }
        })();
    }, [book, setNodes, setEdges, pushToast]);

    const selected = useMemo(() => {
        const target = nodes.find((node) => node.id === selectedId);
        return target ? payloadOf(target) : null;
    }, [nodes, selectedId]);

    // 坐标或连线变化后防抖存盘
    const signature = useMemo(
        () =>
            nodes
                .map((node) => `${node.id}@${Math.round(node.position.x)},${Math.round(node.position.y)}`)
                .join('|') +
            '#' +
            edges.map((edge) => `${edge.source}>${edge.target}`).join('|'),
        [nodes, edges],
    );

    useEffect(() => {
        if (!loaded || !book) {
            return;
        }
        if (skipNextSave.current) {
            skipNextSave.current = false;
            return;
        }
        const timer = window.setTimeout(() => {
            const graph = toGraph(nodes, edges);
            void window.api.plot.write(book.id, graph).catch((error: unknown) => {
                pushToast('error', `保存失败：${errorMessage(error)}`);
            });
        }, 700);
        return () => window.clearTimeout(timer);
    }, [signature, loaded, book, nodes, edges, pushToast]);

    /**
     * 新增节点
     * @param kind 类型
     * @param position 画布坐标
     */
    function addNode(kind: PlotNodeKind, position?: { x: number; y: number }): void {
        const existing = nodes.map(payloadOf).filter((node): node is PlotNode => node !== null);
        const id = nextPlotNodeId(existing);
        const node = createPlotNode(kind, position?.x ?? 140, position?.y ?? 120, id);
        setNodes((previous) => [...previous, toFlowNode(node)]);
        setSelectedId(id);
    }

    /**
     * 双击空白处新建节点
     * @param event 鼠标事件
     */
    function handleDoubleClick(event: React.MouseEvent): void {
        const target = event.target as HTMLElement;
        if (!target.classList.contains('react-flow__pane')) {
            return;
        }
        const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
        addNode('turn', { x: position.x - 120, y: position.y - 40 });
    }

    const handleConnect = useCallback(
        (connection: Connection) => {
            setEdges((previous) =>
                addEdge(
                    {
                        ...connection,
                        id: `e-${connection.source}-${connection.target}-${Date.now()}`,
                        type: 'default',
                        animated: true,
                        label: '',
                        data: { kind: 'cause' as PlotEdgeKind },
                        style: { stroke: 'rgb(var(--jade-500))', strokeWidth: 1.6 },
                    },
                    previous,
                ),
            );
        },
        [setEdges],
    );

    /**
     * 更新选中节点的字段
     * @param patch 要改的字段
     */
    function updateSelected(patch: Partial<PlotNode>): void {
        if (!selectedId) {
            return;
        }
        setNodes((previous) =>
            previous.map((node) => {
                if (node.id !== selectedId) {
                    return node;
                }
                const current = payloadOf(node);
                if (!current) {
                    return node;
                }
                return {
                    ...node,
                    data: { ...node.data, node: { ...current, ...patch } } as Record<string, unknown>,
                };
            }),
        );
    }

    /**
     * 删除选中节点
     */
    function deleteSelected(): void {
        if (!selectedId) {
            return;
        }
        setNodes((previous) => previous.filter((node) => node.id !== selectedId));
        setEdges((previous) =>
            previous.filter((edge) => edge.source !== selectedId && edge.target !== selectedId),
        );
        setSelectedId(null);
    }

    /**
     * 跑一次 AI 结构诊断
     */
    async function runDiagnosis(): Promise<void> {
        if (!book || !settings) {
            pushToast('info', '先配置模型');
            return;
        }
        const graph = toGraph(nodes, edges);
        if (graph.nodes.length < 2) {
            pushToast('info', '至少放两个节点再诊断');
            return;
        }

        setDiagnosing(true);
        setDiagnosis(null);
        setRawOutput('');
        const requestId = crypto.randomUUID();
        let buffer = '';

        window.api.llm.onStream((event) => {
            if (event.requestId !== requestId) {
                return;
            }
            if (event.type === 'chunk' && event.delta) {
                buffer += event.delta;
            }
            if (event.type === 'done') {
                window.api.llm.offStream();
                setDiagnosing(false);
                finishDiagnosis(buffer, graph);
            }
            if (event.type === 'error') {
                window.api.llm.offStream();
                setDiagnosing(false);
                pushToast('error', event.message ?? '诊断失败');
            }
        });

        try {
            const result = await window.api.llm.chat({
                requestId,
                providerId: settings.provider.id,
                model: settings.provider.model,
                messages: [
                    {
                        role: 'system',
                        content: isNovel ? PLOT_SYSTEM_PROMPT : CANVAS_SYSTEM_PROMPT,
                    },
                    { role: 'user', content: buildCanvasUserPrompt(graph, isNovel) },
                ],
                temperature: 0.3,
                maxTokens: 1600,
                purpose: 'plot-diagnosis',
            });
            if (!result.accepted) {
                window.api.llm.offStream();
                setDiagnosing(false);
                pushToast('error', result.message ?? '请求被拒绝');
            }
        } catch (error) {
            window.api.llm.offStream();
            setDiagnosing(false);
            pushToast('error', errorMessage(error));
        }
    }

    /**
     * 解析诊断结果并标到节点上
     * @param raw 模型输出
     * @param graph 诊断时的图
     */
    function finishDiagnosis(raw: string, graph: PlotGraph): void {
        const parsed = parsePlotDiagnosis(
            raw,
            graph.nodes.map((node) => node.id),
        );
        if (!parsed) {
            setRawOutput(raw);
            pushToast('error', '模型输出不是预期格式，已保留原文');
            return;
        }
        setDiagnosis(parsed);
        if (parsed.dropped > 0) {
            pushToast('info', `有 ${parsed.dropped} 条结论因引用不到节点被丢弃`);
        }
        // 把问题标到节点上，画布上直接能看到
        setNodes((previous) =>
            previous.map((node) => {
                const hit = parsed.findings.find((finding) => finding.nodeIds.includes(node.id));
                return {
                    ...node,
                    data: {
                        ...node.data,
                        issue: hit ? (hit.severity === 'error' ? 'error' : 'warn') : undefined,
                    },
                };
            }),
        );
    }

    /**
     * AI 画思维导图：用当前文档内容生成大纲，布局后铺到画布上
     * 铺上去就是普通节点，随便拖、连线、改字
     */
    async function runDrawMindmap(): Promise<void> {
        if (!book || !settings) {
            pushToast('info', '先配置模型');
            return;
        }
        const source = content.trim();
        if (source.length === 0) {
            pushToast('info', '先在正文写点东西，或到「图表」工具里按主题生成');
            return;
        }

        setDrawing(true);
        const requestId = crypto.randomUUID();
        let buffer = '';

        window.api.llm.onStream((event) => {
            if (event.requestId !== requestId) {
                return;
            }
            if (event.type === 'chunk' && event.delta) {
                buffer += event.delta;
            }
            if (event.type === 'done') {
                window.api.llm.offStream();
                setDrawing(false);
                finishDrawMindmap(buffer);
            }
            if (event.type === 'error') {
                window.api.llm.offStream();
                setDrawing(false);
                pushToast('error', event.message ?? '生成失败');
            }
        });

        try {
            const result = await window.api.llm.chat({
                requestId,
                providerId: settings.provider.id,
                model: settings.provider.model,
                messages: [
                    {
                        role: 'system',
                        content:
                            '你是思维导图助手。输出思维导图大纲：Markdown 无序列表，两个空格缩进表示层级，每行以「- 」开头。只输出列表本身，不要解释。',
                    },
                    {
                        role: 'user',
                        content: `把下面的内容整理成结构清晰的思维导图，抓住主干，层级不超过 4 级：\n\n${source.slice(0, 4000)}`,
                    },
                ],
                temperature: 0.3,
                maxTokens: 1200,
                purpose: 'plot-mindmap',
            });
            if (!result.accepted) {
                window.api.llm.offStream();
                setDrawing(false);
                pushToast('error', result.message ?? '请求被拒绝');
            }
        } catch (error) {
            window.api.llm.offStream();
            setDrawing(false);
            pushToast('error', errorMessage(error));
        }
    }

    /**
     * 解析导图大纲并铺到画布上
     * @param raw 模型输出的缩进列表
     */
    function finishDrawMindmap(raw: string): void {
        const roots = parseMindmap(raw);
        if (roots.length === 0) {
            pushToast('error', '模型输出不是大纲格式，没铺成');
            return;
        }
        const layout = layoutMindmap(roots);
        const existing = nodes.map(payloadOf).filter((node): node is PlotNode => node !== null);
        const items = layoutToPlotItems(layout, existing, primaryKind, 'parallel');
        setNodes((previous) => [...previous, ...items.nodes.map(toFlowNode)]);
        setEdges((previous) => [...previous, ...items.edges.map(toFlowEdge)]);
        skipNextSave.current = false;
        pushToast('success', `导图已铺上画布：${items.nodes.length} 个节点，拖动即可排版`);
    }

    /**
     * 相机飞到某个节点
     * @param id 节点 id
     */
    function focusNode(id: string): void {
        const node = nodes.find((item) => item.id === id);
        if (!node) {
            return;
        }
        setCenter(node.position.x + 120, node.position.y + 70, { zoom: 1.1, duration: 600 });
        setSelectedId(id);
    }

    if (!book) {
        return <main className="flex flex-1 items-center justify-center text-sm text-ink-500">先打开一本书</main>;
    }

    return (
        <main className="flex min-w-0 flex-1 flex-col bg-ink-950">
            {/* 顶部工具栏 */}
            <div className="flex h-11 shrink-0 items-center justify-between border-b border-ink-800 bg-ink-900 px-4">
                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        className="flex items-center gap-1 rounded-md border border-ink-700 px-1.5 py-0.5 text-ink-300 hover:border-jade-600 hover:text-jade-400"
                        onClick={() => setActiveView('chapter')}
                    >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M15 18l-6-6 6-6" />
                        </svg>
                        <span className="text-[13px]">正文</span>
                    </button>
                    <h2 className="text-[14px] font-medium text-ink-100">
                        {isNovel ? '剧情编排' : '画板'}
                    </h2>
                    <span className="text-[13px] text-ink-500">
                        {nodes.length} 个节点 · {edges.length} 条关系
                    </span>
                </div>

                <div className="flex items-center gap-1.5">
                    <button
                        type="button"
                        className="btn-outline text-[13px]"
                        onClick={() => addNode(primaryKind)}
                    >
                        + {isNovel ? '剧情' : '想法'}
                    </button>
                    <button
                        type="button"
                        className="btn-outline text-[13px]"
                        onClick={() => addNode(secondaryKind)}
                    >
                        + {isNovel ? '伏笔' : '待办'}
                    </button>
                    <button
                        type="button"
                        className="btn-outline text-[13px]"
                        onClick={() => void runDrawMindmap()}
                        disabled={drawing}
                        title="把当前文档整理成思维导图，直接铺上画布"
                    >
                        {drawing ? '画图中…' : 'AI 画导图'}
                    </button>
                    <button
                        type="button"
                        className="btn-primary text-[13px]"
                        onClick={() => void runDiagnosis()}
                        disabled={diagnosing}
                    >
                        {diagnosing ? '分析中…' : 'AI 诊断'}
                    </button>
                </div>
            </div>

            <div className="relative min-h-0 flex-1" onDoubleClick={handleDoubleClick}>
                <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={handleConnect}
                    defaultEdgeOptions={{ type: 'default' }}
                    onNodeClick={(_event, node) => setSelectedId(node.id)}
                    onPaneClick={() => setSelectedId(null)}
                    nodeTypes={NODE_TYPES}
                    fitView
                    minZoom={0.3}
                    maxZoom={1.8}
                    proOptions={{ hideAttribution: true }}
                >
                    <Background color="rgb(var(--ink-700))" gap={18} size={1.4} />
                    <Controls showInteractive={false} position="bottom-left" />
                </ReactFlow>

                {nodes.length === 0 && (
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1">
                        <p className="text-[14px] text-ink-400">
                            双击空白处新建{isNovel ? '剧情节点' : '卡片'}
                        </p>
                        <p className="text-[13px] text-ink-500">从卡片边缘的圆点拖出可以连线</p>
                    </div>
                )}

                {/* 右侧面板 */}
                {(selected || diagnosis || rawOutput) && (
                    <div className="absolute right-3 top-3 bottom-3 w-72 overflow-y-auto rounded-lg border border-ink-800 bg-ink-900/95 p-3 shadow-lg backdrop-blur">
                        {selected ? (
                            <NodeEditor
                                node={selected}
                                kinds={kinds}
                                isNovel={isNovel}
                                properNouns={properNouns}
                                onChange={updateSelected}
                                onDelete={deleteSelected}
                                onClose={() => setSelectedId(null)}
                            />
                        ) : null}

                        {diagnosis ? (
                            <DiagnosisPanel
                                diagnosis={diagnosis}
                                onFocus={focusNode}
                                onClose={() => {
                                    setDiagnosis(null);
                                    setNodes((previous) =>
                                        previous.map((node) => ({
                                            ...node,
                                            data: { ...node.data, issue: undefined },
                                        })),
                                    );
                                }}
                            />
                        ) : null}

                        {!diagnosis && rawOutput ? (
                            <div className="mt-2">
                                <p className="text-[13px] text-amber-500">模型没有按格式输出，原文：</p>
                                <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded bg-ink-850 p-2 text-[12px] text-ink-400">
                                    {rawOutput}
                                </pre>
                            </div>
                        ) : null}
                    </div>
                )}
            </div>
        </main>
    );
}

/** 节点编辑面板属性 */
interface NodeEditorProps {
    node: PlotNode;
    /** 当前项目类型可用的节点类型 */
    kinds: ReturnType<typeof plotKindsFor>;
    isNovel: boolean;
    properNouns: string[];
    onChange: (patch: Partial<PlotNode>) => void;
    onDelete: () => void;
    onClose: () => void;
}

/**
 * 右侧节点编辑面板
 */
function NodeEditor({
    node,
    kinds,
    isNovel,
    properNouns,
    onChange,
    onDelete,
    onClose,
}: NodeEditorProps) {
    return (
        <div className="space-y-2.5">
            <div className="flex items-center justify-between">
                <span className="text-[13px] text-ink-400">节点 {node.id}</span>
                <button type="button" className="text-[13px] text-ink-500 hover:text-ink-200" onClick={onClose}>
                    收起
                </button>
            </div>

            <div className="grid grid-cols-5 gap-1">
                {kinds.map((item) => (
                    <button
                        type="button"
                        key={item.kind}
                        onClick={() => onChange({ kind: item.kind })}
                        className={`rounded px-1 py-1 text-[12px] ${
                            node.kind === item.kind ? 'text-white' : 'text-ink-300'
                        }`}
                        style={
                            node.kind === item.kind
                                ? { backgroundColor: item.color }
                                : { backgroundColor: 'rgb(var(--ink-850))' }
                        }
                    >
                        {item.name}
                    </button>
                ))}
            </div>

            <input
                className="field text-[14px]"
                placeholder="标题"
                value={node.title}
                onChange={(event) => onChange({ title: event.target.value })}
            />

            <textarea
                className="field h-24 resize-none text-[13px] leading-relaxed"
                placeholder="这场戏发生了什么"
                value={node.summary}
                onChange={(event) => onChange({ summary: event.target.value })}
            />

            <div>
                <p className="label mb-1">{isNovel ? '人物（逗号分隔）' : '关联（逗号分隔）'}</p>
                <input
                    className="field text-[13px]"
                    placeholder={properNouns.slice(0, 3).join('、') || (isNovel ? '角色名' : '标签、负责人')}
                    value={node.characters.join('、')}
                    onChange={(event) =>
                        onChange({
                            characters: event.target.value
                                .split(/[、,，\s]+/)
                                .map((name) => name.trim())
                                .filter((name) => name.length > 0),
                        })
                    }
                />
            </div>

            {isNovel && (
                <div>
                    <p className="label mb-1">绑定章节</p>
                    <input
                        className="field text-[13px]"
                        type="number"
                        min={1}
                        placeholder="不绑就留空"
                        value={node.chapter ?? ''}
                        onChange={(event) =>
                            onChange({
                                chapter: event.target.value ? Number(event.target.value) : undefined,
                            })
                        }
                    />
                </div>
            )}

            <button
                type="button"
                className="w-full rounded-md border border-red-500/40 py-1.5 text-[13px] text-red-500 hover:bg-red-500/10"
                onClick={onDelete}
            >
                删除这个节点
            </button>
        </div>
    );
}

/** 诊断面板属性 */
interface DiagnosisPanelProps {
    diagnosis: PlotDiagnosis;
    onFocus: (id: string) => void;
    onClose: () => void;
}

/**
 * AI 诊断结果面板
 */
function DiagnosisPanel({ diagnosis, onFocus, onClose }: DiagnosisPanelProps) {
    const tone =
        diagnosis.structureScore >= 80
            ? 'text-jade-500'
            : diagnosis.structureScore >= 60
              ? 'text-amber-500'
              : 'text-red-500';

    return (
        <div className="mt-2 space-y-2">
            <div className="flex items-center justify-between border-t border-ink-800 pt-2">
                <div className="flex items-baseline gap-1.5">
                    <span className="text-[13px] text-ink-400">结构评分</span>
                    <span className={`text-[20px] font-semibold ${tone}`}>
                        {diagnosis.structureScore}
                    </span>
                </div>
                <button type="button" className="text-[13px] text-ink-500 hover:text-ink-200" onClick={onClose}>
                    清除
                </button>
            </div>

            {diagnosis.findings.length === 0 && (
                <p className="text-[13px] leading-relaxed text-ink-400">
                    没发现明显的结构问题。如果你觉得不对劲，可以把图再细化一层再看。
                </p>
            )}

            {diagnosis.findings.map((finding, index) => (
                <div
                    key={`${finding.kind}-${index}`}
                    className="rounded-md border border-ink-800 bg-ink-850 p-2"
                >
                    <div className="flex items-center gap-1.5">
                        <span
                            className={`rounded px-1 py-0.5 text-[12px] ${
                                finding.severity === 'error'
                                    ? 'bg-red-500/15 text-red-500'
                                    : 'bg-amber-500/15 text-amber-500'
                            }`}
                        >
                            {FINDING_LABELS[finding.kind] ?? finding.kind}
                        </span>
                        {finding.nodeIds.map((id) => (
                            <button
                                type="button"
                                key={id}
                                onClick={() => onFocus(id)}
                                className="rounded bg-ink-800 px-1 py-0.5 text-[12px] text-jade-500 hover:bg-jade-500/15"
                            >
                                {id}
                            </button>
                        ))}
                    </div>
                    <p className="mt-1 text-[13px] leading-relaxed text-ink-200">{finding.message}</p>
                    {finding.suggestion && (
                        <p className="mt-1 text-[13px] leading-relaxed text-ink-400">
                            建议：{finding.suggestion}
                        </p>
                    )}
                </div>
            ))}
        </div>
    );
}

/**
 * 领域模型转画布节点
 * @param node 剧情节点
 * @returns 画布节点
 */
function toFlowNode(node: PlotNode): Node {
    return {
        id: node.id,
        type: 'plot',
        position: { x: node.x, y: node.y },
        data: { node } as unknown as Record<string, unknown>,
    };
}

/**
 * 领域模型转画布连线
 * @param edge 剧情连线
 * @returns 画布连线
 */
function toFlowEdge(edge: PlotEdge): Edge {
    return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: 'default',
        animated: edge.kind === 'cause',
        label: edge.label,
        data: { kind: edge.kind },
        style: {
            stroke: edge.kind === 'parallel' ? 'rgb(var(--ink-600))' : 'rgb(var(--jade-500))',
            strokeWidth: 1.6,
        },
    };
}

/**
 * 画布状态转领域模型
 * @param nodes 画布节点
 * @param edges 画布连线
 * @returns 剧情图
 */
function toGraph(nodes: Node[], edges: Edge[]): PlotGraph {
    return {
        nodes: nodes
            .map((node) => {
                const payload = payloadOf(node);
                if (!payload) {
                    return null;
                }
                return {
                    ...payload,
                    x: Math.round(node.position.x),
                    y: Math.round(node.position.y),
                };
            })
            .filter((node): node is PlotNode => node !== null),
        edges: edges.map((edge) => ({
            id: edge.id,
            source: edge.source,
            target: edge.target,
            kind: ((edge.data as { kind?: PlotEdgeKind } | undefined)?.kind ?? 'cause') as PlotEdgeKind,
            label: typeof edge.label === 'string' ? edge.label : undefined,
        })),
        updatedAt: new Date().toISOString(),
    };
}


