import {
    DIMENSION_KEYS,
    DIMENSION_LABELS,
    MIN_BASELINE_SAMPLES,
    describeDrift,
    type Finding,
} from '@mojiang/core';
import RadarChart, { type RadarAxis } from '@/components/RadarChart';
import { useAppStore } from '@/store/useAppStore';

/** 没有基线时的参考值，让雷达图先有个形状 */
const FALLBACK_REFERENCE: Record<string, number> = {
    syntaxComplexity: 20,
    modifierDensity: 45,
    abstraction: 12,
    actionDensity: 22,
    uncertainty: 12,
    blankSpace: 16,
};

/** 严重程度对应的颜色类 */
const SEVERITY_TONE: Record<string, string> = {
    error: 'text-red-400',
    warn: 'text-amber-500',
    info: 'text-ink-400',
};

/**
 * 右侧体检面板
 * 数据全部来自本地规则计算，刷新是即时的，不花 token
 */
export default function HealthPanel() {
    const report = useAppStore((state) => state.report);
    const checking = useAppStore((state) => state.checking);
    const rebuildBaseline = useAppStore((state) => state.rebuildBaseline);
    const book = useAppStore((state) => state.book);

    if (!report) {
        return (
            <div className="p-4 text-[13px] leading-relaxed text-ink-500">
                写完一段，这里会自动出体检结果。
                <br />
                体检是本地规则计算，0 token，随时刷新。
            </div>
        );
    }

    const axes: RadarAxis[] = DIMENSION_KEYS.map((key) => {
        const drift = report.baseline?.drifts.find((item) => item.key === key);
        return {
            label: DIMENSION_LABELS[key],
            value: report.metrics[key],
            reference: drift?.mu ?? FALLBACK_REFERENCE[key],
        };
    });

    const outOfBand = report.baseline?.outOfBandKeys ?? [];

    /**
     * 用前若干章重建基线
     */
    async function handleRebuild(): Promise<void> {
        if (!book) {
            return;
        }
        // 基线只从正文取样：细纲的句长和正文不是一回事
        const manuscript = await window.api.chapter.list(book.id, 'zhengwen');
        const candidateIds = manuscript
            .filter((chapter) => chapter.charCount > 200)
            .slice(0, 10)
            .map((chapter) => chapter.id);
        if (candidateIds.length < MIN_BASELINE_SAMPLES) {
            window.alert(
                `建基线至少要 ${MIN_BASELINE_SAMPLES} 章、每章 200 字以上。现在符合条件的只有 ${candidateIds.length} 章。`,
            );
            return;
        }
        const ok = window.confirm(
            `用这 ${candidateIds.length} 章的六维数据建基线？\n\n基线代表"你认可的写法"，之后的章节会和它比。`,
        );
        if (ok) {
            await rebuildBaseline(candidateIds);
        }
    }

    return (
        <div className="flex h-full flex-col overflow-hidden">
            {/* 综合分 */}
            <div className="flex items-end gap-3 border-b border-ink-800 px-4 py-3">
                <div>
                    <p className="text-[13px] uppercase tracking-wider text-ink-500">综合分</p>
                    <p
                        className={`text-3xl font-semibold leading-none ${
                            report.score >= 80
                                ? 'text-jade-400'
                                : report.score >= 60
                                  ? 'text-amber-500'
                                  : 'text-red-400'
                        }`}
                    >
                        {report.score}
                    </p>
                </div>
                <div className="flex-1 text-[13px] leading-relaxed text-ink-500">
                    <p>词库闸 {report.lexicon.score}</p>
                    <p>基线闸 {report.baseline ? report.baseline.score : '未建基线'}</p>
                    {checking && <p className="text-jade-500">正在重算…</p>}
                </div>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                {/* 雷达图 */}
                <section>
                    <div className="mb-1 flex items-center justify-between">
                        <h3 className="text-[13px] font-medium text-ink-300">六维基线</h3>
                        <button
                            type="button"
                            className="text-[13px] text-jade-500 hover:text-jade-400"
                            onClick={() => void handleRebuild()}
                        >
                            {book ? '用旧章重算' : ''}
                        </button>
                    </div>
                    <RadarChart axes={axes} />
                    <p className="mt-1 text-center text-[13px] text-ink-600">
                        虚线是你的基线，实线是本章
                    </p>

                    <ul className="mt-2 space-y-0.5">
                        {DIMENSION_KEYS.map((key) => {
                            const drift = report.baseline?.drifts.find((item) => item.key === key);
                            const isOut = outOfBand.includes(key);
                            return (
                                <li
                                    key={key}
                                    className="flex items-center justify-between text-[13px]"
                                    title={drift ? describeDrift(drift) : `参考值 ${FALLBACK_REFERENCE[key]}`}
                                >
                                    <span className={isOut ? 'text-amber-500' : 'text-ink-400'}>
                                        {DIMENSION_LABELS[key]}
                                    </span>
                                    <span className={isOut ? 'text-amber-500' : 'text-ink-300'}>
                                        {report.metrics[key]}
                                        {drift ? ` / ${drift.mu}` : ''}
                                        {isOut ? ' ⚠️' : ''}
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                </section>

                {/* 12 类词库 */}
                <section>
                    <h3 className="mb-1.5 text-[13px] font-medium text-ink-300">十二类词库</h3>
                    <ul className="space-y-0.5">
                        {report.lexicon.summaries.map((summary) => (
                            <li
                                key={summary.ruleId}
                                className="flex items-center justify-between text-[13px]"
                            >
                                <span className={summary.count > 0 ? SEVERITY_TONE[summary.severity] : 'text-ink-500'}>
                                    {summary.category}
                                </span>
                                <span className={summary.count > 0 ? 'text-ink-200' : 'text-ink-600'}>
                                    {summary.count > 0 ? `${summary.count} 处` : '通过'}
                                </span>
                            </li>
                        ))}
                    </ul>
                </section>

                {/* 命中明细 */}
                <section>
                    <h3 className="mb-1.5 text-[13px] font-medium text-ink-300">
                        命中明细{report.lexicon.findings.length > 0 ? `（${report.lexicon.findings.length}）` : ''}
                    </h3>
                    {report.lexicon.findings.length === 0 ? (
                        <p className="text-[13px] text-ink-500">这一章很干净。</p>
                    ) : (
                        <ul className="space-y-1.5">
                            {report.lexicon.findings.slice(0, 40).map((finding: Finding, index) => (
                                <li
                                    key={`${finding.start}-${finding.ruleId}-${index}`}
                                    className="rounded border border-ink-800 bg-ink-850 px-2 py-1.5"
                                >
                                    <div className="flex items-center justify-between">
                                        <span className={`text-[13px] ${SEVERITY_TONE[finding.severity]}`}>
                                            {finding.category}
                                        </span>
                                        <span className="max-w-[60%] truncate text-[13px] text-ink-400">
                                            「{finding.snippet}」
                                        </span>
                                    </div>
                                    <p className="mt-1 text-[13px] leading-relaxed text-ink-400">
                                        {finding.message}
                                    </p>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
            </div>
        </div>
    );
}
