import { useMemo, useState } from 'react';
import {
    createForeshadow,
    lastTouchedChapter,
    payoffForeshadow,
    scanForeshadow,
    touchForeshadow,
    type Foreshadow,
} from '@mojiang/core';
import { useAppStore } from '@/store/useAppStore';

/**
 * 伏笔视图
 * 登记 / 提及 / 回收 / 超期扫描，全部按章节号判断，不依赖模型
 */
export default function ForeshadowView() {
    const foreshadow = useAppStore((state) => state.foreshadow);
    const chapterId = useAppStore((state) => state.chapterId);
    const saveForeshadow = useAppStore((state) => state.saveForeshadow);

    const [newContent, setNewContent] = useState('');
    const [newPlan, setNewPlan] = useState('');

    const currentChapter = chapterId ? Number.parseInt(chapterId, 10) || 0 : 0;
    const alerts = useMemo(
        () => (foreshadow ? scanForeshadow(foreshadow, currentChapter) : []),
        [foreshadow, currentChapter],
    );

    if (!foreshadow) {
        return (
            <main className="flex flex-1 items-center justify-center text-sm text-ink-500">
                伏笔还没加载，先打开一本书
            </main>
        );
    }

    const pendingCount = foreshadow.items.filter((item) => item.payoffChapter === null).length;
    const paidCount = foreshadow.items.length - pendingCount;

    /**
     * 替换伏笔文件并落盘
     * @param items 新列表
     */
    async function commit(items: Foreshadow[]): Promise<void> {
        await saveForeshadow({ items });
    }

    /**
     * 新增一条伏笔
     */
    async function addItem(): Promise<void> {
        const content = newContent.trim();
        if (!content) {
            return;
        }
        const plan = Number.parseInt(newPlan, 10);
        const item = createForeshadow(
            content,
            currentChapter,
            Number.isFinite(plan) && plan > 0 ? plan : null,
        );
        await commit([...foreshadow!.items, item]);
        setNewContent('');
        setNewPlan('');
    }

    /**
     * 记录"本章又提到了"
     * @param item 伏笔
     */
    async function markTouched(item: Foreshadow): Promise<void> {
        await commit(
            foreshadow!.items.map((entry) =>
                entry.id === item.id ? touchForeshadow(entry, currentChapter) : entry,
            ),
        );
    }

    /**
     * 标记已回收
     * @param item 伏笔
     */
    async function markPaid(item: Foreshadow): Promise<void> {
        await commit(
            foreshadow!.items.map((entry) =>
                entry.id === item.id ? payoffForeshadow(entry, currentChapter) : entry,
            ),
        );
    }

    /**
     * 删除一条伏笔
     * @param item 伏笔
     */
    async function removeItem(item: Foreshadow): Promise<void> {
        if (!window.confirm(`删除这条伏笔？\n\n${item.content}`)) {
            return;
        }
        await commit(foreshadow!.items.filter((entry) => entry.id !== item.id));
    }

    return (
        <main className="flex min-w-0 flex-1 flex-col bg-ink-950">
            <div className="flex h-11 shrink-0 items-center justify-between border-b border-ink-800 bg-ink-900 px-4">
                <div className="flex items-center gap-3">
                    <h2 className="text-sm font-medium text-ink-100">伏笔</h2>
                    <span className="text-[13px] text-ink-500">
                        第 {currentChapter} 章 · 待回收 {pendingCount} · 已回收 {paidCount}
                    </span>
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <div className="mx-auto max-w-4xl space-y-4">
                    {/* 超期告警 */}
                    {alerts.length > 0 && (
                        <section className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3">
                            <p className="text-[13px] font-medium text-amber-500">
                                {alerts.length} 条伏笔该动了
                            </p>
                            <ul className="mt-1.5 space-y-1">
                                {alerts.map((alert) => (
                                    <li
                                        key={alert.id}
                                        className={`text-[13px] ${
                                            alert.level === 'error' ? 'text-red-300' : 'text-amber-200/80'
                                        }`}
                                    >
                                        · {alert.content} — {alert.message}
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}

                    {/* 新增 */}
                    <section className="flex items-end gap-2 rounded-md border border-ink-800 bg-ink-900 p-3">
                        <div className="min-w-0 flex-1">
                            <label className="label" htmlFor="fs-content">
                                新伏笔
                            </label>
                            <input
                                id="fs-content"
                                className="field text-[14px]"
                                placeholder="一句话写清这条线索，比如：井底的声音和主角的梦对得上"
                                value={newContent}
                                onChange={(event) => setNewContent(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                        void addItem();
                                    }
                                }}
                            />
                        </div>
                        <div className="w-24 shrink-0">
                            <label className="label" htmlFor="fs-plan">
                                计划回收章
                            </label>
                            <input
                                id="fs-plan"
                                type="number"
                                min="1"
                                className="field text-[14px]"
                                placeholder="可不填"
                                value={newPlan}
                                onChange={(event) => setNewPlan(event.target.value)}
                            />
                        </div>
                        <button type="button" className="btn-primary shrink-0" onClick={() => void addItem()}>
                            登记
                        </button>
                    </section>

                    {/* 列表 */}
                    {foreshadow.items.length === 0 ? (
                        <p className="text-[13px] leading-relaxed text-ink-500">
                            还没有伏笔。埋了一条线索就来这里登记，之后每次提到可以点"提及"，
                            超过 20 章没动会自动标黄。
                        </p>
                    ) : (
                        <ul className="space-y-1.5">
                            {[...foreshadow.items]
                                .sort((left, right) => {
                                    // 未回收的排前面，再按埋设章排序
                                    if (
                                        (left.payoffChapter === null) !==
                                        (right.payoffChapter === null)
                                    ) {
                                        return left.payoffChapter === null ? -1 : 1;
                                    }
                                    return left.plantedChapter - right.plantedChapter;
                                })
                                .map((item) => {
                                    const paid = item.payoffChapter !== null;
                                    const gap = currentChapter - lastTouchedChapter(item);
                                    const overdue =
                                        !paid &&
                                        item.plannedChapter !== null &&
                                        currentChapter > item.plannedChapter;

                                    return (
                                        <li
                                            key={item.id}
                                            className={`rounded-md border px-3 py-2 ${
                                                paid
                                                    ? 'border-ink-800 bg-ink-900/60'
                                                    : overdue
                                                      ? 'border-red-500/40 bg-red-500/5'
                                                      : 'border-ink-800 bg-ink-900'
                                            }`}
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0 flex-1">
                                                    <p
                                                        className={`text-[13px] leading-relaxed ${
                                                            paid ? 'text-ink-500 line-through' : 'text-ink-100'
                                                        }`}
                                                    >
                                                        {item.content}
                                                    </p>
                                                    <p className="mt-1 text-[13px] text-ink-500">
                                                        第 {item.plantedChapter} 章埋下
                                                        {item.mentions.length > 1
                                                            ? ` · 提及 ${item.mentions.join('、')}`
                                                            : ''}
                                                        {item.plannedChapter !== null
                                                            ? ` · 计划第 ${item.plannedChapter} 章回收`
                                                            : ' · 未规划回收'}
                                                        {!paid && gap > 0 ? ` · ${gap} 章没动` : ''}
                                                        {paid ? ` · 第 ${item.payoffChapter} 章已回收` : ''}
                                                    </p>
                                                </div>
                                                <div className="flex shrink-0 items-center gap-2">
                                                    {!paid && (
                                                        <>
                                                            <button
                                                                type="button"
                                                                className="text-[13px] text-jade-500 hover:text-jade-400"
                                                                onClick={() => void markTouched(item)}
                                                            >
                                                                提及本章
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="text-[13px] text-ink-300 hover:text-ink-100"
                                                                onClick={() => void markPaid(item)}
                                                            >
                                                                标记回收
                                                            </button>
                                                        </>
                                                    )}
                                                    <button
                                                        type="button"
                                                        className="text-[13px] text-ink-600 hover:text-red-400"
                                                        onClick={() => void removeItem(item)}
                                                    >
                                                        删除
                                                    </button>
                                                </div>
                                            </div>
                                        </li>
                                    );
                                })}
                        </ul>
                    )}
                </div>
            </div>
        </main>
    );
}
