/**
 * 工具视图清单
 * 入口在顶栏「工具」菜单（侧栏底部不再放），按项目类型过滤显隐。
 */

import { getProjectFeatures, type ProjectKind } from '@mojiang/core';
import type { WorkspaceView } from '@/store/useAppStore';

/** 一个工具入口 */
export interface ToolView {
    key: WorkspaceView;
    label: string;
    /** 非小说项目用的名字，不填就沿用 label */
    generalLabel?: string;
    feature:
        | 'ledger'
        | 'foreshadow'
        | 'characters'
        | 'golden3'
        | 'writingPackage'
        | 'market'
        | 'plot'
        | 'stats'
        | 'materials'
        | 'sensitive'
        | 'mindboard';
}

/** 全部工具入口，顺序即菜单顺序 */
export const TOOL_VIEWS: ToolView[] = [
    { key: 'plot', label: '剧情编排', generalLabel: '画板', feature: 'plot' },
    { key: 'ledger', label: '账本', feature: 'ledger' },
    { key: 'foreshadow', label: '伏笔', feature: 'foreshadow' },
    { key: 'characters', label: '人设', feature: 'characters' },
    { key: 'golden3', label: '三章诊断', feature: 'golden3' },
    { key: 'package', label: '开写包', feature: 'writingPackage' },
    { key: 'market', label: '市场调研', feature: 'market' },
    { key: 'stats', label: '码字统计', feature: 'stats' },
    { key: 'materials', label: '素材卡片', feature: 'materials' },
    { key: 'sensitive', label: '敏感词', feature: 'sensitive' },
    { key: 'mindboard', label: '导图画板', generalLabel: '导图画板', feature: 'mindboard' },
];

/**
 * 按项目类型筛出可用工具
 * @param kind 项目类型，老数据按小说处理
 * @returns 可用工具列表
 */
export function toolViewsFor(kind: ProjectKind | undefined): ToolView[] {
    const features = getProjectFeatures(kind);
    return TOOL_VIEWS.filter((tool) => features[tool.feature]);
}
