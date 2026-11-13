import { useCallback, useEffect, useState } from 'react';
import { computeStreak, toDateKey, shiftDateKey, type WritingStats } from '@mojiang/core';
import { errorMessage } from '@/lib/format';
import { useAppStore } from '@/store/useAppStore';

/**
 * 秒数格式化成「X 小时 Y 分」
 * @param seconds 秒数
 * @returns 人话
 */
function formatDuration(seconds: number): string {
    const totalMinutes = Math.floor(seconds / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) {
        return `${hours} 小时 ${minutes} 分`;
    }
    return `${minutes} 分`;
}

/**
 * 码字统计面板
 * 今日字数、写作时长、连续天数、目标进度条，数据全部在本机统计.json
 */
export default function StatsView() {
    const pushToast = useAppStore((state) => state.pushToast);

    const [stats, setStats] = useState<WritingStats | null>(null);
    const [goalInput, setGoalInput] = useState('');

    /**
     * 读统计
     */
    const reload = useCallback(async () => {
        try {
            const next = await window.api.stats.read();
            setStats(next);
            setGoalInput(String(next.dailyGoal));
        } catch (error) {
            pushToast('error', `读统计失败：${errorMessage(error)}`);
        }
    }, [pushToast]);

    useEffect(() => {
        void reload();
    }, [reload]);

    /**
     * 改每日字数目标
     */
    async function saveGoal(): Promise<void> {
        const goal = Number(goalInput);
        if (!Number.isFinite(goal) || goal <= 0) {
            pushToast('error', '目标得是正数');
            return;
        }
        try {
            const next = await window.api.stats.setGoal(goal);
            setStats(next);
            pushToast('success', `每日目标改成 ${next.dailyGoal} 字`);
        } catch (error) {
            pushToast('error', `设目标失败：${errorMessage(error)}`);
        }
    }

    // 最近 7 天柱状图用
    const today = toDateKey();
    const recentDays = Array.from({ length: 7 }, (_unused, index) => shiftDateKey(today, index - 6));
    const todayData = stats?.days[today] ?? { chars: 0, seconds: 0 };
    const streak = stats ? computeStreak(stats.days) : 0;
    const goal = stats?.dailyGoal ?? 2000;
    const progress = Math.min(100, Math.round((todayData.chars / goal) * 100));
    const maxChars = Math.max(goal, ...recentDays.map((key) => stats?.days[key]?.chars ?? 0));

    return (
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-ink-950 px-8 py-6">
            <div className="mx-auto w-full max-w-2xl">
                <h2 className="text-lg font-medium text-ink-100">码字统计</h2>
                <p className="mt-1 text-[13px] text-ink-500">
                    按天累计，只记新增字数，删改不倒扣。数据存在本机「统计.json」。
                </p>

                {/* 三块概览 */}
                <div className="mt-5 grid grid-cols-3 gap-3">
                    <div className="rounded-lg border border-ink-750 bg-ink-900 px-4 py-3">
                        <p className="text-[13px] text-ink-500">今日字数</p>
                        <p className="mt-1 text-2xl font-medium text-ink-100">{todayData.chars}</p>
                    </div>
                    <div className="rounded-lg border border-ink-750 bg-ink-900 px-4 py-3">
                        <p className="text-[13px] text-ink-500">今日时长</p>
                        <p className="mt-1 text-2xl font-medium text-ink-100">
                            {formatDuration(todayData.seconds)}
                        </p>
                    </div>
                    <div className="rounded-lg border border-ink-750 bg-ink-900 px-4 py-3">
                        <p className="text-[13px] text-ink-500">连续天数</p>
                        <p className="mt-1 text-2xl font-medium text-ink-100">{streak} 天</p>
                    </div>
                </div>

                {/* 目标进度 */}
                <div className="mt-5 rounded-lg border border-ink-750 bg-ink-900 px-4 py-4">
                    <div className="flex items-center justify-between">
                        <p className="text-sm text-ink-200">
                            今日目标：{todayData.chars} / {goal} 字
                        </p>
                        <div className="flex items-center gap-2">
                            <input
                                className="field h-7 w-20 text-[13px]"
                                value={goalInput}
                                onChange={(event) => setGoalInput(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                        void saveGoal();
                                    }
                                }}
                            />
                            <button type="button" className="btn-outline h-7 text-[13px]" onClick={() => void saveGoal()}>
                                设为目标
                            </button>
                        </div>
                    </div>
                    {/* 进度条：达标变绿，没达标是琥珀色 */}
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-ink-800">
                        <div
                            className={`h-full rounded-full transition-all ${progress >= 100 ? 'bg-jade-500' : 'bg-amber-500'}`}
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                    <p className="mt-2 text-[13px] text-ink-500">
                        {progress >= 100
                            ? '今日目标已完成，写多少都是赚的'
                            : `还差 ${Math.max(0, goal - todayData.chars)} 字达标`}
                    </p>
                </div>

                {/* 近 7 天柱状图 */}
                <div className="mt-5 rounded-lg border border-ink-750 bg-ink-900 px-4 py-4">
                    <p className="text-sm text-ink-200">近 7 天字数</p>
                    <div className="mt-3 flex h-32 items-end gap-2">
                        {recentDays.map((key) => {
                            const chars = stats?.days[key]?.chars ?? 0;
                            const height = maxChars > 0 ? Math.max(4, Math.round((chars / maxChars) * 100)) : 4;
                            const isToday = key === today;
                            return (
                                <div key={key} className="flex flex-1 flex-col items-center gap-1">
                                    <span className="text-[11px] text-ink-500">{chars}</span>
                                    <div
                                        className={`w-full rounded-t ${isToday ? 'bg-jade-500' : 'bg-ink-700'}`}
                                        style={{ height: `${height}%` }}
                                    />
                                    <span className="text-[11px] text-ink-500">{key.slice(5)}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </main>
    );
}
