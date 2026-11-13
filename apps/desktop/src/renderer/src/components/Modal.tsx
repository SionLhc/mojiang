import type { ReactNode } from 'react';

/** 模态框属性 */
interface ModalProps {
    open: boolean;
    title: string;
    subtitle?: string;
    onClose: () => void;
    children: ReactNode;
    footer?: ReactNode;
    /** 宽度类，默认 max-w-2xl */
    widthClass?: string;
}

/**
 * 通用模态框
 * 不引第三方弹窗库：遮罩 + 居中卡片，行为简单可控
 */
export default function Modal({
    open,
    title,
    subtitle,
    onClose,
    children,
    footer,
    widthClass = 'max-w-2xl',
}: ModalProps) {
    if (!open) {
        return null;
    }

    return (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink-600/30 p-6 backdrop-blur-[2px]">
            <div
                className={`flex max-h-full w-full ${widthClass} flex-col overflow-hidden rounded-xl border border-ink-700 bg-ink-900 shadow-2xl`}
            >
                <div className="flex shrink-0 items-start justify-between border-b border-ink-800 px-5 py-4">
                    <div>
                        <h2 className="text-sm font-semibold text-ink-100">{title}</h2>
                        {subtitle && <p className="mt-1 text-[13px] text-ink-500">{subtitle}</p>}
                    </div>
                    <button
                        type="button"
                        className="text-lg leading-none text-ink-500 hover:text-ink-200"
                        onClick={onClose}
                        title="关闭"
                    >
                        ×
                    </button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

                {footer && (
                    <div className="flex shrink-0 items-center justify-end gap-2 border-t border-ink-800 px-5 py-3">
                        {footer}
                    </div>
                )}
            </div>
        </div>
    );
}
