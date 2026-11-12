import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import {
    EditorState,
    RangeSetBuilder,
    StateEffect,
    StateField,
    type Text,
} from '@codemirror/state';
import {
    Decoration,
    EditorView,
    drawSelection,
    dropCursor,
    highlightActiveLine,
    highlightActiveLineGutter,
    keymap,
    lineNumbers,
    placeholder,
    type DecorationSet,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';

/** 编辑器属性 */
interface MarkdownEditorProps {
    value: string;
    onChange: (value: string) => void;
    fontSize: number;
    /** 只读模式（比如查看细纲快照） */
    readOnly?: boolean;
    /** 需要标黄的行：传命中的字符偏移，内部换算成行 */
    highlightOffsets?: number[];
    /** 是否显示行号，笔记场景不需要 */
    showLineNumbers?: boolean;
}

/** frontmatter 块：从文件开头到第二个 --- */
const FRONT_MATTER_PATTERN = /^---\r?\n(?:[\s\S]*?\r?\n)?---\r?\n?/;

/**
 * 生成隐藏 frontmatter 的装饰
 * 只有块里真的含 tags 才隐藏，避免把普通的 --- 分隔线吃掉
 * @param doc 文档
 * @returns 装饰集
 */
function buildFrontMatterDecoration(doc: Text): DecorationSet {
    const head = doc.sliceString(0, Math.min(doc.length, 4000));
    const match = head.match(FRONT_MATTER_PATTERN);
    if (!match || !/tags\s*:/i.test(match[0])) {
        return Decoration.none;
    }
    return Decoration.set([Decoration.replace({ block: true }).range(0, match[0].length)]);
}

/** frontmatter 折叠：作者在标签条里改标签，正文区只显示正文 */
const frontMatterField = StateField.define<DecorationSet>({
    create: (state) => buildFrontMatterDecoration(state.doc),
    update(value, transaction) {
        if (!transaction.docChanged) {
            return value.map(transaction.changes);
        }
        return buildFrontMatterDecoration(transaction.state.doc);
    },
    provide: (field) => EditorView.decorations.from(field),
});

/** 更新命中行的副作用 */
const setIssueLines = StateEffect.define<DecorationSet>();

/** 把命中行装饰存进编辑器状态，这样滚动、编辑时不会丢 */
const issueLineField = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(decorations, transaction) {
        let next = decorations.map(transaction.changes);
        for (const effect of transaction.effects) {
            if (effect.is(setIssueLines)) {
                next = effect.value;
            }
        }
        return next;
    },
    provide: (field) => EditorView.decorations.from(field),
});

/** 语法高亮配色：米黄纸底上的墨色，对比度按浅色背景重新算过 */
const mojiangHighlight = HighlightStyle.define([
    { tag: tags.heading1, color: '#1e1a12', fontSize: '1.45em', fontWeight: '700' },
    { tag: tags.heading2, color: '#2e2618', fontSize: '1.22em', fontWeight: '600' },
    { tag: tags.heading3, color: '#4a3e2a', fontSize: '1.08em', fontWeight: '600' },
    { tag: tags.strong, color: '#1e1a12', fontWeight: '700' },
    { tag: tags.emphasis, color: '#5a4e38', fontStyle: 'italic' },
    { tag: tags.strikethrough, color: '#a2937a', textDecoration: 'line-through' },
    { tag: tags.quote, color: '#6e6047', fontStyle: 'italic' },
    { tag: tags.link, color: '#1f7a5c' },
    { tag: tags.url, color: '#19614a' },
    { tag: tags.monospace, color: '#a06818' },
    { tag: tags.comment, color: '#a2937a' },
    { tag: tags.list, color: '#6e6047' },
    { tag: tags.contentSeparator, color: '#d6c8a4' },
]);

/** 编辑器基础主题，其余外观在 index.css 里 */
const mojiangTheme = EditorView.theme(
    {
        '&': { height: '100%', backgroundColor: 'transparent', color: '#2a2419' },
        '.cm-scroller': { overflow: 'auto' },
        '.cm-gutters': { backgroundColor: 'transparent', border: 'none' },
        '.cm-line': { paddingLeft: '2px' },
    },
    { dark: false },
);

/** 编辑器对外暴露的命令式方法，供工具栏格式化按钮调用 */
export interface MarkdownEditorHandle {
    /** 用标记包裹选中文本；没选中就插入占位并选中它 */
    wrapSelection(before: string, after: string, placeholder?: string): void;
    /** 在光标所在行行首插入前缀，如 "## " */
    prefixLine(prefix: string): void;
    /** 在光标处插入一段文本 */
    insertText(text: string): void;
    /** 让编辑器拿回焦点 */
    focus(): void;
}

/**
 * Markdown 编辑器
 * 说明：CodeMirror 是非受控的，外部传进来的 value 只在"和内部文档不一致"时才覆盖，
 * 否则每敲一个字都会重建文档，光标会跳。
 */
const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
    function MarkdownEditorInner(
        { value, onChange, fontSize, readOnly, highlightOffsets, showLineNumbers = true },
        ref,
    ) {
        const hostRef = useRef<HTMLDivElement | null>(null);
        const viewRef = useRef<EditorView | null>(null);
        const onChangeRef = useRef(onChange);
        onChangeRef.current = onChange;

    useEffect(() => {
        if (!hostRef.current) {
            return;
        }

        const view = new EditorView({
            state: EditorState.create({
                doc: value,
                extensions: [
                    showLineNumbers ? lineNumbers() : [],
                    showLineNumbers ? highlightActiveLineGutter() : [],
                    history(),
                    drawSelection(),
                    dropCursor(),
                    indentOnInput(),
                    highlightActiveLine(),
                    markdown(),
                    syntaxHighlighting(mojiangHighlight),
                    mojiangTheme,
                    issueLineField,
                    frontMatterField,
                    EditorView.lineWrapping,
                    placeholder('从这里开始写正文…'),
                    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
                    EditorState.readOnly.of(Boolean(readOnly)),
                    EditorView.updateListener.of((update) => {
                        if (update.docChanged) {
                            onChangeRef.current(update.state.doc.toString());
                        }
                    }),
                ],
            }),
            parent: hostRef.current,
        });

        viewRef.current = view;

        return () => {
            view.destroy();
            viewRef.current = null;
        };
        // 只在挂载时建一次编辑器，后续靠下面的 effect 同步
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // 外部内容变化（切换章节、回滚快照）时同步进来
    useEffect(() => {
        const view = viewRef.current;
        if (!view) {
            return;
        }
        const current = view.state.doc.toString();
        if (current !== value) {
            view.dispatch({
                changes: { from: 0, to: current.length, insert: value },
            });
        }
    }, [value]);

    // 词库命中：把字符偏移换算成行号，给整行加底色
    const highlightKey = (highlightOffsets ?? []).join(',');
    useEffect(() => {
        const view = viewRef.current;
        if (!view) {
            return;
        }
        const builder = new RangeSetBuilder<Decoration>();
        const lineNumbers = new Set<number>();

        for (const offset of highlightOffsets ?? []) {
            const position = Math.min(Math.max(offset, 0), view.state.doc.length);
            lineNumbers.add(view.state.doc.lineAt(position).number);
        }

        for (const lineNumber of [...lineNumbers].sort((left, right) => left - right)) {
            const line = view.state.doc.line(lineNumber);
            builder.add(line.from, line.from, Decoration.line({ class: 'cm-issue-line' }));
        }

        view.dispatch({ effects: setIssueLines.of(builder.finish()) });
        // 用拼接后的字符串做依赖，避免父组件每次渲染新建数组导致死循环
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [highlightKey]);

    useImperativeHandle(
        ref,
        () => ({
            wrapSelection(before: string, after: string, placeholder = '文字') {
                const view = viewRef.current;
                if (!view) {
                    return;
                }
                const { from, to } = view.state.selection.main;
                const selected = view.state.sliceDoc(from, to) || placeholder;
                view.dispatch({
                    changes: { from, to, insert: `${before}${selected}${after}` },
                    selection: {
                        anchor: from + before.length,
                        head: from + before.length + selected.length,
                    },
                });
                view.focus();
            },
            prefixLine(prefix: string) {
                const view = viewRef.current;
                if (!view) {
                    return;
                }
                const { from } = view.state.selection.main;
                const line = view.state.doc.lineAt(from);
                view.dispatch({
                    changes: { from: line.from, to: line.from, insert: prefix },
                    selection: { anchor: from + prefix.length },
                });
                view.focus();
            },
            insertText(text: string) {
                const view = viewRef.current;
                if (!view) {
                    return;
                }
                const { from, to } = view.state.selection.main;
                view.dispatch({
                    changes: { from, to, insert: text },
                    selection: { anchor: from + text.length },
                });
                view.focus();
            },
            focus() {
                viewRef.current?.focus();
            },
        }),
        [],
    );

    return (
        <div
            ref={hostRef}
            className="cm-host h-full overflow-hidden"
            style={{ fontSize: `${fontSize}px` }}
        />
    );
    },
);

export default MarkdownEditor;
