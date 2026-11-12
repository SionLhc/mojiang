import { formatCharCount } from '@/lib/format';
import type { TreeNode } from '@shared/types';

/** 属性 */
interface DocumentTreeProps {
    nodes: TreeNode[];
    activeId: string | null;
    expanded: Record<string, boolean>;
    onToggle: (path: string) => void;
    onOpen: (id: string) => void;
    onRemove: (id: string, title: string) => void;
    /** 缩进层级，内部递归用 */
    depth?: number;
}

/**
 * 递归渲染目录树
 * 文件夹可折叠，文件点击打开，悬停出删除按钮
 */
export default function DocumentTree({
    nodes,
    activeId,
    expanded,
    onToggle,
    onOpen,
    onRemove,
    depth = 0,
}: DocumentTreeProps) {
    if (nodes.length === 0) {
        return null;
    }

    return (
        <ul className={depth === 0 ? 'space-y-0.5' : 'space-y-0.5'}>
            {nodes.map((node) => {
                if (node.type === 'folder') {
                    const isOpen = expanded[node.path] === true;
                    return (
                        <li key={`folder-${node.path}`}>
                            <button
                                type="button"
                                onClick={() => onToggle(node.path)}
                                className="flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-left text-[13px] text-ink-300 hover:bg-ink-800"
                                style={{ paddingLeft: `${depth * 10 + 6}px` }}
                            >
                                <span className="w-3 shrink-0 text-ink-600">{isOpen ? '▾' : '▸'}</span>
                                <span className="truncate">{node.name}</span>
                                <span className="ml-auto shrink-0 text-[13px] text-ink-600">
                                    {(node.children ?? []).length}
                                </span>
                            </button>
                            {isOpen && (
                                <DocumentTree
                                    nodes={node.children ?? []}
                                    activeId={activeId}
                                    expanded={expanded}
                                    onToggle={onToggle}
                                    onOpen={onOpen}
                                    onRemove={onRemove}
                                    depth={depth + 1}
                                />
                            )}
                        </li>
                    );
                }

                const chapter = node.chapter;
                const isActive = activeId === chapter?.id;
                return (
                    <li key={`file-${node.path}`} className="group relative">
                        <button
                            type="button"
                            onClick={() => onOpen(chapter?.id ?? node.path)}
                            className={`flex w-full items-start gap-1 rounded-md py-1 pr-5 text-left ${
                                isActive ? 'bg-jade-500/15 text-jade-400' : 'text-ink-300 hover:bg-ink-800'
                            }`}
                            style={{ paddingLeft: `${depth * 10 + 14}px` }}
                        >
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-[13px]">{chapter?.title ?? node.name}</span>
                                <span className="block text-[13px] text-ink-500">
                                    {chapter ? formatCharCount(chapter.charCount) : ''}
                                    {chapter?.tags && chapter.tags.length > 0
                                        ? ` · ${chapter.tags.join(' ')}`
                                        : ''}
                                </span>
                            </span>
                        </button>
                        <button
                            type="button"
                            title="删除"
                            onClick={() => onRemove(chapter?.id ?? node.path, chapter?.title ?? node.name)}
                            className="absolute right-1 top-1.5 hidden h-5 w-5 items-center justify-center rounded text-ink-500 hover:bg-red-500/20 hover:text-red-400 group-hover:flex"
                        >
                            ×
                        </button>
                    </li>
                );
            })}
        </ul>
    );
}
