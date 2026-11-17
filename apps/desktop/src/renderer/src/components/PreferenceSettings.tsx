import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '@/lib/format';
import { useAppStore } from '@/store/useAppStore';

/** overview 的返回类型直接从 api 推导，免得两头各写一份 */
type PreferenceOverview = Awaited<ReturnType<typeof window.api.preference.overview>>;
type PersonalOverview = Awaited<ReturnType<typeof window.api.personal.overview>>;

/**
 * 把一项指标翻译成一句人话
 *
 * 直接给系数和比例，作者看不出跟自己有什么关系，
 * 所以这里只描述"读起来是什么样"，不报数字。
 * @param trace 画像指标
 * @returns 三行描述
 */
function describeMine(trace: NonNullable<PersonalOverview>['trace']): Array<{
    label: string;
    text: string;
}> {
    const paragraph = trace.paragraphLengthCV >= 0.6 ? '长段短段混着来' : trace.paragraphLengthCV >= 0.4 ? '段落长短有起伏' : '段落长短很整齐';
    const single = trace.singleSentenceParagraphRatio >= 0.2 ? '常一句话就换行' : '基本成段才换行';
    const ending = trace.summaryEndingRatio >= 0.5 ? '段段都要收个尾' : '常常说到一半就停';
    return [
        { label: '段落节奏', text: paragraph },
        { label: '换行习惯', text: single },
        { label: '收尾方式', text: ending },
    ];
}

/**
 * 人味分的小折线
 *
 * 只在快照够两个点时出现。用 SVG 手画而不是引图表库：
 * 一个几十行的小东西不值得多一份依赖。
 * @param props 折线点
 */
function Sparkline({ points }: { points: Array<{ humanScore: number }> }): JSX.Element {
    const width = 100;
    const height = 28;
    const scores = points.map((item) => item.humanScore);
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    // 分数全一样时给一条居中的平线，避免除以 0
    const span = max - min || 1;
    const coords = scores
        .map((score, index) => {
            const x = scores.length === 1 ? 0 : (index / (scores.length - 1)) * width;
            const y = height - ((score - min) / span) * (height - 4) - 2;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' ');
    return (
        <svg viewBox={`0 0 ${width} ${height}`} className="h-8 w-full" preserveAspectRatio="none">
            <polyline
                points={coords}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
                className="text-jade-500"
            />
        </svg>
    );
}

/**
 * 设置 → 偏好
 * 两块内容：我的笔感（你自己怎么写）、偏好示范（你改过哪些具体的句子）
 */
export default function PreferenceSettings() {
    const settings = useAppStore((state) => state.settings);
    const updateSettings = useAppStore((state) => state.updateSettings);
    const pushToast = useAppStore((state) => state.pushToast);
    const [overview, setOverview] = useState<PreferenceOverview | null>(null);
    const [personal, setPersonal] = useState<PersonalOverview | null>(null);
    const [busy, setBusy] = useState(false);
    /** 预览：软件现在会怎么跟模型描述"你怎么写" */
    const [preview, setPreview] = useState<string | null>(null);

    /**
     * 重新读一遍统计与示范
     */
    const reload = useCallback(async (): Promise<void> => {
        try {
            const [nextOverview, nextPersonal] = await Promise.all([
                window.api.preference.overview(),
                window.api.personal.overview(),
            ]);
            setOverview(nextOverview);
            setPersonal(nextPersonal);
        } catch (error) {
            pushToast('error', errorMessage(error));
        }
    }, [pushToast]);

    useEffect(() => {
        void reload();
    }, [reload]);

    /**
     * 改一个开关并落盘
     * @param patch 要改的字段
     */
    async function toggle(patch: {
        preferenceLearn?: boolean;
        preferenceInject?: boolean;
        personalTraceLearn?: boolean;
        personalTraceInject?: boolean;
    }): Promise<void> {
        if (!settings) {
            return;
        }
        try {
            await updateSettings({ ai: { ...settings.ai, ...patch } });
        } catch (error) {
            pushToast('error', errorMessage(error));
        }
    }

    /**
     * 删一条示范
     * @param id 示范 id
     */
    async function removePair(id: string): Promise<void> {
        setBusy(true);
        try {
            setOverview(await window.api.preference.remove(id));
        } catch (error) {
            pushToast('error', errorMessage(error));
        } finally {
            setBusy(false);
        }
    }

    /**
     * 清空所有示范
     */
    async function clearAll(): Promise<void> {
        if (!window.confirm('清空所有学到的改法？清空后 AI 会回到默认写法。')) {
            return;
        }
        setBusy(true);
        try {
            await window.api.preference.clear();
            await reload();
            pushToast('success', '已清空');
        } catch (error) {
            pushToast('error', errorMessage(error));
        } finally {
            setBusy(false);
        }
    }

    /**
     * 看一眼现在会注入什么
     *
     * 作者有权知道软件在替他"说话"，不然这段逻辑永远是黑盒。
     */
    async function showPreview(): Promise<void> {
        try {
            const result = await window.api.personal.prompt();
            setPreview(
                result.block.length > 0
                    ? result.block
                    : '现在还不会注入。画像攒够 1 万字成型以后，这里才会出现内容。',
            );
        } catch (error) {
            pushToast('error', errorMessage(error));
        }
    }

    /**
     * 回到从前的自己 / 取消参照
     * @param at 快照时间，null 表示回到现在的写法
     */
    async function pickAnchor(at: string | null): Promise<void> {
        setBusy(true);
        try {
            const next = await window.api.personal.setAnchor(at);
            setPersonal(next);
            // 注入内容变了，旧的预览必须收掉，否则作者看到的还是上一份
            setPreview(null);
            pushToast('success', at ? '已切回那时的写法' : '已恢复用现在的写法');
        } catch (error) {
            pushToast('error', errorMessage(error));
        } finally {
            setBusy(false);
        }
    }

    /**
     * 清空我的笔感
     */
    async function clearPersonal(): Promise<void> {
        if (!window.confirm('清空我的笔感？攒下的画像会归零，需要重新从零开始积累。')) {
            return;
        }
        setBusy(true);
        try {
            await window.api.personal.clear();
            await reload();
            pushToast('success', '已清空');
        } catch (error) {
            pushToast('error', errorMessage(error));
        } finally {
            setBusy(false);
        }
    }

    const pairs = overview?.pairs ?? [];
    const stats = overview?.stats ?? { segments: 0, accepted: 0, revised: 0 };
    const pending = overview?.pending ?? 0;
    // 原样保留率：比"改了多少"更能说明 AI 是否越写越像作者
    const keepRate = stats.segments > 0 ? Math.round((stats.accepted / stats.segments) * 100) : 0;

    // 进度条按"离下一个台阶还差多少"算，作者看到的是一个具体的盼头
    const nextGoal = personal
        ? personal.stage === 'collecting'
            ? personal.toForming
            : personal.toStable
        : 1;
    const progress = personal
        ? personal.stage === 'stable'
            ? 100
            : Math.round((personal.effectiveChars / Math.max(1, personal.effectiveChars + nextGoal)) * 100)
        : 0;
    const goalLabel =
        personal?.stage === 'collecting' ? '距成型' : personal?.stage === 'stable' ? '已稳定' : '距稳定';
    const goalText =
        personal?.stage === 'stable'
            ? '画像已稳定'
            : `还差 ${Math.max(0, nextGoal).toLocaleString()} 字`;

    // "回到从前"得先有"从前"：最新那份快照就是现在的写法，选它没有意义；
    // 也不列出没攒够一万字的那份，那时的画像本来就不可靠
    const olderSnapshots = (personal?.snapshots ?? [])
        .slice(0, -1)
        .filter((item) => item.effectiveChars >= 10000);

    return (
        <div className="space-y-3">
            {/* 上层：你自己怎么写。放在偏好前面，因为这才是"自己的风格"的来源 */}
            <div className="rounded-xl border border-ink-750 bg-ink-850 p-3">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <p className="text-[13px] text-ink-100">我的笔感</p>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-ink-500">
                            每次保存正文，只记你自己写的字，AI 原样留着的段落会被剔掉。
                            攒够 1 万字成型，5 万字稳定。
                        </p>
                    </div>
                    <button
                        type="button"
                        role="switch"
                        aria-checked={settings?.ai.personalTraceLearn ?? true}
                        onClick={() =>
                            void toggle({
                                personalTraceLearn: !(settings?.ai.personalTraceLearn ?? true),
                            })
                        }
                        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                            settings?.ai.personalTraceLearn ? 'bg-jade-500' : 'bg-ink-600'
                        }`}
                    >
                        <span
                            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
                                settings?.ai.personalTraceLearn ? 'left-4.5' : 'left-0.5'
                            }`}
                        />
                    </button>
                </div>

                {/* 注入是另一件事：可以不注入也照样攒，作者随时能停 */}
                <div className="mt-2 flex items-center justify-between gap-3 border-t border-ink-800 pt-2">
                    <div className="min-w-0">
                        <p className="text-[11px] text-ink-400">写小说时照你的写法来</p>
                        <p className="mt-0.5 text-[11px] text-ink-600">
                            {personal?.injecting
                                ? '已生效：每次对话都会带上你的笔感'
                                : '还没生效，攒够 1 万字才开始'}
                        </p>
                    </div>
                    <button
                        type="button"
                        role="switch"
                        aria-checked={settings?.ai.personalTraceInject ?? true}
                        onClick={() =>
                            void toggle({
                                personalTraceInject: !(settings?.ai.personalTraceInject ?? true),
                            })
                        }
                        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                            settings?.ai.personalTraceInject ? 'bg-jade-500' : 'bg-ink-600'
                        }`}
                    >
                        <span
                            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
                                settings?.ai.personalTraceInject ? 'left-4.5' : 'left-0.5'
                            }`}
                        />
                    </button>
                </div>

                {personal ? (
                    <div className="mt-3 space-y-3 border-t border-ink-800 pt-3">
                        <div className="grid grid-cols-3 gap-2">
                            {[
                                { label: '累计字数', value: personal.charCount.toLocaleString() },
                                { label: '人味分', value: `${personal.humanScore}` },
                                { label: '近 7 天', value: `+${personal.recentChars.toLocaleString()}` },
                            ].map((item) => (
                                <div
                                    key={item.label}
                                    className="rounded-lg border border-ink-800 bg-ink-900/40 px-2 py-2 text-center"
                                >
                                    <p className="text-[15px] font-medium text-ink-100">{item.value}</p>
                                    <p className="mt-0.5 text-[11px] text-ink-600">{item.label}</p>
                                </div>
                            ))}
                        </div>

                        <div>
                            <div className="flex items-center justify-between text-[11px] text-ink-500">
                                <span>{goalLabel}</span>
                                <span>{goalText}</span>
                            </div>
                            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-800">
                                <div
                                    className="h-full rounded-full bg-jade-500 transition-all"
                                    style={{ width: `${progress}%` }}
                                />
                            </div>
                            <p className="mt-1.5 text-[11px] text-ink-600">
                                采过 {personal.chapterCount} 章 · 你写 {personal.counts.human} 段 ·
                                你改 {personal.counts.revised} 段 · 剔掉 AI 原样{' '}
                                {personal.counts.ai} 段
                            </p>
                        </div>

                        <div className="space-y-1 rounded-lg border border-ink-800 bg-ink-900/40 px-3 py-2">
                            {describeMine(personal.trace).map((item) => (
                                <div
                                    key={item.label}
                                    className="flex items-center justify-between text-[11px]"
                                >
                                    <span className="text-ink-600">{item.label}</span>
                                    <span className="text-ink-300">{item.text}</span>
                                </div>
                            ))}
                        </div>

                        {/* 走势：只在快照够两个点时出现，一个点画不出"变化" */}
                        {personal.points.length >= 2 ? (
                            <div className="rounded-lg border border-ink-800 bg-ink-900/40 px-3 py-2">
                                <div className="flex items-center justify-between text-[11px] text-ink-500">
                                    <span>人味分走势</span>
                                    <span>{personal.points[0].at.slice(0, 10)} 起</span>
                                </div>
                                <Sparkline points={personal.points} />
                                {personal.drift ? (
                                    <div className="mt-1 space-y-0.5">
                                        <p className="text-[11px] text-ink-400">
                                            {personal.drift.headline}
                                        </p>
                                        {personal.drift.items.map((item) => (
                                            <p key={item} className="text-[11px] text-ink-600">
                                                · {item}
                                            </p>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="mt-1 text-[11px] text-ink-600">
                                        写法还没出现明显变化
                                    </p>
                                )}
                            </div>
                        ) : null}

                        {/* 回到从前：只用当时真够用的快照，收集阶段那份本来就不算数。
                            参照生效中即使历史快照都被挤掉了，也必须显示——否则作者
                            既看不到自己设了参照，也找不到取消的入口 */}
                        {olderSnapshots.length > 0 || personal.anchorAt ? (
                            <div className="rounded-lg border border-ink-800 bg-ink-900/40 px-3 py-2">
                                <div className="flex items-center justify-between text-[11px] text-ink-500">
                                    <span>
                                        {personal.anchorAt
                                            ? `正按 ${personal.anchorAt.slice(0, 10)} 的写法来`
                                            : '想找回从前的写法？'}
                                    </span>
                                    {personal.anchorAt ? (
                                        <button
                                            type="button"
                                            onClick={() => void pickAnchor(null)}
                                            disabled={busy}
                                            className="text-ink-600 hover:text-ink-300 disabled:opacity-40"
                                        >
                                            取消参照
                                        </button>
                                    ) : null}
                                </div>
                                <div className="mt-1.5 flex flex-wrap gap-1">
                                    {olderSnapshots.map((item) => {
                                            const active = personal.anchorAt === item.at;
                                            return (
                                                <button
                                                    key={item.at}
                                                    type="button"
                                                    title={`${item.at.slice(0, 10)} · 累计 ${item.effectiveChars.toLocaleString()} 字 · 人味分 ${item.humanScore}`}
                                                    onClick={() => void pickAnchor(item.at)}
                                                    disabled={busy}
                                                    className={`rounded-md border px-2 py-0.5 text-[11px] transition-colors disabled:opacity-40 ${
                                                        active
                                                            ? 'border-jade-600 bg-jade-500/10 text-jade-300'
                                                            : 'border-ink-700 text-ink-400 hover:border-ink-600 hover:text-ink-200'
                                                    }`}
                                                >
                                                    {item.at.slice(5, 10)}
                                                </button>
                                            );
                                        })}
                                </div>
                                <p className="mt-1.5 text-[11px] leading-relaxed text-ink-600">
                                    {personal.anchorAt
                                        ? '只有注入会切回那时候；上面的数字仍是现在的统计。'
                                        : '点一个日期，之后写东西就照那阵子的手感来。'}
                                </p>
                            </div>
                        ) : null}

                        {preview !== null ? (
                            <div className="space-y-1 rounded-lg border border-ink-800 bg-ink-900/40 px-3 py-2">
                                <div className="flex items-center justify-between text-[11px] text-ink-500">
                                    <span>会注入给模型的内容</span>
                                    <button
                                        type="button"
                                        onClick={() => setPreview(null)}
                                        className="text-ink-600 hover:text-ink-300"
                                    >
                                        收起
                                    </button>
                                </div>
                                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-ink-400">
                                    {preview}
                                </pre>
                            </div>
                        ) : null}

                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => void showPreview()}
                                className="rounded-lg border border-ink-700 px-2.5 py-1 text-[11px] text-ink-400 hover:border-ink-600 hover:text-ink-200"
                            >
                                看会注入什么
                            </button>
                            <button
                                type="button"
                                onClick={() => void clearPersonal()}
                                disabled={busy}
                                className="rounded-lg border border-ink-700 px-2.5 py-1 text-[11px] text-ink-400 hover:border-ink-600 hover:text-ink-200 disabled:opacity-40"
                            >
                                清空画像
                            </button>
                            <button
                                type="button"
                                onClick={() => void window.api.personal.reveal()}
                                className="rounded-lg border border-ink-700 px-2.5 py-1 text-[11px] text-ink-400 hover:border-ink-600 hover:text-ink-200"
                            >
                                打开画像目录
                            </button>
                        </div>
                    </div>
                ) : (
                    <p className="mt-3 border-t border-ink-800 pt-3 text-[11px] leading-relaxed text-ink-600">
                        还没有采到样本。写一段正文并保存，这里就会开始长。
                    </p>
                )}
            </div>

            <div className="rounded-lg border border-ink-800 bg-ink-900/50 px-3 py-2 text-[12px] leading-relaxed text-ink-500">
                你每次把 AI 写的东西改一遍，它就记下这一组「原文 → 你的改法」，下次写作时照着你的写法来。
                只在本机，不上传。刚贴进正文的内容要等一分钟，给你时间动手改。
            </div>

            {/* 两个开关分开：想留数据但先不注入，是很常见的用法 */}
            <div className="rounded-xl border border-ink-750 bg-ink-850 p-3">
                <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <p className="text-[13px] text-ink-100">学我的改法</p>
                        <p className="mt-0.5 text-[11px] text-ink-500">
                            关掉后不再记录新的改法，已有的保留
                        </p>
                    </div>
                    <button
                        type="button"
                        role="switch"
                        aria-checked={settings?.ai.preferenceLearn ?? true}
                        onClick={() => void toggle({ preferenceLearn: !(settings?.ai.preferenceLearn ?? true) })}
                        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                            settings?.ai.preferenceLearn ? 'bg-jade-500' : 'bg-ink-600'
                        }`}
                    >
                        <span
                            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
                                settings?.ai.preferenceLearn ? 'left-4.5' : 'left-0.5'
                            }`}
                        />
                    </button>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3 border-t border-ink-800 pt-3">
                    <div className="min-w-0">
                        <p className="text-[13px] text-ink-100">按我的写法来</p>
                        <p className="mt-0.5 text-[11px] text-ink-500">
                            关掉后只是不再把学到的改法发给模型
                        </p>
                    </div>
                    <button
                        type="button"
                        role="switch"
                        aria-checked={settings?.ai.preferenceInject ?? true}
                        onClick={() => void toggle({ preferenceInject: !(settings?.ai.preferenceInject ?? true) })}
                        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                            settings?.ai.preferenceInject ? 'bg-jade-500' : 'bg-ink-600'
                        }`}
                    >
                        <span
                            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
                                settings?.ai.preferenceInject ? 'left-4.5' : 'left-0.5'
                            }`}
                        />
                    </button>
                </div>
            </div>

            {/* 统计：让作者知道这东西到底有没有在学 */}
            <div className="grid grid-cols-3 gap-2">
                {[
                    { label: '学到改法', value: `${stats.revised} 条` },
                    { label: '原样保留', value: `${keepRate}%` },
                    { label: '等待对照', value: `${pending} 段` },
                ].map((item) => (
                    <div
                        key={item.label}
                        className="rounded-lg border border-ink-800 bg-ink-900/40 px-2 py-2 text-center"
                    >
                        <p className="text-[15px] font-medium text-ink-100">{item.value}</p>
                        <p className="mt-0.5 text-[11px] text-ink-600">{item.label}</p>
                    </div>
                ))}
            </div>

            {pairs.length === 0 ? (
                <p className="rounded-lg border border-ink-800 bg-ink-900/40 px-3 py-6 text-center text-[12px] leading-relaxed text-ink-500">
                    还没有学到东西。
                    <br />
                    让 AI 写一段、贴进正文，自己改一遍再保存，这里就会出现对照。
                </p>
            ) : (
                <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                    {pairs.map((pair) => (
                        <div key={pair.id} className="rounded-xl border border-ink-750 bg-ink-850 p-2.5">
                            <div className="flex items-start justify-between gap-2">
                                <span className="rounded-full bg-ink-800 px-1.5 py-0.5 text-[11px] text-ink-400">
                                    {pair.module === 'novel' ? '小说' : pair.module === 'docs' ? '文档' : '笔记'}
                                </span>
                                <button
                                    type="button"
                                    className="text-[11px] text-ink-600 hover:text-red-400"
                                    onClick={() => void removePair(pair.id)}
                                    disabled={busy}
                                >
                                    不要这条
                                </button>
                            </div>
                            {/* 对照式展示：左原文右改法不好读，做成上下两行更像"改稿痕迹" */}
                            <p className="mt-1.5 text-[12px] leading-relaxed text-ink-500 line-through decoration-ink-700">
                                {pair.ai}
                            </p>
                            <p className="mt-1 text-[12px] leading-relaxed text-ink-200">
                                {pair.author}
                            </p>
                        </div>
                    ))}
                </div>
            )}

            <div className="flex items-center justify-between gap-2 pt-1">
                <button
                    type="button"
                    className="text-[12px] text-ink-500 hover:text-ink-300"
                    onClick={() => void window.api.preference.reveal()}
                >
                    打开偏好目录
                </button>
                <button
                    type="button"
                    className="btn-outline text-[12px] disabled:opacity-40"
                    onClick={() => void clearAll()}
                    disabled={busy || pairs.length === 0}
                >
                    全部清空
                </button>
            </div>
        </div>
    );
}
