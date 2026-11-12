import { useState } from 'react';
import type { ExportFormat } from '@shared/types';
import Modal from '@/components/Modal';
import { errorMessage } from '@/lib/format';
import { useAppStore } from '@/store/useAppStore';

/** 四种导出格式的说明 */
const FORMATS: Array<{
    key: ExportFormat;
    title: string;
    suffix: string;
    description: string;
}> = [
    {
        key: 'txt',
        title: 'TXT 纯文本',
        suffix: '.txt',
        description: '一行一段，带 BOM，Windows 记事本打开不乱码；投稿和发群里最省事',
    },
    {
        key: 'markdown',
        title: '按章 Markdown',
        suffix: '目录',
        description: '正文按章一个文件，连细纲、人设、账本一起带走，换机器能直接接着写',
    },
    {
        key: 'docx',
        title: 'Word 文档',
        suffix: '.docx',
        description: '宋体、首行缩进两字、每章分页，可以直接发给编辑',
    },
    {
        key: 'epub',
        title: 'EPUB 电子书',
        suffix: '.epub',
        description: '带目录，能进多看、Apple Books、Calibre 这类阅读器',
    },
];

/** 属性 */
interface ExportDialogProps {
    open: boolean;
    onClose: () => void;
}

/**
 * 导出弹窗
 * 路径一律由系统对话框决定，这里只负责选格式和组织数据
 */
export default function ExportDialog({ open, onClose }: ExportDialogProps) {
    const book = useAppStore((state) => state.book);
    const pushToast = useAppStore((state) => state.pushToast);

    const [busy, setBusy] = useState<ExportFormat | null>(null);
    const [lastPath, setLastPath] = useState('');

    if (!book) {
        return null;
    }

    /**
     * 执行一次导出
     * @param format 格式
     */
    async function handleExport(format: ExportFormat): Promise<void> {
        if (!book) {
            return;
        }
        setBusy(format);
        setLastPath('');
        try {
            const result = await window.api.export.book(book.id, format);
            if (result.ok) {
                setLastPath(result.path ?? '');
                pushToast('success', '导出完成');
            } else if (result.message !== '已取消') {
                pushToast('error', result.message);
            }
        } catch (error) {
            pushToast('error', errorMessage(error));
        } finally {
            setBusy(null);
        }
    }

    return (
        <Modal
            open={open}
            title="导出"
            subtitle={`《${book.title}》· 导出的文件不包含任何本地设置或 API Key`}
            onClose={onClose}
            widthClass="max-w-2xl"
            footer={
                <>
                    <span className="mr-auto min-w-0 truncate text-[13px] text-ink-500">
                        {lastPath ? `已写入：${lastPath}` : ''}
                    </span>
                    <button type="button" className="btn-ghost" onClick={onClose}>
                        关闭
                    </button>
                </>
            }
        >
            <div className="space-y-2">
                {FORMATS.map((item) => (
                    <button
                        type="button"
                        key={item.key}
                        onClick={() => void handleExport(item.key)}
                        disabled={busy !== null}
                        className="flex w-full items-center justify-between rounded-lg border border-ink-700 px-3 py-2.5 text-left hover:border-jade-600 hover:bg-jade-600/5 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <div className="min-w-0">
                            <p className="text-[14px] font-medium text-ink-100">
                                {item.title}
                                <span className="ml-2 text-[13px] font-normal text-ink-500">
                                    {item.suffix}
                                </span>
                            </p>
                            <p className="mt-0.5 text-[13px] leading-relaxed text-ink-500">
                                {item.description}
                            </p>
                        </div>
                        <span className="ml-3 shrink-0 text-[13px] text-jade-500">
                            {busy === item.key ? '导出中…' : '导出'}
                        </span>
                    </button>
                ))}
            </div>

            <p className="mt-3 text-[13px] leading-relaxed text-ink-600">
                纯文本会去掉 Markdown 标记（# 和 **），Word 和 EPUB 会保留章节标题层级。
                导出用的是当前磁盘上的内容，改完记得先保存。
            </p>
        </Modal>
    );
}
