import { useEffect, useMemo, useState } from 'react';
import {
    buildLedgerPath,
    buildPatchesFromMarks,
    detectLedgerConflicts,
    parseLedgerPath,
    recordPatch,
    type LedgerFile,
    type LedgerPatchRecord,
} from '@mojiang/core';

/**
 * 把 RFC6902 路径还原成人看得懂的样子
 * 存储时中文被 encodeURIComponent 转义了，展示前要解回来
 * @param path 路径
 * @returns 主体.字段
 */
function readablePath(path: string): string {
    const parsed = parseLedgerPath(path);
    return parsed ? `${parsed.subject}.${parsed.field}` : path;
}
import { formatTime } from '@/lib/format';
import { useAppStore } from '@/store/useAppStore';

/** 账本面板的两个页签 */
type LedgerTab = 'state' | 'history';

/**
 * 账本视图
 * 按主体组织的状态树 + patch 历史。
 * 关键设计：不做自动落账，作者点"应用"才写，因为 AI 和正文都可能写错。
 */
export default function LedgerView() {
    const ledger = useAppStore((state) => state.ledger);
    const content = useAppStore((state) => state.content);
    const chapterId = useAppStore((state) => state.chapterId);
    const saveLedger = useAppStore((state) => state.saveLedger);
    const pushToast = useAppStore((state) => state.pushToast);

    const [selected, setSelected] = useState<string | null>(null);
    const [tab, setTab] = useState<LedgerTab>('state');
    const [newSubject, setNewSubject] = useState('');
    const [newField, setNewField] = useState('');
    const [newValue, setNewValue] = useState('');
    const [drafts, setDrafts] = useState<LedgerPatchRecord[]>([]);

    const subjects = useMemo(() => Object.keys(ledger?.tree ?? {}).sort(), [ledger]);
    const currentChapter = chapterId ? Number.parseInt(chapterId, 10) || 0 : 0;

    // 主体列表变化时保证选中项有效
    useEffect(() => {
        if (subjects.length === 0) {
            setSelected(null);
            return;
        }
        if (!selected || !subjects.includes(selected)) {
            setSelected(subjects[0]);
        }
    }, [subjects, selected]);

    // 正文里写的和账本记的不一致，实时算出来
    const conflicts = useMemo(
        () => (ledger ? detectLedgerConflicts(content, ledger) : []),
        [ledger, content],
    );

    if (!ledger) {
        return (
            <main className="flex flex-1 items-center justify-center text-sm text-ink-500">
                账本还没加载，先打开一本书
            </main>
        );
    }

    const subjectState = selected ? ledger.tree[selected] ?? {} : {};

    /**
     * 追加一条 patch 并落盘
     * @param record patch 记录
     */
    async function applyRecord(record: Omit<LedgerPatchRecord, 'at'>): Promise<void> {
        if (!ledger) {
            return;
        }
        const next = recordPatch(ledger, { ...record, at: new Date().toISOString() });
        await saveLedger(next);
    }

    /**
     * 新建一个主体
     */
    async function addSubject(): Promise<void> {
        const name = newSubject.trim();
        if (!name || !ledger) {
            return;
        }
        if (ledger.tree[name]) {
            pushToast('info', `"${name}"已经在账本里了`);
            setSelected(name);
            setNewSubject('');
            return;
        }
        const next: LedgerFile = {
            tree: { ...ledger.tree, [name]: {} },
            history: ledger.history,
        };
        await saveLedger(next);
        setSelected(name);
        setNewSubject('');
    }

    /**
     * 新增或修改一个字段
     */
    async function addField(): Promise<void> {
        const field = newField.trim();
        if (!field || !selected) {
            return;
        }
        await applyRecord({
            op: 'replace',
            path: buildLedgerPath(selected, field),
            value: newValue.trim(),
            chapter: currentChapter,
            note: '手动录入',
        });
        setNewField('');
        setNewValue('');
    }

    /**
     * 从正文标注生成待落账的 patch
     */
    function extractFromChapter(): void {
        if (content.trim().length === 0) {
            pushToast('info', '当前章节是空的，没有可提取的标注');
            return;
        }
        const patches = buildPatchesFromMarks(content, currentChapter);
        if (patches.length === 0) {
            pushToast(
                'info',
                '正文里没有账本标注。写法是 [[账本|主体|字段|值]]，例如 [[账本|林胜|realm|开八门第二门]]',
            );
            return;
        }
        setDrafts(patches);
    }

    /**
     * 应用一条待落账 patch
     * @param record 记录
     */
    async function applyDraft(record: LedgerPatchRecord): Promise<void> {
        if (!ledger) {
            return;
        }
        const next = recordPatch(ledger, { ...record, at: new Date().toISOString() });
        await saveLedger(next);
        setDrafts((previous) => previous.filter((item) => item !== record));
    }

    /**
     * 一次性应用全部待落账 patch
     */
    async function applyAllDrafts(): Promise<void> {
        if (!ledger || drafts.length === 0) {
            return;
        }
        let next = ledger;
        const at = new Date().toISOString();
        for (const record of drafts) {
            next = recordPatch(next, { ...record, at });
        }
        await saveLedger(next);
        setDrafts([]);
        pushToast('success', `已落账 ${drafts.length} 条`);
    }

    return (
        <main className="flex min-w-0 flex-1 flex-col bg-ink-950">
            <div className="flex h-11 shrink-0 items-center justify-between border-b border-ink-800 bg-ink-900 px-4">
                <div className="flex items-center gap-3">
                    <h2 className="text-sm font-medium text-ink-100">账本</h2>
                    <span className="text-[13px] text-ink-500">
                        第 {currentChapter} 章 · {subjects.length} 个主体 ·{' '}
                        {ledger.history.length} 条变更
                    </span>
                </div>
                <div className="flex items-center gap-1.5">
                    {(['state', 'history'] as LedgerTab[]).map((item) => (
                        <button
                            type="button"
                            key={item}
                            className={
                                tab === item ? 'btn-outline text-[13px]' : 'btn-ghost text-[13px]'
                            }
                            onClick={() => setTab(item)}
                        >
                            {item === 'state' ? '当前状态' : '变更历史'}
                        </button>
                    ))}
                    <button type="button" className="btn-primary text-[13px]" onClick={extractFromChapter}>
                        从正文提取
                    </button>
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {tab === 'state' ? (
                    <div className="mx-auto max-w-4xl space-y-4">
                        {/* 冲突提示 */}
                        {conflicts.length > 0 && (
                            <section className="rounded-md border border-red-500/50 bg-red-500/10 p-3">
                                <p className="text-[13px] font-medium text-red-300">
                                    正文和账本对不上（{conflicts.length} 处）
                                </p>
                                <ul className="mt-1.5 space-y-1">
                                    {conflicts.map((conflict, index) => (
                                        <li key={`${conflict.start}-${index}`} className="text-[13px] text-red-200/80">
                                            · {conflict.message}
                                        </li>
                                    ))}
                                </ul>
                                <p className="mt-1.5 text-[13px] text-ink-500">
                                    要么改正文，要么把账本更新成新的值——这里不替你决定。
                                </p>
                            </section>
                        )}

                        {/* 待落账 */}
                        {drafts.length > 0 && (
                            <section className="rounded-md border border-jade-600/50 bg-jade-600/10 p-3">
                                <div className="flex items-center justify-between">
                                    <p className="text-[13px] font-medium text-jade-400">
                                        从正文提取到 {drafts.length} 条，确认后才写入
                                    </p>
                                    <button
                                        type="button"
                                        className="btn-primary text-[13px]"
                                        onClick={() => void applyAllDrafts()}
                                    >
                                        全部应用
                                    </button>
                                </div>
                                <ul className="mt-2 space-y-1">
                                    {drafts.map((record, index) => {
                                        const parsed = parseLedgerPath(record.path);
                                        const previous = parsed
                                            ? ledger.tree[parsed.subject]?.[parsed.field]
                                            : undefined;
                                        return (
                                            <li
                                                key={`${record.path}-${index}`}
                                                className="flex items-center justify-between gap-2 text-[13px]"
                                            >
                                                <span className="truncate text-ink-200">
                                                    {readablePath(record.path)}：{previous ?? '（空）'} →{' '}
                                                    {record.value}
                                                </span>
                                                <button
                                                    type="button"
                                                    className="shrink-0 text-[13px] text-jade-400 hover:text-jade-300"
                                                    onClick={() => void applyDraft(record)}
                                                >
                                                    应用
                                                </button>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </section>
                        )}

                        {/* 主体选择 */}
                        <section>
                            <div className="mb-2 flex flex-wrap items-center gap-1.5">
                                {subjects.map((subject) => (
                                    <button
                                        type="button"
                                        key={subject}
                                        onClick={() => setSelected(subject)}
                                        className={`rounded-md px-2 py-1 text-[13px] ${
                                            selected === subject
                                                ? 'bg-jade-500/20 text-jade-400'
                                                : 'bg-ink-850 text-ink-300 hover:bg-ink-800'
                                        }`}
                                    >
                                        {subject}
                                        <span className="ml-1 text-[13px] text-ink-600">
                                            {Object.keys(ledger.tree[subject]).length}
                                        </span>
                                    </button>
                                ))}
                                <div className="flex items-center gap-1">
                                    <input
                                        className="field h-7 w-28 text-[13px]"
                                        placeholder="新主体名"
                                        value={newSubject}
                                        onChange={(event) => setNewSubject(event.target.value)}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter') {
                                                void addSubject();
                                            }
                                        }}
                                    />
                                    <button
                                        type="button"
                                        className="btn-outline h-7 text-[13px]"
                                        onClick={() => void addSubject()}
                                    >
                                        加主体
                                    </button>
                                </div>
                            </div>

                            {selected ? (
                                <div className="overflow-hidden rounded-md border border-ink-800">
                                    <table className="w-full text-[13px]">
                                        <thead className="bg-ink-850 text-ink-400">
                                            <tr>
                                                <th className="w-32 px-2 py-1.5 text-left font-medium">字段</th>
                                                <th className="px-2 py-1.5 text-left font-medium">当前值</th>
                                                <th className="w-12 px-2 py-1.5" />
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {Object.keys(subjectState).length === 0 && (
                                                <tr>
                                                    <td colSpan={3} className="px-3 py-3 text-ink-500">
                                                        这个主体还没有字段，从下面加一个。
                                                    </td>
                                                </tr>
                                            )}
                                            {Object.keys(subjectState)
                                                .sort()
                                                .map((field) => (
                                                    <tr key={field} className="border-t border-ink-800">
                                                        <td className="px-2 py-1 text-ink-400">{field}</td>
                                                        <td className="px-2 py-1">
                                                            <input
                                                                key={`${selected}-${field}-${subjectState[field]}`}
                                                                className="w-full rounded bg-transparent px-1 py-0.5 text-ink-100 focus:bg-ink-850 focus:outline-none"
                                                                defaultValue={subjectState[field]}
                                                                onBlur={(event) => {
                                                                    const nextValue = event.target.value;
                                                                    if (nextValue !== subjectState[field]) {
                                                                        void applyRecord({
                                                                            op: 'replace',
                                                                            path: buildLedgerPath(selected, field),
                                                                            value: nextValue,
                                                                            chapter: currentChapter,
                                                                            note: '手动修改',
                                                                        });
                                                                    }
                                                                }}
                                                            />
                                                        </td>
                                                        <td className="px-2 py-1 text-right">
                                                            <button
                                                                type="button"
                                                                className="text-[13px] text-ink-500 hover:text-red-400"
                                                                onClick={() => {
                                                                    void applyRecord({
                                                                        op: 'remove',
                                                                        path: buildLedgerPath(selected, field),
                                                                        chapter: currentChapter,
                                                                        note: '手动删除',
                                                                    });
                                                                }}
                                                            >
                                                                删除
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))}
                                        </tbody>
                                    </table>

                                    <div className="flex items-center gap-1 border-t border-ink-800 bg-ink-900 p-2">
                                        <input
                                            className="field h-7 w-28 text-[13px]"
                                            placeholder="字段名，如 realm"
                                            value={newField}
                                            onChange={(event) => setNewField(event.target.value)}
                                        />
                                        <input
                                            className="field h-7 flex-1 text-[13px]"
                                            placeholder="值，如 开八门第二门"
                                            value={newValue}
                                            onChange={(event) => setNewValue(event.target.value)}
                                            onKeyDown={(event) => {
                                                if (event.key === 'Enter') {
                                                    void addField();
                                                }
                                            }}
                                        />
                                        <button
                                            type="button"
                                            className="btn-outline h-7 text-[13px]"
                                            onClick={() => void addField()}
                                        >
                                            加字段
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <p className="text-[13px] text-ink-500">
                                    还没有主体。先加一个，比如主角的名字。
                                </p>
                            )}
                        </section>
                    </div>
                ) : (
                    <div className="mx-auto max-w-4xl">
                        {ledger.history.length === 0 ? (
                            <p className="text-[13px] text-ink-500">还没有变更记录。</p>
                        ) : (
                            <ul className="space-y-1">
                                {[...ledger.history]
                                    .reverse()
                                    .slice(0, 200)
                                    .map((record, index) => (
                                        <li
                                            key={`${record.path}-${record.at}-${index}`}
                                            className="flex items-baseline gap-2 rounded border border-ink-800 bg-ink-900 px-2 py-1.5 text-[13px]"
                                        >
                                            <span className="shrink-0 text-ink-600">
                                                第 {record.chapter} 章
                                            </span>
                                            <span className="shrink-0 text-jade-500">{record.op}</span>
                                            <span className="min-w-0 flex-1 truncate text-ink-200">
                                                {readablePath(record.path)}
                                                {record.value !== undefined ? ` → ${record.value}` : ''}
                                            </span>
                                            <span className="shrink-0 text-[13px] text-ink-600">
                                                {formatTime(record.at)}
                                            </span>
                                        </li>
                                    ))}
                            </ul>
                        )}
                    </div>
                )}
            </div>
        </main>
    );
}
