import { useEffect, useRef, useState } from 'react';
import Modal from '@/components/Modal';
import { useAppStore } from '@/store/useAppStore';

/** 属性 */
interface QuickNoteDialogProps {
    open: boolean;
    onClose: () => void;
}

/**
 * 快速记录
 * 一句话记下来就走，落在「收件箱」项目里，不用先建项目
 */
export default function QuickNoteDialog({ open, onClose }: QuickNoteDialogProps) {
    const submitQuickNote = useAppStore((state) => state.submitQuickNote);
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);
    const areaRef = useRef<HTMLTextAreaElement | null>(null);

    useEffect(() => {
        if (open) {
            window.setTimeout(() => areaRef.current?.focus(), 50);
        } else {
            setText('');
        }
    }, [open]);

    /**
     * 提交
     */
    async function submit(): Promise<void> {
        if (text.trim().length === 0 || busy) {
            return;
        }
        setBusy(true);
        try {
            await submitQuickNote(text);
            setText('');
            onClose();
        } finally {
            setBusy(false);
        }
    }

    return (
        <Modal
            open={open}
            title="快速记录"
            subtitle="第一行会变成标题，内容存到「收件箱」项目里"
            onClose={onClose}
            widthClass="max-w-xl"
            footer={
                <>
                    <span className="mr-auto text-[13px] text-ink-600">Ctrl+Enter 直接保存</span>
                    <button type="button" className="btn-ghost" onClick={onClose}>
                        取消
                    </button>
                    <button
                        type="button"
                        className="btn-primary"
                        onClick={() => void submit()}
                        disabled={text.trim().length === 0 || busy}
                    >
                        {busy ? '保存中…' : '记下来'}
                    </button>
                </>
            }
        >
            <textarea
                ref={areaRef}
                className="field h-36 resize-none text-[14px] leading-relaxed"
                placeholder={'想到什么写什么…\n\n第一行会当标题'}
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                        event.preventDefault();
                        void submit();
                    }
                    if (event.key === 'Escape') {
                        onClose();
                    }
                }}
            />
        </Modal>
    );
}
