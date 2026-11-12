/**
 * 行级 diff
 * 用最长公共子序列（LCS）。一章正文通常一百多行，DP 表完全扛得住。
 * 不做字符级 diff：写作场景看的是"哪几句被改了"，行级已经够用。
 */

/** 一行差异的类型 */
export type DiffKind = 'same' | 'add' | 'remove';

/** 差异中的一行 */
export interface DiffLine {
    kind: DiffKind;
    /** 旧版本行号，从 1 开始；新增行为 null */
    leftLine: number | null;
    /** 新版本行号，从 1 开始；删除行为 null */
    rightLine: number | null;
    text: string;
}

/** 差异统计 */
export interface DiffSummary {
    added: number;
    removed: number;
    unchanged: number;
}

/** DP 表上限：超过就退化成"整段替换"，避免卡死界面 */
const MAX_CELLS = 4_000_000;

/**
 * 比较两个版本的行差异
 * @param before 旧文本
 * @param after 新文本
 * @returns 按顺序排列的差异行
 */
export function diffLines(before: string, after: string): DiffLine[] {
    const left = before.split('\n');
    const right = after.split('\n');

    // 文本太大时退化为全删全加，宁可粗糙也不能卡死
    if (left.length * right.length > MAX_CELLS) {
        return [
            ...left.map((text, index) => ({
                kind: 'remove' as const,
                leftLine: index + 1,
                rightLine: null,
                text,
            })),
            ...right.map((text, index) => ({
                kind: 'add' as const,
                leftLine: null,
                rightLine: index + 1,
                text,
            })),
        ];
    }

    // dp[i][j] = left[i..] 与 right[j..] 的最长公共子序列长度
    const rows = left.length + 1;
    const cols = right.length + 1;
    const dp: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

    for (let i = left.length - 1; i >= 0; i -= 1) {
        for (let j = right.length - 1; j >= 0; j -= 1) {
            dp[i][j] =
                left[i] === right[j]
                    ? dp[i + 1][j + 1] + 1
                    : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }

    const result: DiffLine[] = [];
    let i = 0;
    let j = 0;

    while (i < left.length && j < right.length) {
        if (left[i] === right[j]) {
            result.push({ kind: 'same', leftLine: i + 1, rightLine: j + 1, text: left[i] });
            i += 1;
            j += 1;
        } else if (dp[i + 1][j] >= dp[i][j + 1]) {
            result.push({ kind: 'remove', leftLine: i + 1, rightLine: null, text: left[i] });
            i += 1;
        } else {
            result.push({ kind: 'add', leftLine: null, rightLine: j + 1, text: right[j] });
            j += 1;
        }
    }

    while (i < left.length) {
        result.push({ kind: 'remove', leftLine: i + 1, rightLine: null, text: left[i] });
        i += 1;
    }
    while (j < right.length) {
        result.push({ kind: 'add', leftLine: null, rightLine: j + 1, text: right[j] });
        j += 1;
    }

    return result;
}

/**
 * 统计差异行数
 * @param lines diff 结果
 * @returns 统计
 */
export function summarizeDiff(lines: DiffLine[]): DiffSummary {
    let added = 0;
    let removed = 0;
    let unchanged = 0;
    for (const line of lines) {
        if (line.kind === 'add') {
            added += 1;
        } else if (line.kind === 'remove') {
            removed += 1;
        } else {
            unchanged += 1;
        }
    }
    return { added, removed, unchanged };
}

/**
 * 把 diff 压成"上下文 + 变更"的紧凑视图
 * 相同的行超过 threshold 时用省略标记代替，避免整章铺满屏幕
 * @param lines diff 结果
 * @param context 变更前后各保留几行上下文
 * @returns 紧凑后的条目，null 表示省略
 */
export function compactDiff(lines: DiffLine[], context: number = 3): Array<DiffLine | null> {
    const keep = new Set<number>();

    lines.forEach((line, index) => {
        if (line.kind === 'same') {
            return;
        }
        for (let offset = -context; offset <= context; offset += 1) {
            const target = index + offset;
            if (target >= 0 && target < lines.length) {
                keep.add(target);
            }
        }
    });

    const result: Array<DiffLine | null> = [];
    let lastKept = -1;
    lines.forEach((line, index) => {
        if (!keep.has(index)) {
            return;
        }
        if (lastKept !== -1 && index - lastKept > 1) {
            result.push(null);
        }
        result.push(line);
        lastKept = index;
    });

    return result;
}
