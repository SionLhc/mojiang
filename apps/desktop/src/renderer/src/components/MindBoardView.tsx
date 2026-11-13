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
    layoutMindmap,
    layoutToMindBoard,
    mindDepthColor,
    nextMindBoardNodeId,
    parseMindmap,
    type MindBoardEdge,
    type MindBoardGraph,
    type MindBoardNode,
} from '@mojiang/core';
import MindNodeCard, { type MindNodePayload } from '@/components/MindNodeCard';
import { errorMessage } from '@/lib/format';
import { useAppStore } from '@/store/useAppStore';

/** 节点组件映射，必须定义在组件外，否则每次渲染都会重建 */
const NODE_TYPES = { mind: MindNodeCard };

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
 * 思维导图画板
 * 独立于剧情画板：这里只放思维导图/流程图节点，按层级着色，可以自动排版。
 * 数据存在书里的 导图.json，和剧情.json 互不干扰。
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
    const content = useAppStore((state) => state.content);
    const settings = useAppStore((state) => state.settings);
    const pushToast = useAppStore((state) => state.pushToast);

    const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const [loaded, setLoaded] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
    const [drawing, setDrawing] = useState(false);
    const [aiTopic, setAiTopic] = useState('');

    const { screenToFlowPosition, setCenter } = useReactFlow();
    const skipNextSave = useRef(true);

    // 载入已有导图画板
    useEffect(() => {
        if (!book) {
            return;
        }
        void (async () => {
            try {
                const graph = await window.api.mindboard.read(book.id);
                setNodes(graph.nodes.map((node) => toFlowNode(node)));
                setEdges(graph.edges.map((edge) => toFlowEdge(edge)));
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
     * AI 画思维导图：主题或当前正文 → 大纲 → 布局 → 铺上画板
     * 铺上去就是普通节点，随便拖、连线、改字
     */
    async function runDrawMindmap(): Promise<void> {
        if (!book || !settings) {
            pushToast('info', '先配置模型');
            return;
        }
        const topic = aiTopic.trim();
        const source = topic.length > 0 ? topic : content.trim();
        if (source.length === 0) {
            pushToast('info', '写个主题，或先在正文写点东西');
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
            const userPrompt =
                topic.length > 0
                    ? `围绕「${topic}」整理一份结构清晰的思维导图，层级不超过 4 级`
                    : `把下面的内容整理成结构清晰的思维导图，抓住主干，层级不超过 4 级：\n\n${content.slice(0, 4000)}`;
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
                    { role: 'user', content: userPrompt },
                ],
                temperature: 0.3,
                maxTokens: 1200,
                purpose: 'mindboard-draw',
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
     * 解析导图大纲并铺到画板上
     * @param raw 模型输出的缩进列表
     */
    function finishDrawMindmap(raw: string): void {
        const roots = parseMindmap(raw);
        if (roots.length === 0) {
            pushToast('error', '模型输出不是大纲格式，没铺成');
            return;
        }
        const layout = layoutMindmap(roots);
        const existing = nodes.map(payloadOf).filter((node): node is MindBoardNode => node !== null);
        // 多次铺入时整体右移，避开已有节点
        const maxRight = existing.reduce((max, node) => Math.max(max, node.x + 220), 0);
        const offset = existing.length > 0 ? { x: maxRight + 80, y: 0 } : { x: 0, y: 0 };
        const items = layoutToMindBoard(layout, existing, offset);
        setNodes((previous) => [...previous, ...items.nodes.map(toFlowNode)]);
        setEdges((previous) => [...previous, ...items.edges.map(toFlowEdge)]);
        skipNextSave.current = false;
        pushToast('success', `导图已铺上画板：${items.nodes.length} 个节点，拖动即可排版`);
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
                        className="input h-7 w-44 text-[13px]"
                        placeholder="主题（留空用正文）"
                        value={aiTopic}
                        onChange={(event) => setAiTopic(event.target.value)}
                    />
                    <button
                        type="button"
                        className="btn-outline h-7 text-[13px]"
                        onClick={() => void runDrawMindmap()}
                        disabled={drawing}
                        title="按主题或当前正文生成思维导图，铺上画板"
                    >
                        {drawing ? '画图中…' : 'AI 画导图'}
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
                            className="input mt-2 w-full text-[13px]"
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
                            className="input mt-2 w-full text-[13px]"
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
        </main>
    );
}
