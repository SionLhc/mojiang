/** 属性 */
interface SkillToggleProps {
    /** 当前是否启用 */
    enabled: boolean;
    /** 正在请求主进程，先别让连点 */
    busy?: boolean;
    /** 点击切换 */
    onToggle: () => void;
}

/**
 * 技能启停开关
 * 之前用的是一个圆角文字标签，看起来像状态不像按钮，作者找不到开关；
 * 这里换成滑轨样式，一眼就知道能点
 * @param props 见 SkillToggleProps
 */
export default function SkillToggle({ enabled, busy, onToggle }: SkillToggleProps) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={onToggle}
            disabled={busy}
            title={enabled ? '点一下停用，停用后不再自动生效' : '点一下启用'}
            className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] transition-colors disabled:opacity-50 ${
                enabled
                    ? 'border-jade-500/40 bg-jade-500/10 text-jade-500'
                    : 'border-ink-700 bg-ink-800 text-ink-500 hover:text-ink-300'
            }`}
        >
            {/* 滑轨本体：圆点左右移动表示开关状态 */}
            <span
                className={`relative inline-block h-3 w-6 rounded-full transition-colors ${
                    enabled ? 'bg-jade-500' : 'bg-ink-600'
                }`}
            >
                <span
                    className={`absolute top-0.5 inline-block h-2 w-2 rounded-full bg-white transition-all ${
                        enabled ? 'left-3.5' : 'left-0.5'
                    }`}
                />
            </span>
            {enabled ? '已启用' : '已停用'}
        </button>
    );
}
