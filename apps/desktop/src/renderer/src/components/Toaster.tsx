import { useAppStore } from '@/store/useAppStore';

/** 三种提示的配色：只用一个色点区分，不整块染色 */
const TONE: Record<string, { dot: string; icon: string }> = {
    info: { dot: 'bg-ink-500', icon: 'i' },
    success: { dot: 'bg-jade-500', icon: '✓' },
    error: { dot: 'bg-red-500', icon: '!' },
};

/**
 * 顶部居中的提示条
 * 放在顶部是为了不压住底部输入区和发送按钮；
 * 样式做轻，只用一个色点表示类型，不整块上色
 */
export default function Toaster() {
    const toasts = useAppStore((state) => state.toasts);
    const dismissToast = useAppStore((state) => state.dismissToast);

    if (toasts.length === 0) {
        return null;
    }

    return (
        <div className="pointer-events-none fixed left-1/2 top-12 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
            {toasts.map((toast) => {
                const tone = TONE[toast.kind] ?? TONE.info;
                return (
                    <button
                        type="button"
                        key={toast.id}
                        onClick={() => dismissToast(toast.id)}
                        title="点击关闭"
                        className="pointer-events-auto flex max-w-[420px] items-start gap-2 rounded-lg border border-ink-750 bg-ink-900 px-3 py-2 text-left text-[14px] leading-relaxed text-ink-200 shadow-lg"
                        style={{ animation: 'toast-in 220ms cubic-bezier(0.2, 0.9, 0.3, 1) both' }}
                    >
                        <span
                            className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${tone.dot}`}
                            aria-hidden
                        />
                        <span className="min-w-0">{toast.message}</span>
                    </button>
                );
            })}
        </div>
    );
}
