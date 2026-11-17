import { useEffect, useState } from 'react';
import { AI_TRACE_BASELINE, type HumanTrace, type Skill } from '@mojiang/core';
import Modal from '@/components/Modal';
import { errorMessage, formatCharCount } from '@/lib/format';
import { useAppStore } from '@/store/useAppStore';
import type { HumanTraceOverview, StyleFileInfo } from '@shared/api';

/** 属性 */
interface StyleDistillDialogProps {
    open: boolean;
    onClose: () => void;
}

/** 蒸馏成功后的结果 */
interface DistillOutcome {
    skill: Skill;
    trace: HumanTrace;
    /** 本次新增/更新的书名 */
    added: string[];
    /** 累积样本数与字数 */
    sourceCount: number;
    charCount: number;
    humanScore: number;
}

/** 一行指标：名字、样本值、AI 基准值 */
interface TraceRow {
    label: string;
    value: string;
    baseline: string;
    /** 样本相对 AI 是否已经"更人"，用来决定标绿还是灰 */
    isHuman: boolean;
    /** 只展示、不判定颜色：绝对值定标不准的指标走这条 */
    neutral?: boolean;
}

/**
 * 把痕迹整理成可展示的行
 *
 * 每行都带 AI 基准：单看"段长波动 1.12"没有意义，跟"AI 约 0.35"并排才有说服力。
 * @param trace 痕迹
 * @returns 指标行
 */
function buildTraceRows(trace: HumanTrace): TraceRow[] {
    const percent = (value: number): string => `${Math.round(value * 100)}%`;
    const perThousand = (value: number): string => `${value}/千字`;
    const perThousandSentence = (value: number): string => `${value}/千句`;
    const baseline = AI_TRACE_BASELINE;
    return [
        {
            label: '段长波动',
            value: String(trace.paragraphLengthCV),
            baseline: String(baseline.paragraphLengthCV),
            isHuman: trace.paragraphLengthCV > baseline.paragraphLengthCV,
        },
        {
            label: '短句成段',
            value: percent(trace.singleSentenceParagraphRatio),
            baseline: percent(baseline.singleSentenceParagraphRatio),
            isHuman: trace.singleSentenceParagraphRatio > baseline.singleSentenceParagraphRatio,
        },
        {
            label: '段末总结',
            value: percent(trace.summaryEndingRatio),
            baseline: percent(baseline.summaryEndingRatio),
            isHuman: trace.summaryEndingRatio < baseline.summaryEndingRatio,
        },
        {
            label: '衔接词',
            value: perThousand(trace.transitionPerThousand),
            baseline: perThousand(baseline.transitionPerThousand),
            isHuman: trace.transitionPerThousand < baseline.transitionPerThousand,
        },
        {
            label: '自我重复',
            value: perThousandSentence(trace.selfRepeatPerThousand),
            baseline: perThousandSentence(baseline.selfRepeatPerThousand),
            isHuman: trace.selfRepeatPerThousand > baseline.selfRepeatPerThousand,
            // 只看趋势，不判定好坏：作者回头改过稿的书，这个值会很低，但不代表人味少
            neutral: true,
        },
        {
            label: '抽象概括',
            value: perThousand(trace.abstractFeelingPerThousand),
            baseline: perThousand(baseline.abstractFeelingPerThousand),
            isHuman: trace.abstractFeelingPerThousand < baseline.abstractFeelingPerThousand,
        },
        {
            label: '省略号收尾',
            value: percent(trace.unfinishedSentenceRatio),
            baseline: percent(baseline.unfinishedSentenceRatio),
            isHuman: trace.unfinishedSentenceRatio > baseline.unfinishedSentenceRatio,
        },
    ];
}

/**
 * 人味蒸馏弹窗（小说专用）
 *
 * 这里刻意不学"某个作者的风格"，学的是"人的写作思路"：
 * 会忘、会重复、会跳、笔墨不均、段落不收尾。上传的书只是样本，
 * 累积进同一份基线，最后变成技能里的一条约束。
 */
export default function StyleDistillDialog({ open, onClose }: StyleDistillDialogProps) {
    const pushToast = useAppStore((state) => state.pushToast);
    const bumpSkills = useAppStore((state) => state.bumpSkills);

    /** 本次选中的素材 */
    const [files, setFiles] = useState<StyleFileInfo[]>([]);
    /** 已经攒下的样本 */
    const [overview, setOverview] = useState<HumanTraceOverview | null>(null);
    const [picking, setPicking] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [outcome, setOutcome] = useState<DistillOutcome | null>(null);

    // 每次打开都刷新一下"已攒多少"，并清掉上一次的选择
    useEffect(() => {
        if (!open) {
            return;
        }
        setFiles([]);
        setError('');
        setOutcome(null);
        setBusy(false);
        let alive = true;
        void (async () => {
            try {
                const data = await window.api.style.overview();
                if (alive) {
                    setOverview(data);
                }
            } catch {
                // 档案读不到不影响蒸馏，静默即可
                if (alive) {
                    setOverview(null);
                }
            }
        })();
        return () => {
            alive = false;
        };
    }, [open]);

    /**
     * 选文件：主进程读完顺便带回字数
     */
    async function handlePick(): Promise<void> {
        if (picking || busy) {
            return;
        }
        setPicking(true);
        try {
            const result = await window.api.style.pick();
            if (result.canceled) {
                return;
            }
            // 同一本选两次不该占两个位置
            setFiles((previous) => {
                const merged = [...previous];
                for (const item of result.files) {
                    if (!merged.some((exist) => exist.path === item.path)) {
                        merged.push(item);
                    }
                }
                return merged.slice(0, 8);
            });
        } catch (caught) {
            setError(errorMessage(caught));
        } finally {
            setPicking(false);
        }
    }

    /**
     * 移除一本素材
     * @param path 路径
     */
    function handleRemove(path: string): void {
        setFiles((previous) => previous.filter((item) => item.path !== path));
    }

    /**
     * 跑蒸馏：把这次的书累积进基线
     */
    async function handleDistill(): Promise<void> {
        if (busy || files.length === 0) {
            return;
        }
        setBusy(true);
        setError('');
        try {
            const result = await window.api.style.distill({
                files: files.map((item) => item.path),
            });
            if (!result.ok) {
                setError(result.message);
                return;
            }
            setOutcome({
                skill: result.skill,
                trace: result.metrics.trace,
                added: result.added,
                sourceCount: result.sources.length,
                charCount: result.metrics.trace.charCount,
                humanScore: result.humanScore,
            });
            setOverview({
                sourceCount: result.sources.length,
                charCount: result.metrics.trace.charCount,
                humanScore: result.humanScore,
                updatedAt: new Date().toISOString(),
                names: result.sources.map((item) => item.name),
            });
            bumpSkills();
            pushToast('success', `基线已更新（人味分 ${result.humanScore}）`);
        } catch (caught) {
            setError(errorMessage(caught));
        } finally {
            setBusy(false);
        }
    }

    const totalChars = files.reduce((sum, item) => sum + item.chars, 0);
    const rows = outcome ? buildTraceRows(outcome.trace) : [];

    return (
        <Modal
            open={open}
            title="人味蒸馏（小说专用）"
            subtitle="不学某个作者的风格，学人的写作思路——会忘、会重复、会跳、不收尾"
            onClose={onClose}
            widthClass="max-w-xl"
            footer={
                <>
                    <button type="button" className="btn-ghost" onClick={onClose}>
                        {outcome ? '完成' : '取消'}
                    </button>
                    <button
                        type="button"
                        className="btn-primary"
                        onClick={() => void handleDistill()}
                        disabled={busy || files.length === 0}
                    >
                        {busy ? '统计中…' : outcome ? '再更新一次' : '开始蒸馏'}
                    </button>
                </>
            }
        >
            <div className="space-y-4">
                {/* 说明：讲清"学思路"而不是"学风格"，并说明为什么书可以是不同作者的 */}
                <div className="rounded-lg border border-ink-750 bg-ink-850 px-3 py-2.5">
                    <p className="text-[13px] leading-relaxed text-ink-300">
                        AI 味的根源不是用词，是<strong className="text-ink-100">思路太完美</strong>
                        ：能把几万字前后照顾到、每段逻辑自洽、笔墨均匀。人做不到，于是会忘、会重复、
                        会跳、会只死磕一个细节。
                    </p>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-ink-500">
                        所以要喂<strong className="text-ink-200">人的手稿</strong>（txt / md，一本一个文件）。
                        同作者最好，同类型也够用；<strong className="text-ink-200">3 到 4 本</strong>
                        更稳。学的是共性，不认某一位作者，所以不同作者的书可以混在一起传。
                    </p>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-ink-500">
                        只对小说生效。纯本地统计，不联网、不发原文；档案里只留数字和书名。
                    </p>
                </div>

                {/* 已攒样本 */}
                {overview && (
                    <div className="rounded-lg border border-jade-600/30 bg-jade-500/[0.04] px-3 py-2">
                        <p className="text-[13px] text-ink-300">
                            当前基线：参考 {overview.sourceCount} 本 ·{' '}
                            {formatCharCount(overview.charCount)} · 人味分{' '}
                            <span className="font-medium text-jade-400">{overview.humanScore}</span>
                        </p>
                        <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-ink-600">
                            {overview.names.join('、')}
                        </p>
                    </div>
                )}

                {/* 素材列表 */}
                <div>
                    <div className="mb-2 flex items-center justify-between">
                        <span className="text-[13px] text-ink-400">
                            本次素材
                            {files.length > 0 && (
                                <span className="ml-1.5 text-ink-600">
                                    {files.length} 本 · {formatCharCount(totalChars)}
                                </span>
                            )}
                        </span>
                        <button
                            type="button"
                            className="btn-outline h-7 text-[13px]"
                            onClick={() => void handlePick()}
                            disabled={picking || busy || files.length >= 8}
                        >
                            {picking ? '读取中…' : '+ 选择文件'}
                        </button>
                    </div>

                    {files.length === 0 ? (
                        <p className="rounded-lg border border-dashed border-ink-750 py-6 text-center text-[13px] text-ink-500">
                            还没有素材。点「+ 选择文件」，一次可以选多本。
                        </p>
                    ) : (
                        <ul className="space-y-1">
                            {files.map((item) => (
                                <li
                                    key={item.path}
                                    className="flex items-center gap-2 rounded-md border border-ink-750 bg-ink-900 px-2.5 py-1.5"
                                >
                                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink-200">
                                        {item.name}
                                    </span>
                                    <span
                                        className={`shrink-0 text-[12px] ${
                                            item.chars > 0 ? 'text-ink-500' : 'text-amber-500'
                                        }`}
                                    >
                                        {item.chars > 0 ? formatCharCount(item.chars) : '没读到正文'}
                                    </span>
                                    <button
                                        type="button"
                                        className="shrink-0 text-[13px] text-ink-600 hover:text-red-400"
                                        onClick={() => handleRemove(item.path)}
                                    >
                                        移除
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                {error.length > 0 && (
                    <p className="rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-1.5 text-[13px] text-red-300">
                        {error}
                    </p>
                )}

                {/* 结果：人味分 + 逐项对照 */}
                {outcome && (
                    <div className="rounded-lg border border-jade-600/40 bg-jade-500/5 px-3 py-2.5">
                        <div className="flex items-baseline gap-2">
                            <span className="text-2xl font-semibold text-jade-400">
                                {outcome.humanScore}
                            </span>
                            <span className="text-[13px] text-ink-400">
                                人味分 · 参考 {outcome.sourceCount} 本 ·{' '}
                                {formatCharCount(outcome.charCount)}
                            </span>
                        </div>
                        <p className="mt-1 text-[12px] leading-relaxed text-ink-500">
                            本次计入：{outcome.added.join('、')}
                        </p>
                        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
                            {rows.map((row) => (
                                <div key={row.label} className="flex items-baseline justify-between gap-2">
                                    <dt className="text-ink-500">{row.label}</dt>
                                    <dd className="flex items-baseline gap-1">
                                        <span
                                            className={
                                                row.neutral
                                                    ? 'text-ink-400'
                                                    : row.isHuman
                                                      ? 'text-jade-400'
                                                      : 'text-ink-300'
                                            }
                                        >
                                            {row.value}
                                        </span>
                                        <span className="text-ink-700">/ AI {row.baseline}</span>
                                    </dd>
                                </div>
                            ))}
                        </dl>
                        <p className="mt-2 text-[12px] leading-relaxed text-ink-600">
                            已写入技能「{outcome.skill.name}」，在设置 → 技能里可以随时关掉。
                            下次多传几本，基线会自动累积变准。
                        </p>
                    </div>
                )}
            </div>
        </Modal>
    );
}
