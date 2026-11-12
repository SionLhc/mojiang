/**
 * 账本：按主体组织的状态树 + RFC6902 风格的 patch 历史
 * 只实现 add / replace / remove 三种操作，覆盖写作场景足够，也便于人读懂。
 */

import type {
    LedgerConflict,
    LedgerFile,
    LedgerMark,
    LedgerPatchRecord,
    LedgerSubjectState,
    LedgerTree,
} from './types';

/** 正文里标注账本事实的语法，例：[[账本|林胜|realm|开八门第二门]] */
const LEDGER_MARK_PATTERN = /\[\[账本\|([^|\]]+)\|([^|\]]+)\|([^\]]+)\]\]/g;

/**
 * 建一个空账本
 * @returns 空账本
 */
export function createEmptyLedger(): LedgerFile {
    return { tree: {}, history: [] };
}

/**
 * 解析 patch 路径
 * @param path 形如 /林胜/realm
 * @returns 主体名与字段名，路径非法时返回 null
 */
export function parseLedgerPath(path: string): { subject: string; field: string } | null {
    const parts = path
        .split('/')
        .filter((part) => part.length > 0)
        .map((part) => decodeURIComponent(part));
    if (parts.length !== 2) {
        return null;
    }
    return { subject: parts[0], field: parts[1] };
}

/**
 * 组装 patch 路径
 * @param subject 主体名
 * @param field 字段名
 * @returns 路径字符串
 */
export function buildLedgerPath(subject: string, field: string): string {
    return `/${encodeURIComponent(subject)}/${encodeURIComponent(field)}`;
}

/**
 * 把一条 patch 应用到状态树，返回新树（不改原对象，方便撤销）
 * @param tree 原状态树
 * @param record patch 记录
 * @returns 新状态树
 */
export function applyPatch(tree: LedgerTree, record: LedgerPatchRecord): LedgerTree {
    const parsed = parseLedgerPath(record.path);
    if (!parsed) {
        return tree;
    }
    const next: LedgerTree = { ...tree };
    const subjectState: LedgerSubjectState = { ...(tree[parsed.subject] ?? {}) };

    if (record.op === 'remove') {
        delete subjectState[parsed.field];
    } else {
        subjectState[parsed.field] = record.value ?? '';
    }

    if (Object.keys(subjectState).length === 0) {
        delete next[parsed.subject];
    } else {
        next[parsed.subject] = subjectState;
    }
    return next;
}

/**
 * 追加一条变更记录并更新状态树
 * @param ledger 原账本
 * @param record patch 记录
 * @returns 新账本
 */
export function recordPatch(ledger: LedgerFile, record: LedgerPatchRecord): LedgerFile {
    return {
        tree: applyPatch(ledger.tree, record),
        history: [...ledger.history, record],
    };
}

/**
 * 查某个主体的当前状态
 * @param ledger 账本
 * @param subject 主体名
 * @returns 字段表，不存在时为空对象
 */
export function getSubjectState(ledger: LedgerFile, subject: string): LedgerSubjectState {
    return ledger.tree[subject] ?? {};
}

/**
 * 查某个主体某字段的变更历史
 * @param ledger 账本
 * @param subject 主体名
 * @param field 字段名，省略则返回该主体全部历史
 * @returns 记录列表
 */
export function getPatchHistory(
    ledger: LedgerFile,
    subject: string,
    field?: string,
): LedgerPatchRecord[] {
    return ledger.history.filter((record) => {
        const parsed = parseLedgerPath(record.path);
        if (!parsed || parsed.subject !== subject) {
            return false;
        }
        return field === undefined || parsed.field === field;
    });
}

/**
 * 把账本压成给 AI 看的摘要，只保留当前状态和最近变更
 * @param ledger 账本
 * @param recentCount 最近保留几条变更
 * @returns 摘要文本
 */
export function summarizeLedger(ledger: LedgerFile, recentCount: number = 10): string {
    const subjects = Object.keys(ledger.tree);
    if (subjects.length === 0) {
        return '（账本为空）';
    }
    const lines: string[] = [];
    for (const subject of subjects) {
        const state = ledger.tree[subject];
        const pairs = Object.keys(state).map((field) => `${field}=${state[field]}`);
        lines.push(`- ${subject}：${pairs.join('；')}`);
    }
    const recent = ledger.history.slice(-recentCount);
    if (recent.length > 0) {
        lines.push('');
        lines.push(`最近 ${recent.length} 条变更：`);
        for (const record of recent) {
            lines.push(`- 第${record.chapter}章 ${record.op} ${record.path} → ${record.value ?? '（删除）'}`);
        }
    }
    return lines.join('\n');
}

/**
 * 从正文里解析账本标注
 * @param text 正文
 * @returns 标注列表
 */
export function parseLedgerMarks(text: string): LedgerMark[] {
    const marks: LedgerMark[] = [];
    for (const match of text.matchAll(LEDGER_MARK_PATTERN)) {
        const start = match.index ?? 0;
        marks.push({
            subject: match[1].trim(),
            field: match[2].trim(),
            value: match[3].trim(),
            start,
            end: start + match[0].length,
        });
    }
    return marks;
}

/**
 * 冲突检测：正文写的和账本记的不一致就报警，精确到字段
 * @param text 正文
 * @param ledger 账本
 * @returns 冲突列表
 */
export function detectLedgerConflicts(text: string, ledger: LedgerFile): LedgerConflict[] {
    const conflicts: LedgerConflict[] = [];
    for (const mark of parseLedgerMarks(text)) {
        const state = ledger.tree[mark.subject];
        if (!state || state[mark.field] === undefined) {
            continue;
        }
        const recorded = state[mark.field];
        if (recorded !== mark.value) {
            conflicts.push({
                subject: mark.subject,
                field: mark.field,
                written: mark.value,
                recorded,
                start: mark.start,
                end: mark.end,
                message: `${mark.subject} 的 ${mark.field}：本章写"${mark.value}"，账本记"${recorded}"`,
            });
        }
    }
    return conflicts;
}

/**
 * 把本章正文里的标注转成待落账的 patch 列表
 * 作者可以选择应用或忽略，不做自动写入
 * @param text 正文
 * @param chapter 章节号
 * @returns patch 记录
 */
export function buildPatchesFromMarks(text: string, chapter: number): LedgerPatchRecord[] {
    const at = new Date().toISOString();
    return parseLedgerMarks(text).map((mark) => ({
        op: 'replace' as const,
        path: buildLedgerPath(mark.subject, mark.field),
        value: mark.value,
        chapter,
        at,
        note: '由正文标注生成',
    }));
}
