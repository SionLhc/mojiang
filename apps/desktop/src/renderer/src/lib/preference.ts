/**
 * 偏好蒸馏的渲染层入口
 * 只有一个动作：AI 文本落到正文时记一笔，之后由主进程在保存时对齐
 */

import { toSkillKind } from '@mojiang/core';
import { useAppStore } from '@/store/useAppStore';

/** 短于这个长度的片段对齐不出东西，不必记 */
const MIN_MARK_LENGTH = 20;

/**
 * 记一笔"这段是 AI 写的"
 *
 * 调用时机必须是"已经写进正文之后"：
 * 主进程会在下一次保存时拿它和定稿比，先记再写会让这次保存就把样本吃掉。
 * @param text AI 给出的文本
 */
export function markAiText(text: string): void {
    const { book, chapterId, section, settings } = useAppStore.getState();
    const trimmed = text.trim();
    if (!book || !chapterId || section !== 'zhengwen') {
        return;
    }
    // 作者关掉学习就别记，省得以后又冒出来
    if (settings && !settings.ai.preferenceLearn) {
        return;
    }
    if (trimmed.length < MIN_MARK_LENGTH) {
        return;
    }
    void window.api.preference
        .mark({ module: toSkillKind(book.kind), bookId: book.id, chapterId, text: trimmed })
        .catch(() => {
            // 学不到不影响写作，静默处理
        });
}
