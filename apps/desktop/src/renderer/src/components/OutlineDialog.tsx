import { useEffect, useState } from 'react';
import {
    OUTLINE_QUESTIONS,
    answerQuestion,
    canGenerateOutline,
    createOutlineState,
    goBack,
    renderOutlineMarkdown,
    type OutlineState,
} from '@mojiang/core';
import Modal from '@/components/Modal';
import { errorMessage } from '@/lib/format';
import { useAppStore } from '@/store/useAppStore';

/** 八问状态的文件名 */
const OUTLINE_STATE_FILE = '八问.json';

/** 属性 */
interface OutlineDialogProps {
    open: boolean;
    onClose: () => void;
}

/**
 * 八问大纲
 * 硬规则：没答完 8 问禁止生成大纲；跳过要用默认值并记录
 */
export default function OutlineDialog({ open, onClose }: OutlineDialogProps) {
    const book = useAppStore((state) => state.book);
    const pushToast = useAppStore((state) => state.pushToast);

    const [state, setState] = useState<OutlineState>(createOutlineState());
    const [input, setInput] = useState('');

    // 打开时恢复上次进度，避免每次从头问
    useEffect(() => {
        if (!open || !book) {
            return;
        }
        void (async () => {
            try {
                const saved = await window.api.file.readJson<OutlineState | null>(
                    book.id,
                    OUTLINE_STATE_FILE,
                    null,
                );
                setState(saved ?? createOutlineState());
            } catch {
                setState(createOutlineState());
            }
        })();
    }, [open, book]);

    if (!book) {
        return null;
    }

    const question = OUTLINE_QUESTIONS[state.currentStep] ?? null;
    const check = canGenerateOutline(state);

    /**
     * 提交一题的答案，顺手落盘进度
     * @param value 答案
     * @param usedDefault 是否跳过
     */
    async function submit(value: string, usedDefault: boolean): Promise<void> {
        if (!question || !book) {
            return;
        }
        const next = answerQuestion(state, question.id, value, usedDefault);
        setState(next);
        setInput('');
        try {
            await window.api.file.writeJson(book.id, OUTLINE_STATE_FILE, next);
        } catch (error) {
            pushToast('error', errorMessage(error));
        }
    }

    /**
     * 生成大纲文档
     */
    async function generate(): Promise<void> {
        if (!book) {
            return;
        }
        const gate = canGenerateOutline(state);
        if (!gate.ok) {
            pushToast('error', `还有 ${gate.missing.length} 问没答，不能生成大纲`);
            return;
        }
        try {
            const markdown = renderOutlineMarkdown(state, book.title);
            await window.api.file.writeText(book.id, '大纲.md', markdown);
            pushToast('success', '大纲已生成：书目录下的 大纲.md');
            onClose();
        } catch (error) {
            pushToast('error', errorMessage(error));
        }
    }

    return (
        <Modal
            open={open}
            title="八问大纲"
            subtitle="一次只问一个。答完 8 问才能生成大纲，跳过的会用默认值并标黄。"
            onClose={onClose}
            footer={
                <>
                    <button type="button" className="btn-ghost" onClick={onClose}>
                        关闭
                    </button>
                    {state.currentStep > 0 && (
                        <button
                            type="button"
                            className="btn-outline"
                            onClick={() => setState(goBack(state))}
                        >
                            上一题
                        </button>
                    )}
                    <button
                        type="button"
                        className="btn-primary"
                        onClick={() => void generate()}
                        disabled={!check.ok}
                        title={check.ok ? '生成 大纲.md' : `还缺 ${check.missing.length} 问`}
                    >
                        生成大纲
                    </button>
                </>
            }
        >
            {/* 进度 */}
            <div className="mb-4 flex items-center gap-2">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-ink-800">
                    <div
                        className="h-full rounded-full bg-jade-500 transition-all"
                        style={{
                            width: `${(Object.keys(state.answers).length / OUTLINE_QUESTIONS.length) * 100}%`,
                        }}
                    />
                </div>
                <span className="text-[13px] text-ink-500">
                    {Object.keys(state.answers).length}/{OUTLINE_QUESTIONS.length}
                </span>
            </div>

            {question ? (
                <div className="space-y-4">
                    <div>
                        <p className="text-[13px] text-jade-500">第 {question.step} 问</p>
                        <h3 className="mt-1 text-base font-medium text-ink-100">{question.question}</h3>
                        <p className="mt-1 text-[13px] text-ink-500">{question.hint}</p>
                    </div>

                    <div className="grid gap-2">
                        {question.options.map((option) => (
                            <button
                                type="button"
                                key={option}
                                onClick={() => void submit(option, false)}
                                className="rounded-md border border-ink-700 px-3 py-2 text-left text-[14px] text-ink-200 hover:border-jade-600 hover:bg-jade-600/10"
                            >
                                {option}
                            </button>
                        ))}
                    </div>

                    <div>
                        <label className="label" htmlFor="outline-custom">
                            或者自己写
                        </label>
                        <div className="flex gap-2">
                            <input
                                id="outline-custom"
                                className="field"
                                placeholder="写你自己的答案，Enter 提交"
                                value={input}
                                onChange={(event) => setInput(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter' && input.trim().length > 0) {
                                        void submit(input, false);
                                    }
                                }}
                            />
                            <button
                                type="button"
                                className="btn-outline shrink-0"
                                onClick={() => void submit(input, false)}
                                disabled={input.trim().length === 0}
                            >
                                提交
                            </button>
                        </div>
                    </div>

                    <button
                        type="button"
                        className="text-[13px] text-ink-500 hover:text-ink-300"
                        onClick={() => void submit(question.defaultValue, true)}
                    >
                        跳过这一问，用默认值「{question.defaultValue}」
                    </button>
                </div>
            ) : (
                <div className="space-y-3">
                    <p className="text-[14px] text-ink-300">八问已答完，可以生成大纲了。</p>
                    <ul className="space-y-1">
                        {OUTLINE_QUESTIONS.map((item) => {
                            const answer = state.answers[item.id];
                            return (
                                <li key={item.id} className="text-[13px] text-ink-400">
                                    <span className="text-ink-500">{item.step}. </span>
                                    {answer?.value ?? '（未答）'}
                                    {answer?.usedDefault && <span className="ml-1 text-amber-500">用默认值</span>}
                                </li>
                            );
                        })}
                    </ul>
                    {!check.ok && (
                        <p className="text-[13px] text-amber-500">还缺：{check.missing.join('；')}</p>
                    )}
                </div>
            )}
        </Modal>
    );
}
