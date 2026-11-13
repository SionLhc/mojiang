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
    MIND_DEPTH_COLORS,
    autoArrangeMindBoard,
    createMindBoardNode,
    layoutFlow,
    layoutMindmap,
    layoutToMindBoard,
    mindBoardToOutline,
    mindDepthColor,
    nextMindBoardNodeId,
    parseFlow,
    parseMindmap,
    type DiagramLayout,
    type MindBoardEdge,
    type MindBoardGraph,
    type MindBoardNode,
} from '@mojiang/core';
import MindNodeCard, { type MindNodePayload } from '@/components/MindNodeCard';
import { errorMessage } from '@/lib/format';
import { useAppStore } from '@/store/useAppStore';

/** 节点组件映射，必须定义在组件外，否则每次渲染都会重建 */
const NODE_TYPES = { mind: MindNodeCard };

/** 文本源文件结构，存在书里的 图表.json */
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
 * 从画布节点里取出领域节点
 * React Flow 的 data 是 Record<string, unknown>，统一在这里断言
 * @param node 画布节点
 * @returns 领域节点，取不到返回 null
 */
function payloadOf(node: Node): MindBoardNode | null {
    const payload = node.data as unknown as MindNodePayload;
    return payload && payload.node ? payload.node : null;
}

/**
 * 领域模型转画布节点
 * @param node 导图节点
 * @returns 画布节点
 */
function toFlowNode(node: MindBoardNode): Node {
    return {
        id: node.id,
        type: 'mind',
        position: { x: node.x, y: node.y },
        data: { node } as unknown as Record<string, unknown>,
    };
}

/**
 * 领域模型转画布连线
 * @param edge 导图连线
 * @returns 画布连线
 */
function toFlowEdge(edge: MindBoardEdge): Edge {
    return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: 'default',
        label: edge.label,
        style: { stroke: 'rgb(var(--ink-500))', strokeWidth: 1.6 },
    };
}

/**
 * 画布状态转领域模型
 * @param nodes 画布节点
 * @param edges 画布连线
 * @returns 导图画板
 */
function toGraph(nodes: Node[], edges: Edge[]): MindBoardGraph {
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
            .filter((node): node is MindBoardNode => node !== null),
        edges: edges.map((edge) => ({
            id: edge.id,
            source: edge.source,
            target: edge.target,
            label: typeof edge.label === 'string' ? edge.label : undefined,
        })),
        updatedAt: new Date().toISOString(),
    };
}

/**
 * 思维导图画板：左文本源 + 右画布，一个视图全搞定
 * 左边像写大纲一样写缩进列表/边列表，点「应用到画板」才更新画布（手动应用，不偷偷覆盖排版）；
 * 画布上拖好的位置在下次应用时按同名节点保留；「同步到文本」可以把画板现状写回大纲。
 * 文本存 图表.json，画布存 导图.json，剧情画板（剧情.json）与这里无关。
 */
export default function MindBoardView() {
    return (
        <ReactFlowProvider>
            <MindBoardCanvas />
        </ReactFlowProvider>
    );
}

/**
 * 画布主体，必须放在 ReactFlowProvider 里才能用 useReactFlow
 */
function MindBoardCanvas() {
    const book = useAppStore((state) => state.book);
    const chapterId = useAppStore((state) => state.chapterId);
    const content = useAppStore((state) => state.content);
    const settings = useAppStore((state) => state.settings);
    const pushToast = useAppStore((state) => state.pushToast);

    const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const [loaded, setLoaded] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
    // 文本源：思维导图缩进列表 / 流程图边列表，两个源分开存
    const [mode, setMode] = useState<'mindmap' | 'flow'>('mindmap');
    const [mindmapSource, setMindmapSource] = useState(DEFAULT_MINDMAP.join('\n'));
    const [flowSource, setFlowSource] = useState(DEFAULT_FLOW.join('\n'));
    const [aiTopic, setAiTopic] = useState('');
    const [generating, setGenerating] = useState(false);

    const { screenToFlowPosition, setCenter } = useReactFlow();
    const skipNextSave = useRef(true);

    // 载入已有导图画板 + 文本源
    useEffect(() => {
        if (!book) {
            return;
        }
        void (async () => {
            try {
                const [graph, diagram] = await Promise.all([
                    window.api.mindboard.read(book.id),
                    window.api.file.readJson<DiagramFile>(book.id, '图表.json', {
                        mode: 'mindmap',
                        mindmapSource: DEFAULT_MINDMAP.join('\n'),
                        flowSource: DEFAULT_FLOW.join('\n'),
                    }),
                ]);
                setNodes(graph.nodes.map((node) => toFlowNode(node)));
                setEdges(graph.edges.map((edge) => toFlowEdge(edge)));
                setMode(diagram.mode === 'flow' ? 'flow' : 'mindmap');
                setMindmapSource(diagram.mindmapSource || DEFAULT_MINDMAP.join('\n'));
                setFlowSource(diagram.flowSource || DEFAULT_FLOW.join('\n'));
                skipNextSave.current = true;
                setLoaded(true);
            } catch (error) {
                pushToast('error', errorMessage(error));
            }
        })();
    }, [book, setNodes, setEdges, pushToast]);

    const selectedNode = useMemo(() => {
        const target = nodes.find((node) => node.id === selectedId);
        return target ? payloadOf(target) : null;
    }, [nodes, selectedId]);

    const selectedEdge = useMemo(
        () => edges.find((edge) => edge.id === selectedEdgeId) ?? null,
        [edges, selectedEdgeId],
    );

    /** 当前模式下的源文本 */
    const source = mode === 'mindmap' ? mindmapSource : flowSource;

    // 位置、连线、文字变化都进签名，任何改动都要存盘
    const signature = useMemo(
        () =>
            nodes
                .map((node) => {
                    const payload = payloadOf(node);
                    const title = payload ? payload.title : '';
                    return `${node.id}@${Math.round(node.position.x)},${Math.round(node.position.y)}:${title}`;
                })
                .join('|') +
            '#' +
            edges.map((edge) => `${edge.source}>${edge.target}:${String(edge.label ?? '')}`).join('|'),
        [nodes, edges],
    );

    // 坐标或内容变化后防抖存盘
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
            void window.api.mindboard.write(book.id, graph).catch((error: unknown) => {
                pushToast('error', `保存失败：${errorMessage(error)}`);
            });
        }, 700);
        return () => window.clearTimeout(timer);
    }, [signature, loaded, book, nodes, edges, pushToast]);

    /**
     * 文本源落盘（模式切换、改文本都存）
     * @param nextMode 当前模式
     * @param nextMindmap 思维导图源
     * @param nextFlow 流程图源
     */
    async function persistDiagram(
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
            pushToast('error', `存文本源失败：${errorMessage(error)}`);
        }
    }

    /**
     * 改源文本并存盘
     * @param text 新源文本
     */
    function updateSource(text: string): void {
        if (mode === 'mindmap') {
            setMindmapSource(text);
            void persistDiagram(mode, text, flowSource);
        } else {
            setFlowSource(text);
            void persistDiagram(mode, mindmapSource, text);
        }
    }

    /**
     * 按当前文本解析出布局（应用到画板用）
     * @returns 布局结果，解析不出返回 null
     */
    function parseCurrentLayout(): DiagramLayout | null {
        if (mode === 'mindmap') {
            const roots = parseMindmap(mindmapSource);
            return roots.length > 0 ? layoutMindmap(roots) : null;
        }
        const graph = parseFlow(flowSource);
        return graph.nodes.length > 0 ? layoutFlow(graph) : null;
    }

    /**
     * 应用到画板：文本 → 画布结构（手动应用，点了才更新）
     * 同名节点沿用画布上拖过的位置，文本只负责节点和连线的结构
     */
    function applyToBoard(): void {
        const layout = parseCurrentLayout();
        if (!layout) {
            pushToast('error', '文本是空的或格式不对，先写点内容');
            return;
        }
        // 记下同名节点的旧位置，手动排版不被覆盖
        const positionOf = new Map<string, { x: number; y: number }>();
        for (const node of nodes.map(payloadOf)) {
            if (node && !positionOf.has(node.title)) {
                positionOf.set(node.title, { x: node.x, y: node.y });
            }
        }
        const items = layoutToMindBoard(layout, [], { x: 0, y: 0 });
        const merged = items.nodes.map((node) => {
            const old = positionOf.get(node.title);
            return old ? { ...node, x: old.x, y: old.y } : node;
        });
        setNodes(merged.map(toFlowNode));
        setEdges(items.edges.map(toFlowEdge));
        skipNextSave.current = false;
        pushToast('success', `画板已按文本更新：${merged.length} 个节点，同名节点保留原位置`);
    }

    /**
     * 同步到文本：画布现状 → 文本源（画板 → 文本，和应用反向）
     */
    function syncToText(): void {
        const text = mindBoardToOutline(toGraph(nodes, edges), mode);
        if (mode === 'mindmap') {
            setMindmapSource(text);
            void persistDiagram('mindmap', text, flowSource);
        } else {
            setFlowSource(text);
            void persistDiagram('flow', mindmapSource, text);
        }
        pushToast('success', '画板已写回文本源');
    }

    /**
     * 让 AI 按当前模式的格式生成文本源
     * 素材：用户填的主题，或者当前打开的文档；生成先填文本，点「应用到画板」才上画布
     */
    async function generateWithAi(): Promise<void> {
        if (!settings) {
            pushToast('info', '先配置模型');
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
                purpose: 'mindboard-draw',
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
            const finalText = buffer || source;
            if (mode === 'mindmap') {
                setMindmapSource(finalText);
                void persistDiagram(mode, finalText, flowSource);
            } else {
                setFlowSource(finalText);
                void persistDiagram(mode, mindmapSource, finalText);
            }
        }
    }

    /**
     * 新增节点
     * @param position 画布坐标
     */
    function addNode(position?: { x: number; y: number }): void {
        const existing = nodes.map(payloadOf).filter((node): node is MindBoardNode => node !== null);
        const id = nextMindBoardNodeId(existing);
        const node = createMindBoardNode('新节点', position?.x ?? 140, position?.y ?? 120, 0, id);
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
        addNode({ x: position.x - 80, y: position.y - 30 });
    }

    const handleConnect = useCallback(
        (connection: Connection) => {
            setEdges((previous) =>
                addEdge(
                    {
                        ...connection,
                        id: `e-${connection.source}-${connection.target}-${Date.now()}`,
                        type: 'default',
                        style: { stroke: 'rgb(var(--ink-500))', strokeWidth: 1.6 },
                    },
                    previous,
                ),
            );
        },
        [setEdges],
    );

    /**
     * 改节点字段（标题、层级）
     * @param id 节点 id
     * @param patch 要改的字段
     */
    function patchNode(id: string, patch: Partial<MindBoardNode>): void {
        setNodes((previous) =>
            previous.map((node) => {
                if (node.id !== id) {
                    return node;
                }
                const payload = node.data as unknown as MindNodePayload;
                return {
                    ...node,
                    data: { ...payload, node: { ...payload.node, ...patch } },
                };
            }),
        );
    }

    /**
     * 改连线文字
     * @param id 连线 id
     * @param label 连线文字
     */
    function patchEdgeLabel(id: string, label: string): void {
        setEdges((previous) =>
            previous.map((edge) => (edge.id === id ? { ...edge, label } : edge)),
        );
    }

    /**
     * 删除选中的节点或连线；删节点时顺带删掉它的连线
     */
    function deleteSelected(): void {
        if (selectedId) {
            setNodes((previous) => previous.filter((node) => node.id !== selectedId));
            setEdges((previous) =>
                previous.filter((edge) => edge.source !== selectedId && edge.target !== selectedId),
            );
            setSelectedId(null);
            return;
        }
        if (selectedEdgeId) {
            setEdges((previous) => previous.filter((edge) => edge.id !== selectedEdgeId));
            setSelectedEdgeId(null);
        }
    }

    /**
     * 自动排版：树形展开，同层等距
     */
    function handleAutoArrange(): void {
        const graph = toGraph(nodes, edges);
        const arranged = autoArrangeMindBoard(graph);
        setNodes(arranged.nodes.map((node) => toFlowNode(node)));
        setEdges(arranged.edges.map((edge) => toFlowEdge(edge)));
        skipNextSave.current = false;
        pushToast('success', '已自动排版');
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
        setCenter(node.position.x + 100, node.position.y + 50, { zoom: 1.1, duration: 600 });
        setSelectedId(id);
    }

    if (!book) {
        return (
            <main className="flex flex-1 items-center justify-center text-sm text-ink-500">先打开一本书</main>
        );
    }

    return (
        <main className="flex min-w-0 flex-1 flex-col bg-ink-950">
            {/* 顶部工具栏 */}
            <div className="flex h-11 shrink-0 items-center justify-between border-b border-ink-800 bg-ink-900 px-4">
                <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-ink-100">导图画板</span>
                    <span className="text-[12px] text-ink-500">{nodes.length} 个节点</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <input
                        className="field h-7 w-44 text-[13px]"
                        placeholder="AI 主题，留空则用当前文档"
                        value={aiTopic}
                        onChange={(event) => setAiTopic(event.target.value)}
                    />
                    <button
                        type="button"
                        className="btn-primary h-7 text-[13px]"
                        onClick={() => void generateWithAi()}
                        disabled={generating}
                        title="按主题或当前文档生成文本源，点「应用到画板」后才上画布"
                    >
                        {generating ? '生成中…' : 'AI 帮我画'}
                    </button>
                    <button
                        type="button"
                        className="btn-outline h-7 text-[13px]"
                        onClick={handleAutoArrange}
                        title="树形自动排版，同层等距"
                    >
                        自动排版
                    </button>
                    <button
                        type="button"
                        className="btn-outline h-7 text-[13px]"
                        onClick={() => addNode()}
                    >
                        + 节点
                    </button>
                    <button
                        type="button"
                        className="btn-outline h-7 text-[13px]"
                        onClick={deleteSelected}
                        disabled={!selectedId && !selectedEdgeId}
                    >
                        删除选中
                    </button>
                </div>
            </div>

            <div className="flex min-h-0 flex-1 overflow-hidden">
                {/* 左：文本源 */}
                <div className="flex w-80 shrink-0 flex-col border-r border-ink-800">
                    <div className="flex items-center gap-1.5 px-3 pt-2">
                        {(['mindmap', 'flow'] as const).map((item) => (
                            <button
                                key={item}
                                type="button"
                                className={
                                    mode === item
                                        ? 'btn-outline h-7 text-[13px] text-jade-400'
                                        : 'btn-ghost h-7 text-[13px]'
                                }
                                onClick={() => {
                                    setMode(item);
                                    void persistDiagram(item, mindmapSource, flowSource);
                                }}
                            >
                                {item === 'mindmap' ? '思维导图' : '流程图'}
                            </button>
                        ))}
                    </div>
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
                    {/* 文本 ↔ 画板同步按钮，手动应用不自动覆盖 */}
                    <div className="flex gap-1.5 border-t border-ink-800 p-2">
                        <button
                            type="button"
                            className="btn-primary h-7 flex-1 text-[13px]"
                            onClick={applyToBoard}
                            title="按左边文本重建画板结构；同名节点保留你拖过的位置"
                        >
                            应用到画板
                        </button>
                        <button
                            type="button"
                            className="btn-outline h-7 flex-1 text-[13px]"
                            onClick={syncToText}
                            title="把画板现状（含手动加的节点）写回左边文本"
                        >
                            同步到文本
                        </button>
                    </div>
                </div>

                {/* 右：画布 */}
                <div className="relative min-h-0 flex-1" onDoubleClick={handleDoubleClick}>
                    <ReactFlow
                        nodes={nodes}
                        edges={edges}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        onConnect={handleConnect}
                        defaultEdgeOptions={{ type: 'default' }}
                        onNodeClick={(_event, node) => {
                            setSelectedId(node.id);
                            setSelectedEdgeId(null);
                        }}
                        onEdgeClick={(_event, edge) => {
                            setSelectedEdgeId(edge.id);
                            setSelectedId(null);
                        }}
                        onPaneClick={() => {
                            setSelectedId(null);
                            setSelectedEdgeId(null);
                        }}
                        nodeTypes={NODE_TYPES}
                        fitView
                        minZoom={0.3}
                        maxZoom={1.8}
                        proOptions={{ hideAttribution: true }}
                    >
                        <Background color="rgb(var(--ink-700))" gap={18} size={1.4} />
                        <Controls showInteractive={false} position="bottom-left" />
                    </ReactFlow>

                    {/* 选中节点/连线的编辑面板 */}
                    {selectedNode && (
                        <div className="absolute right-3 top-3 w-60 rounded-lg border border-ink-800 bg-ink-900 p-3 shadow-lg">
                            <p className="text-[12px] font-medium text-ink-400">节点编辑</p>
                            <input
                                className="field mt-2 w-full text-[13px]"
                                value={selectedNode.title}
                                onChange={(event) => patchNode(selectedNode.id, { title: event.target.value })}
                            />
                            <div className="mt-2 flex items-center justify-between">
                                <span className="text-[12px] text-ink-400">层级</span>
                                <div className="flex items-center gap-1.5">
                                    <button
                                        type="button"
                                        className="btn-outline h-6 px-2 text-[12px]"
                                        onClick={() =>
                                            patchNode(selectedNode.id, {
                                                depth: Math.max(0, selectedNode.depth - 1),
                                            })
                                        }
                                    >
                                        −
                                    </button>
                                    <span
                                        className="rounded px-1.5 py-0.5 text-[12px] font-medium text-white"
                                        style={{ backgroundColor: mindDepthColor(selectedNode.depth) }}
                                    >
                                        {selectedNode.depth === 0 ? '主题' : `L${selectedNode.depth}`}
                                    </span>
                                    <button
                                        type="button"
                                        className="btn-outline h-6 px-2 text-[12px]"
                                        onClick={() =>
                                            patchNode(selectedNode.id, {
                                                depth: Math.min(
                                                    MIND_DEPTH_COLORS.length - 1,
                                                    selectedNode.depth + 1,
                                                ),
                                            })
                                        }
                                    >
                                        +
                                    </button>
                                </div>
                            </div>
                            <button
                                type="button"
                                className="btn-outline mt-2 w-full text-[12px]"
                                onClick={() => focusNode(selectedNode.id)}
                            >
                                定位
                            </button>
                            <button
                                type="button"
                                className="btn-outline mt-1.5 w-full text-[12px] text-red-400"
                                onClick={deleteSelected}
                            >
                                删除节点
                            </button>
                        </div>
                    )}

                    {selectedEdge && !selectedNode && (
                        <div className="absolute right-3 top-3 w-60 rounded-lg border border-ink-800 bg-ink-900 p-3 shadow-lg">
                            <p className="text-[12px] font-medium text-ink-400">连线编辑</p>
                            <input
                                className="field mt-2 w-full text-[13px]"
                                placeholder="连线文字，如「是/否」"
                                value={typeof selectedEdge.label === 'string' ? selectedEdge.label : ''}
                                onChange={(event) => patchEdgeLabel(selectedEdge.id, event.target.value)}
                            />
                            <button
                                type="button"
                                className="btn-outline mt-2 w-full text-[12px] text-red-400"
                                onClick={deleteSelected}
                            >
                                删除连线
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </main>
    );
}
