/**
 * 八问大纲状态机
 * 硬规则：没答完 8 问禁止生成大纲。跳过必须记默认值，不能悄悄留空。
 */

import type { OutlineAnswer, OutlineQuestion, OutlineState } from './types';

/** 八问定义，顺序即提问顺序 */
export const OUTLINE_QUESTIONS: OutlineQuestion[] = [
    {
        id: 'genre',
        step: 1,
        question: '这本写什么赛道？',
        hint: '赛道决定读者的期待，先定这个再谈别的',
        options: ['都市日常', '玄幻升级', '仙侠修真', '历史架空', '悬疑推理', '游戏竞技'],
        defaultValue: '都市日常',
    },
    {
        id: 'cheat',
        step: 2,
        question: '金手指或核心爽点是什么？',
        hint: '读者追更的第一动力，一句话要说清',
        options: ['系统', '重生记忆', '独特天赋', '信息差', '身份底牌', '没有金手指'],
        defaultValue: '信息差',
    },
    {
        id: 'protagonist',
        step: 3,
        question: '主角的性格缺陷和动机是什么？',
        hint: '缺陷制造麻烦，动机推动行动，两者都要具体',
        options: ['自卑但固执，想证明自己', '冷漠但护短，想守住一个人', '莽撞但讲义气，想被认可'],
        defaultValue: '自卑但固执，想证明自己',
    },
    {
        id: 'cast',
        step: 4,
        question: '前 10 章有台词的角色都有谁？',
        hint: '只列会说话的，别列设定集里的路人',
        options: ['主角 + 1 个对手 + 1 个帮手', '主角 + 2 个对手', '主角 + 1 个长辈 + 1 个同龄人'],
        defaultValue: '主角 + 1 个对手 + 1 个帮手',
    },
    {
        id: 'worldview',
        step: 5,
        question: '世界观里哪些部分会影响前 10 章？',
        hint: '只写前 10 章用得上的，其余以后补',
        options: ['一个门派/公司 + 一条等级链', '一个城市 + 一条禁令', '一个封闭空间 + 一条规则'],
        defaultValue: '一个门派 + 一条等级链',
    },
    {
        id: 'vol1',
        step: 6,
        question: '第一卷的核心冲突和结局是什么？',
        hint: '冲突要能被一句话说清，结局要有一个明确的变化',
        options: ['争一个位置，最后拿到手但付出代价', '护一个人，最后护住了但暴露了底牌', '查一件事，最后查到了但真相更糟'],
        defaultValue: '争一个位置，最后拿到手但付出代价',
    },
    {
        id: 'volumes',
        step: 7,
        question: '分几卷？',
        hint: '不确定就选不分卷，后面再拆',
        options: ['不分卷', '三卷', '五卷'],
        defaultValue: '不分卷',
    },
    {
        id: 'tone',
        step: 8,
        question: '文风基调是什么？',
        hint: '这个直接影响六维基线，选完就能开始写',
        options: ['轻松诙谐', '沉稳厚重', '热血爽快', '阴郁压抑', '细腻抒情'],
        defaultValue: '热血爽快',
    },
];

/**
 * 创建初始状态
 * @returns 八问初始状态
 */
export function createOutlineState(): OutlineState {
    return { answers: {}, currentStep: 0, finished: false };
}

/**
 * 取当前应该问的问题
 * @param state 状态
 * @returns 问题定义，全部答完时返回 null
 */
export function getCurrentQuestion(state: OutlineState): OutlineQuestion | null {
    if (state.currentStep >= OUTLINE_QUESTIONS.length) {
        return null;
    }
    return OUTLINE_QUESTIONS[state.currentStep];
}

/**
 * 回答当前问题并进入下一问
 * @param state 原状态
 * @param questionId 题目 id，用于校验没有写错顺序
 * @param value 作者的答案
 * @param usedDefault 是否用了默认值跳过
 * @returns 新状态
 */
export function answerQuestion(
    state: OutlineState,
    questionId: string,
    value: string,
    usedDefault: boolean,
): OutlineState {
    const question = OUTLINE_QUESTIONS.find((item) => item.id === questionId);
    if (!question) {
        return state;
    }
    const trimmed = value.trim();
    const answer: OutlineAnswer = {
        id: questionId,
        value: trimmed.length > 0 ? trimmed : question.defaultValue,
        usedDefault: usedDefault || trimmed.length === 0,
    };
    const nextAnswers = { ...state.answers, [questionId]: answer };
    const answeredCount = OUTLINE_QUESTIONS.filter((item) => nextAnswers[item.id]).length;
    return {
        answers: nextAnswers,
        currentStep: Math.min(answeredCount, OUTLINE_QUESTIONS.length),
        finished: answeredCount === OUTLINE_QUESTIONS.length,
    };
}

/**
 * 回退到上一问，保留已填答案
 * @param state 原状态
 * @returns 新状态
 */
export function goBack(state: OutlineState): OutlineState {
    const previousStep = Math.max(0, state.currentStep - 1);
    return { ...state, currentStep: previousStep, finished: false };
}

/**
 * 检查能不能生成大纲
 * @param state 状态
 * @returns 是否可生成 + 缺哪几问
 */
export function canGenerateOutline(state: OutlineState): { ok: boolean; missing: string[] } {
    const missing = OUTLINE_QUESTIONS.filter((question) => !state.answers[question.id]).map(
        (question) => `第 ${question.step} 问：${question.question}`,
    );
    return { ok: missing.length === 0, missing };
}

/**
 * 把答案渲染成 大纲.md
 * 用默认值跳过的问题会被标注出来，作者回看时知道哪些不是自己想清楚的
 * @param state 状态
 * @param bookTitle 书名
 * @returns Markdown 文本
 */
export function renderOutlineMarkdown(state: OutlineState, bookTitle: string): string {
    const lines: string[] = [`# 《${bookTitle}》大纲`, ''];
    lines.push('> 由八问大纲生成。🟡 标记的是当时用默认值跳过的项，建议回头补。');
    lines.push('');

    for (const question of OUTLINE_QUESTIONS) {
        const answer = state.answers[question.id];
        const mark = answer?.usedDefault ? ' 🟡' : '';
        lines.push(`## ${question.step}. ${question.question}${mark}`);
        lines.push('');
        lines.push(answer?.value ?? '（未回答）');
        lines.push('');
    }

    return lines.join('\n');
}

/**
 * 把八问答案压成给 AI 的系统提示，写大纲和写正文都要用
 * @param state 状态
 * @returns 提示文本
 */
export function buildOutlinePromptBlock(state: OutlineState): string {
    const lines: string[] = ['【八问设定】'];
    for (const question of OUTLINE_QUESTIONS) {
        const answer = state.answers[question.id];
        if (!answer) {
            continue;
        }
        lines.push(`- ${question.question} ${answer.value}`);
    }
    return lines.join('\n');
}
