/**
 * 技能输出校验器
 *
 * 思路：模型输出不可全信，技能里声明的校验规则（字数、禁用词、解释腔等）
 * 在流式结束后跑一遍；不合格就把失败原因拼成一句"重试提示"再发一轮。
 * 最多重试 2 次，避免无限循环烧钱。
 *
 * 这里只做纯文本判断，不调用模型，所以又快又免费。
 */

import type { SkillChecker } from './skill';

/** 一条校验失败 */
export interface CheckerFailure {
    /** 失败的校验器类型 */
    type: string;
    /** 给作者和模型看的原因 */
    message: string;
}

/** 允许的自动重试次数上限 */
export const MAX_SKILL_RETRY = 2;

/** 解释腔开场白：出现在开头就是"以下是..."这类多余话 */
const EXPLANATION_PREFIX = /^(?:以下|下面|好的|当然|这是|这里是|根据)[^。\n]{0,20}[：:，,。\n]/;

/** 解释腔结尾：AI 客套话 */
const EXPLANATION_TAILS = [
    '希望对你有帮助',
    '希望这个回答',
    '如需修改',
    '如果你需要',
    '可以继续告诉我',
    '以上就是',
];

/**
 * 统计正文长度，去掉首尾空白
 * @param text 文本
 * @returns 字符数
 */
function countChars(text: string): number {
    return text.trim().length;
}

/**
 * 统计段落数（非空行块）
 * @param text 文本
 * @returns 段落数
 */
function countParagraphs(text: string): number {
    return text
        .split(/\n\s*\n/)
        .map((item) => item.trim())
        .filter((item) => item.length > 0).length;
}

/**
 * 执行单条校验规则
 * @param text 模型输出
 * @param checker 规则
 * @returns 失败信息，通过返回 null
 */
function runChecker(text: string, checker: SkillChecker): CheckerFailure | null {
    const trimmed = text.trim();

    if (checker.type === 'minChars') {
        const limit = typeof checker.value === 'number' ? checker.value : 0;
        if (countChars(trimmed) < limit) {
            return { type: checker.type, message: `${checker.message}（要求至少 ${limit} 字，实际 ${countChars(trimmed)} 字）` };
        }
        return null;
    }

    if (checker.type === 'maxChars') {
        const limit = typeof checker.value === 'number' ? checker.value : 0;
        if (limit > 0 && countChars(trimmed) > limit) {
            return { type: checker.type, message: `${checker.message}（要求不超过 ${limit} 字，实际 ${countChars(trimmed)} 字）` };
        }
        return null;
    }

    if (checker.type === 'forbiddenWords') {
        const words = Array.isArray(checker.value) ? checker.value : [];
        const hit = words.filter((word) => word.length > 0 && trimmed.includes(word));
        if (hit.length > 0) {
            return { type: checker.type, message: `${checker.message}（出现了：${hit.join('、')}）` };
        }
        return null;
    }

    if (checker.type === 'mustInclude') {
        const words = Array.isArray(checker.value) ? checker.value : [];
        const missing = words.filter((word) => word.length > 0 && !trimmed.includes(word));
        if (missing.length > 0) {
            return { type: checker.type, message: `${checker.message}（缺少：${missing.join('、')}）` };
        }
        return null;
    }

    if (checker.type === 'noExplanation') {
        if (EXPLANATION_PREFIX.test(trimmed)) {
            return { type: checker.type, message: `${checker.message}（开头有解释性开场白）` };
        }
        const tail = EXPLANATION_TAILS.find((item) => trimmed.includes(item));
        if (tail) {
            return { type: checker.type, message: `${checker.message}（结尾有客套话：${tail}）` };
        }
        return null;
    }

    if (checker.type === 'paragraphs') {
        const limit = typeof checker.value === 'number' ? checker.value : 0;
        if (limit > 0 && countParagraphs(trimmed) < limit) {
            return { type: checker.type, message: `${checker.message}（要求至少 ${limit} 段，实际 ${countParagraphs(trimmed)} 段）` };
        }
        return null;
    }

    return null;
}

/**
 * 跑一遍技能声明的全部校验规则
 * @param text 模型输出
 * @param checkers 规则列表
 * @returns 失败列表；全部通过返回空数组
 */
export function validateSkillOutput(text: string, checkers: SkillChecker[]): CheckerFailure[] {
    const failures: CheckerFailure[] = [];
    for (const checker of checkers) {
        const failure = runChecker(text, checker);
        if (failure) {
            failures.push(failure);
        }
    }
    return failures;
}

/**
 * 把失败原因拼成给模型的修正指令
 * 站在作者角度说清楚"哪条没过、怎么改"，模型才知道重写方向
 * @param failures 校验失败列表
 * @returns 重试提示（直接作为用户消息发出去）
 */
export function buildRetryPrompt(failures: CheckerFailure[]): string {
    const lines = ['上一次输出没有通过校验，原因如下：'];
    failures.forEach((failure, index) => {
        lines.push(`${index + 1}. ${failure.message}`);
    });
    lines.push('请只输出修改后的正文本身，不要解释、不要道歉、不要复述要求。');
    return lines.join('\n');
}
