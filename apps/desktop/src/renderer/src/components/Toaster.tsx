import { useAppStore } from '@/store/useAppStore';

/** 三种提示的配色 */
const TONE: Record<string, string> = {
    info: 'border-ink-700 bg-ink-800 text-ink-200',
    success: 'border-jade-600 bg-jade-600/15 text-jade-400',
    error: 'border-red-500/60 bg-red-500/10 text-red-300',
};

/**
 * 右下角提示条
 * 所有错误都从这里出，不弹系统对话框打断写作
 */
export default function Toaster() {
    const toasts = useAppStore((state) => state.toasts);
    const dismissToast = useAppStore((state) => state.dismissToast);

    if (toasts.length === 0) {
        return null;
    }

    return (
        <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
            {toasts.map((toast) => (
                <button
                    type="button"
                    key={toast.id}
                    onClick={() => dismissToast(toast.id)}
                    className={`pointer-events-auto rounded-md border px-3 py-2 text-left text-[14px] leading-relaxed shadow-lg ${
                        TONE[toast.kind] ?? TONE.info
                    }`}
                >
                    {toast.message}
                </button>
            ))}
        </div>
    );
}
