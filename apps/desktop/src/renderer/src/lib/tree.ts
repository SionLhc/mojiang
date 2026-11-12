/**
 * 目录树的纯函数工具
 */

import type { TreeNode } from '@shared/types';

/**
 * 收集树里所有标签，去重并排序
 * @param nodes 树
 * @returns 标签列表
 */
export function collectTags(nodes: TreeNode[]): string[] {
    const tags = new Set<string>();
    const walk = (list: TreeNode[]): void => {
        for (const node of list) {
            for (const tag of node.chapter?.tags ?? []) {
                tags.add(tag);
            }
            if (node.children) {
                walk(node.children);
            }
        }
    };
    walk(nodes);
    return [...tags].sort((left, right) => left.localeCompare(right, 'zh-CN'));
}

/**
 * 按标签过滤树，父文件夹有命中的子节点时保留
 * @param nodes 树
 * @param tag 标签，空表示不过滤
 * @returns 过滤后的树
 */
export function filterTreeByTag(nodes: TreeNode[], tag: string | null): TreeNode[] {
    if (!tag) {
        return nodes;
    }

    const result: TreeNode[] = [];
    for (const node of nodes) {
        if (node.type === 'file') {
            if (node.chapter?.tags?.includes(tag)) {
                result.push(node);
            }
            continue;
        }
        const children = filterTreeByTag(node.children ?? [], tag);
        if (children.length > 0) {
            result.push({ ...node, children });
        }
    }
    return result;
}

/**
 * 树里所有文件节点
 * @param nodes 树
 * @returns 文件节点
 */
export function flattenFiles(nodes: TreeNode[]): TreeNode[] {
    const files: TreeNode[] = [];
    const walk = (list: TreeNode[]): void => {
        for (const node of list) {
            if (node.type === 'file') {
                files.push(node);
            }
            if (node.children) {
                walk(node.children);
            }
        }
    };
    walk(nodes);
    return files;
}
