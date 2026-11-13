import { useDeferredValue, useMemo, useRef, useState } from 'react';
import { activeHeadingIndex, extractHeadings, getProjectFeatures, renderMarkdownToHtml } from '@mojiang/core';
import CharacterView from '@/components/CharacterView';
import ForeshadowView from '@/components/ForeshadowView';
import Golden3View from '@/components/Golden3View';
import LedgerView from '@/components/LedgerView';
import MarkdownEditor, { type MarkdownEditorHandle } from '@/components/MarkdownEditor';
import MarketView from '@/components/MarketView';
import MaterialsView from '@/components/MaterialsView';
import MindBoardView from '@/components/MindBoardView';
import PackageView from '@/components/PackageView';
import PlotView from '@/components/PlotView';
import SensitiveView from '@/components/SensitiveView';
import StatsView from '@/components/StatsView';
import VersionDialog from '@/components/VersionDialog';
import { formatCharCount } from '@/lib/format';
import { useAppStore } from '@/store/useAppStore';

/** 编辑器区域属性 */
interface EditorPaneProps {
    focusMode: boolean;
    onToggleFocus: () => void;
}

/** 工具栏上的格式化动作 */
const FORMAT_ACTIONS: Array<{
    key: string;
    label: string;
    title: string;
    bold?: boolean;
    italic?: boolean;
    run: (editor: MarkdownEditorHandle | null) => void;
}> = [
    {
        key: 'bold',
        label: 'B',
        title: '加粗：选中文字后点这里',
        bold: true,
        run: (editor) => editor?.wrapSelection('**', '**', '粗体'),
    },
    {
        key: 'italic',
        label: 'I',
        title: '斜体：选中文字后点这里',
        italic: true,
        run: (editor) => editor?.wrapSelection('*', '*', '斜体'),
    },
    { key: 'h2', label: 'H', title: '小标题：在本行开头加 ##', run: (editor) => editor?.prefixLine('## ') },
    { key: 'quote', label: '❝', title: '引用：在本行开头加 >', run: (editor) => editor?.prefixLine('> ') },
    { key: 'list', label: '≡', title: '列表：在本行开头加 -', run: (editor) => editor?.prefixLine('- ') },
    {
        key: 'hr',
        label: '—',
        title: '分隔线',
        run: (editor) => editor?.insertText('\n\n---\n\n'),
    },
];

/**
 * 中栏：正文编辑器
 * 写作区宽度固定在 42rem，太宽会让人读串行
 */
export default function EditorPane({ focusMode, onToggleFocus }: EditorPaneProps) {
    const chapterId = useAppStore((state) => state.chapterId);
    const chapters = useAppStore((state) => state.chapters);
    const content = useAppStore((state) => state.content);
    const savedContent = useAppStore((state) => state.savedContent);
    const saving = useAppStore((state) => state.saving);
    const report = useAppStore((state) => state.report);
    const checking = useAppStore((state) => state.checking);
    const settings = useAppStore((state) => state.settings);
    const setContent = useAppStore((state) => state.setContent);
    const save = useAppStore((state) => state.save);
    const check = useAppStore((state) => state.check);
    const setDocumentTags = useAppStore((state) => state.setDocumentTags);

    const [tagInput, setTagInput] = useState('');
    const [tagEditing, setTagEditing] = useState(false);
    const [compare, setCompare] = useState(false);
    const [outline, setOutline] = useState(false);
    const [viewportLine, setViewportLine] = useState(1);
    const editorRef = useRef<MarkdownEditorHandle | null>(null);

    // 大纲数据：随内容变化重新提取标题
    const headings = useMemo(() => extractHeadings(content), [content]);
    const activeHeading = activeHeadingIndex(headings, viewportLine);

    // 对照预览：用 deferred value 让输入优先，渲染滞后一帧，长文档也不卡手
    const deferredContent = useDeferredValue(content);
    const previewHtml = useMemo(
        () => (compare ? renderMarkdownToHtml(deferredContent) : ''),
        [compare, deferredContent],
    );

    const activeView = useAppStore((state) => state.activeView);
    const book = useAppStore((state) => state.book);
    const [versionOpen, setVersionOpen] = useState(false);
    const features = getProjectFeatures(book?.kind);

    const chapter = chapters.find((item) => item.id === chapterId);
    const charCount = content.replace(/\s/g, '').length;
    const dirty = content !== savedContent;
    const fontSize = settings?.ui.fontSize ?? 17;
    const currentTags = chapter?.tags ?? [];

    /**
     * 加一个标签：先落盘正文，避免写标签时把未保存的改动覆盖掉
     */
    async function addTag(): Promise<void> {
        const tag = tagInput.trim().replace(/^#/, '');
        if (tag.length === 0 || !chapterId) {
            setTagInput('');
            return;
        }
        await save();
        const latest = useAppStore.getState().chapters.find((item) => item.id === chapterId);
        const tags = latest?.tags ?? [];
        if (!tags.includes(tag)) {
            await setDocumentTags(chapterId, [...tags, tag]);
        }
        setTagInput('');
    }

    /**
     * 去掉一个标签
     * @param tag 标签
     */
    async function removeTag(tag: string): Promise<void> {
        if (!chapterId) {
            return;
        }
        await save();
        const latest = useAppStore.getState().chapters.find((item) => item.id === chapterId);
        const tags = latest?.tags ?? [];
        await setDocumentTags(
            chapterId,
            tags.filter((item) => item !== tag),
        );
    }

    // 工具类视图直接接管中栏，不显示编辑器
    if (activeView === 'ledger') {
        return <LedgerView />;
    }
    if (activeView === 'foreshadow') {
        return <ForeshadowView />;
    }
    if (activeView === 'characters') {
        return <CharacterView />;
    }
    if (activeView === 'golden3') {
        return <Golden3View />;
    }
    if (activeView === 'package') {
        return <PackageView />;
    }
    if (activeView === 'market') {
        return <MarketView />;
    }
    if (activeView === 'plot') {
        return <PlotView />;
    }
    if (activeView === 'stats') {
        return <StatsView />;
    }
    if (activeView === 'materials') {
        return <MaterialsView />;
    }
    if (activeView === 'sensitive') {
        return <SensitiveView />;
    }
    if (activeView === 'mindboard') {
        return <MindBoardView />;
    }

    if (!chapterId) {
        return (
            <main className="flex min-w-0 flex-1 flex-col items-center justify-center bg-ink-950">
                <p className="text-sm text-ink-500">
                    左边选一篇{features.contentLabel}，或者新建一篇开始写
                </p>
                <p className="mt-2 max-w-sm text-center text-[13px] leading-relaxed text-ink-600">
                    数据全部存在本机「文档 / 墨匠」目录里，Markdown 格式，随时可以用别的编辑器打开。
                </p>
            </main>
        );
    }

    return (
        <main className="flex min-w-0 flex-1 flex-col bg-ink-950">
            <div className="flex h-11 shrink-0 items-center justify-between border-b border-ink-800 bg-ink-900 px-4">
                <div className="flex min-w-0 items-center gap-3">
                    <h2 className="truncate text-sm font-medium text-ink-100">
                        {chapter?.title ?? '未命名'}
                    </h2>
                    <span className="shrink-0 text-[13px] text-ink-500">{formatCharCount(charCount)}</span>
                    {features.health && report && (
                        <span
                            className={`shrink-0 rounded px-1.5 py-0.5 text-[13px] ${
                                report.score >= 80
                                    ? 'bg-jade-600/20 text-jade-400'
                                    : report.score >= 60
                                      ? 'bg-amber-500/20 text-amber-500'
                                      : 'bg-red-500/20 text-red-400'
                            }`}
                        >
                            体检 {report.score}
                        </span>
                    )}
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                    {features.health && (
                        <button
                            type="button"
                            className="btn-ghost text-[13px]"
                            onClick={() => void check()}
                            disabled={checking}
                        >
                            {checking ? '体检中…' : '重新体检'}
                        </button>
                    )}
                    <button
                        type="button"
                        className={`text-[13px] ${outline ? 'btn-outline text-jade-400' : 'btn-ghost'}`}
                        onClick={() => setOutline((value) => !value)}
                        title="按标题快速跳转的目录"
                    >
                        大纲
                    </button>
                    <button
                        type="button"
                        className={`text-[13px] ${compare ? 'btn-outline text-jade-400' : 'btn-ghost'}`}
                        onClick={() => setCompare((value) => !value)}
                        title="左边改 Markdown，右边看排版效果"
                    >
                        {compare ? '关闭对照' : 'MD 对照'}
                    </button>
                    <button
                        type="button"
                        className="btn-ghost text-[13px]"
                        onClick={() => setVersionOpen(true)}
                    >
                        版本
                    </button>
                    <button
                        type="button"
                        className={dirty ? 'btn-primary text-[13px]' : 'btn-outline text-[13px]'}
                        onClick={() => void save()}
                        disabled={saving || !dirty}
                    >
                        {saving ? '保存中…' : '保存 Ctrl+S'}
                    </button>
                    <button type="button" className="btn-ghost text-[13px]" onClick={onToggleFocus}>
                        {focusMode ? '退出专注' : '专注模式'}
                    </button>
                </div>
            </div>

            {/* 标签条 + 格式化按钮 */}
            <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-ink-800 bg-ink-900 px-4">
                <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
                    {currentTags.map((tag) => (
                        <span
                            key={tag}
                            className="flex shrink-0 items-center gap-0.5 rounded bg-ink-800 px-1.5 py-0.5 text-[13px] text-ink-300"
                        >
                            #{tag}
                            <button
                                type="button"
                                className="text-ink-600 hover:text-red-400"
                                onClick={() => void removeTag(tag)}
                                title="去掉这个标签"
                            >
                                ×
                            </button>
                        </span>
                    ))}
                    {tagEditing ? (
                        <input
                            className="h-6 w-24 shrink-0 rounded bg-ink-800 px-1.5 text-[13px] text-ink-100 outline-none"
                            placeholder="标签名"
                            autoFocus
                            value={tagInput}
                            onChange={(event) => setTagInput(event.target.value)}
                            onBlur={() => {
                                void addTag();
                                setTagEditing(false);
                            }}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    void addTag();
                                    setTagEditing(false);
                                }
                                if (event.key === 'Escape') {
                                    setTagInput('');
                                    setTagEditing(false);
                                }
                            }}
                        />
                    ) : (
                        <button
                            type="button"
                            className="shrink-0 rounded px-1.5 py-0.5 text-[13px] text-ink-500 hover:bg-ink-800 hover:text-ink-300"
                            onClick={() => setTagEditing(true)}
                        >
                            + 标签
                        </button>
                    )}
                </div>

                <div className="flex shrink-0 items-center gap-0.5">
                    {FORMAT_ACTIONS.map((action) => (
                        <button
                            type="button"
                            key={action.key}
                            title={action.title}
                            onClick={() => action.run(editorRef.current)}
                            className={`flex h-6 min-w-6 items-center justify-center rounded px-1 text-[14px] text-ink-400 transition-colors hover:bg-ink-800 hover:text-ink-100 ${
                                action.bold ? 'font-bold' : ''
                            } ${action.italic ? 'italic' : ''}`}
                        >
                            {action.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex min-h-0 flex-1 overflow-hidden">
                <div
                    className={`min-w-0 flex-1 overflow-hidden px-6 py-5 ${
                        compare || outline ? 'border-r border-ink-800' : ''
                    }`}
                >
                    <div className="mx-auto h-full max-w-prose">
                        <MarkdownEditor
                            ref={editorRef}
                            value={content}
                            onChange={setContent}
                            fontSize={fontSize}
                            highlightOffsets={report?.lexicon.findings.map((finding) => finding.start) ?? []}
                            showLineNumbers={features.numberedFiles}
                            onViewportLine={setViewportLine}
                        />
                    </div>
                </div>

                {compare && (
                    <div
                        className={`min-w-0 flex-1 overflow-y-auto px-6 py-5 ${
                            outline ? 'border-r border-ink-800' : ''
                        }`}
                    >
                        <div
                            className="md-preview mx-auto max-w-prose"
                            // 内容来自本机作者的 Markdown，渲染前已统一转义过 HTML 标签
                            dangerouslySetInnerHTML={{ __html: previewHtml }}
                        />
                    </div>
                )}

                {/* 大纲面板：窄栏放在最右侧，点击标题跳到对应行 */}
                {outline && (
                    <aside className="w-52 shrink-0 overflow-y-auto px-3 py-4">
                        <p className="mb-2 px-1 text-[11px] font-medium uppercase tracking-wide text-ink-500">
                            大纲
                        </p>
                        {headings.length === 0 ? (
                            <p className="px-1 text-[13px] leading-relaxed text-ink-600">
                                这篇还没有标题。用工具栏的 H 按钮加个「## 小标题」，这里就会出现目录。
                            </p>
                        ) : (
                            <nav className="flex flex-col gap-0.5">
                                {headings.map((item, index) => (
                                    <button
                                        key={`${item.line}-${item.text}`}
                                        type="button"
                                        onClick={() => {
                                            setViewportLine(item.line);
                                            editorRef.current?.scrollToLine(item.line);
                                        }}
                                        className={`truncate rounded px-1.5 py-1 text-left text-[13px] transition-colors hover:bg-ink-800 hover:text-ink-100 ${
                                            index === activeHeading
                                                ? 'bg-ink-800 font-medium text-jade-400'
                                                : item.level === 1
                                                  ? 'text-ink-100'
                                                  : item.level === 2
                                                    ? 'text-ink-300'
                                                    : 'text-ink-500'
                                        }`}
                                        style={{ paddingLeft: `${(item.level - 1) * 12 + 6}px` }}
                                        title={`第 ${item.line} 行`}
                                    >
                                        {item.text}
                                    </button>
                                ))}
                            </nav>
                        )}
                    </aside>
                )}
            </div>

            <footer className="flex h-7 shrink-0 items-center justify-between border-t border-ink-800 bg-ink-900 px-4 text-[13px] text-ink-500">
                <span>
                    {charCount} 字
                    {report ? ` · ${report.metrics.sentenceCount} 句` : ''}
                    {report ? ` · 对话 ${Math.round(report.metrics.dialogueRatio * 100)}%` : ''}
                </span>
                <span>{dirty ? '有改动，未保存' : '已保存'}</span>
            </footer>

            <VersionDialog open={versionOpen} onClose={() => setVersionOpen(false)} />
        </main>
    );
}
