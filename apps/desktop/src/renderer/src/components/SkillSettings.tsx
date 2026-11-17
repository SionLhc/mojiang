import { useCallback, useEffect, useState } from 'react';
import { SKILL_MODULES, SKILL_MODULE_LABELS, type Skill } from '@mojiang/core';
import SkillToggle from '@/components/SkillToggle';
import { errorMessage } from '@/lib/format';
import { useAppStore } from '@/store/useAppStore';

/**
 * 设置里的「技能」页
 * 之前只能从 AI 对话右上角那个不起眼的「技能」文字进，作者根本找不到开关，这里补一个正门
 */
export default function SkillSettings() {
    const pushToast = useAppStore((state) => state.pushToast);
    const bumpSkills = useAppStore((state) => state.bumpSkills);
    const skillVersion = useAppStore((state) => state.skillVersion);
    const [skills, setSkills] = useState<Skill[]>([]);
    /** 正在切哪个技能，避免连点 */
    const [busyId, setBusyId] = useState('');

    const reload = useCallback(async (): Promise<void> => {
        try {
            setSkills(await window.api.skill.list());
        } catch (error) {
            pushToast('error', errorMessage(error));
        }
    }, [pushToast]);

    useEffect(() => {
        void reload();
    }, [reload, skillVersion]);

    /**
     * 切换启用状态
     * @param skill 目标技能
     */
    async function handleToggle(skill: Skill): Promise<void> {
        setBusyId(skill.id);
        try {
            await window.api.skill.toggle(skill.id, !skill.enabled);
            await reload();
            // 通知 AI 面板重拉，否则它那里还按旧状态匹配
            bumpSkills();
        } catch (error) {
            pushToast('error', errorMessage(error));
        } finally {
            setBusyId('');
        }
    }

    const enabledCount = skills.filter((skill) => skill.enabled).length;

    return (
        <div className="space-y-3">
            <div className="rounded-lg border border-ink-800 bg-ink-900/50 px-3 py-2 text-[12px] leading-relaxed text-ink-500">
                技能按「适用模块 + 触发词」生效：模块对不上不会出现，输入里没带触发词也不会用。
                同一轮只会用一个技能（触发词最长的那个）。开关即时生效，不用点保存。
            </div>

            <div className="flex items-center justify-between">
                <span className="text-[12px] text-ink-500">
                    共 {skills.length} 个，已启用 {enabledCount} 个
                </span>
                <button
                    type="button"
                    className="btn-outline text-[12px]"
                    onClick={() => void window.api.skill.reveal()}
                >
                    打开技能目录
                </button>
            </div>

            {skills.length === 0 && (
                <p className="rounded-lg border border-ink-800 px-3 py-6 text-center text-[13px] text-ink-500">
                    还没有技能。可以在 AI 对话右上角的「技能」里安装。
                </p>
            )}

            <div className="space-y-2">
                {skills.map((skill) => (
                    <div
                        key={skill.id}
                        className={`flex items-start justify-between gap-3 rounded-lg border px-3 py-2 ${
                            skill.enabled
                                ? 'border-ink-800 bg-ink-900/40'
                                : 'border-ink-850 bg-ink-900/20 opacity-70'
                        }`}
                    >
                        <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                                <span className="text-[13px] leading-none">{skill.icon ?? '🧩'}</span>
                                <span className="text-[13px] text-ink-100">{skill.name}</span>
                                {skill.modules.length === SKILL_MODULES.length ? (
                                    <span className="rounded-full bg-jade-500/10 px-1.5 py-0.5 text-[10px] text-jade-500">
                                        通用
                                    </span>
                                ) : (
                                    skill.modules.map((module) => (
                                        <span
                                            key={module}
                                            className="rounded-full bg-jade-500/10 px-1.5 py-0.5 text-[10px] text-jade-500"
                                        >
                                            {SKILL_MODULE_LABELS[module]}
                                        </span>
                                    ))
                                )}
                            </div>
                            <p className="mt-1 truncate text-[11px] text-ink-600">
                                触发词：{skill.triggers.join(' / ') || '无'}
                            </p>
                        </div>
                        <SkillToggle
                            enabled={skill.enabled}
                            busy={busyId === skill.id}
                            onToggle={() => void handleToggle(skill)}
                        />
                    </div>
                ))}
            </div>
        </div>
    );
}
