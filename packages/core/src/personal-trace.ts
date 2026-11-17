/**
 * 我的笔感（自蒸馏）
 *
 * 人味蒸馏学的是「别人怎么想」，这里学的是「你自己怎么写的」。
 * 两者素材来源完全不同：前者是上传的别人的书，后者是你自己保存的正文。
 *
 * 为什么要有这一层：一味照着别人的写法来，最后会把自己的东西磨平。
 * 自己的写法不是一次蒸馏出来的，是长期写、软件长期看着，慢慢攒出来的。
 *
 * 这里只做两件容易做错的事：
 * 1. 归属判定 —— AI 贴进正文的段落不是你的笔迹，混进画像只会让画像越来越像模型
 * 2. 只看增量 —— 同一段反复保存只算一次，否则改十遍就被算成十段
 *
 * 纯逻辑，不碰文件、不调模型，主进程与渲染层都能调用。
 */

import { splitProseBlocks } from './text/blocks';
import { bestMatch } from './text/similarity';
import { countCharacters, splitSentences } from './text/segment';
import {
    cleanStyleText,
    clicheProfile,
    computeHumanTrace,
    type HumanTrace,
} from './style';

/** 单段正文的归属 */
export type ParagraphOrigin = 'human' | 'revised' | 'ai';

/** 判定完归属的一段正文 */
export interface AttributedParagraph {
    /** 段落原文 */
    text: string;
    /** 归属：你写的、你重写的、AI 原样留着的 */
    origin: ParagraphOrigin;
    /** 计入画像的权重：1 / 0.5 / 0 */
    weight: number;
    /** 段落指纹，落盘层拿它记账，避免重复采样 */
    key: string;
}

/**
 * 相似度到这个程度算「AI 原样留着」
 * 作者只补个标点、加个"他"这种微调，仍然不是他的笔迹
 */
const SAME_THRESHOLD = 0.92;

/**
 * 低于这个分数算「跟 AI 那段没关系了」
 * 和偏好蒸馏用同一档：作者改稿常是一句里换掉一半的字，阈值太高会把真正的重写挡在外面
 */
const REVISED_THRESHOLD = 0.25;

/**
 * 重写段落按半价计入画像
 *
 * 为什么不是全价也不是零：字是作者敲的，但句子骨架还留着模型的形状，
 * 全价会把 AI 味带进画像，零价又会把最像"他改出来的样子"的部分丢掉。
 */
const REVISED_WEIGHT = 0.5;

/** 少于这么多字的段落不参与判定（"嗯。""。"看不住笔迹） */
const MIN_PARAGRAPH_CHARS = 2;

/**
 * 一次采样的最少字数
 *
 * 定得低是有意的：作者常常一次只写几十个字，门槛高了就永远采不到，
 * 而"这次采样占多少份量"由加权合并按字数自然摊薄，不会把画像带偏。
 */
const MIN_SAMPLE_CHARS = 30;

/** 画像成型字数：到这个量才算「能看出你的写法」 */
export const PERSONAL_TRACE_FORMING_CHARS = 10000;

/** 画像稳定字数：到这个量才敢把画像当示范发给模型 */
export const PERSONAL_TRACE_STABLE_CHARS = 50000;

/** 画像成熟度 */
export type PersonalTraceStage = 'collecting' | 'forming' | 'stable';

/**
 * 段落指纹
 *
 * 用 32 位 FNV-1a 算一个短指纹，只用来判"这一段是不是采过了"。
 * 故意用哈希而不是原文：档案里不该留作者的任何字。
 * @param text 段落
 * @returns 短指纹
 */
export function paragraphFingerprint(text: string): string {
    const normalized = text.replace(/\s+/g, '');
    let hash = 0x811c9dc5;
    for (let index = 0; index < normalized.length; index += 1) {
        hash ^= normalized.charCodeAt(index);
        // imul 保证在 32 位内溢出，避免 JS 浮点丢精度
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(36);
}

/**
 * 判定一段正文里哪些字是作者自己的
 *
 * 三步：先剔掉采过的段落（增量），再和 AI 原文比（归属），最后按归属给权重。
 * 用"采过的段落指纹"而不是"和上次保存的全文对比"：
 * 作者一次只存几十个字时，段落也会被正常采到，而不是拖到下次就丢了。
 * @param options 参数
 * @returns 逐段归属；采过的段落不在结果里
 */
export function attributeParagraphs(options: {
    /** 本次保存的正文 */
    finalText: string;
    /** 本章 AI 写过的文本 */
    aiTexts: string[];
    /** 已经采过的段落指纹 */
    knownKeys: string[];
}): AttributedParagraph[] {
    const known = new Set(options.knownKeys);
    const aiBlocks: string[] = [];
    for (const aiText of options.aiTexts) {
        for (const block of splitProseBlocks(cleanStyleText(aiText))) {
            if (countCharacters(block) >= MIN_PARAGRAPH_CHARS) {
                aiBlocks.push(block);
            }
        }
    }

    const result: AttributedParagraph[] = [];
    for (const block of splitProseBlocks(cleanStyleText(options.finalText))) {
        if (countCharacters(block) < MIN_PARAGRAPH_CHARS) {
            continue;
        }
        const key = paragraphFingerprint(block);
        // 采过的段落：再算一次等于把同一段反复计入画像
        if (known.has(key)) {
            continue;
        }
        const score = aiBlocks.length > 0 ? bestMatch(block, aiBlocks).score : 0;
        if (score >= SAME_THRESHOLD) {
            result.push({ text: block, origin: 'ai', weight: 0, key });
        } else if (score >= REVISED_THRESHOLD) {
            result.push({ text: block, origin: 'revised', weight: REVISED_WEIGHT, key });
        } else {
            result.push({ text: block, origin: 'human', weight: 1, key });
        }
    }
    return result;
}

/** 一次保存的采样结果 */
export interface PersonalTraceSample {
    /** 这一次算出来的痕迹 */
    trace: HumanTrace;
    /** 真实字数（参与统计的段落原文） */
    charCount: number;
    /** 加权字数：决定这次采样在画像里占多大份量 */
    effectiveChars: number;
    /** 你写的段落数 */
    humanParagraphs: number;
    /** 你重写的段落数 */
    revisedParagraphs: number;
    /** AI 原样留着、被剔掉的段落数 */
    aiParagraphs: number;
}

/**
 * 把判定结果算成一份痕迹
 * @param paragraphs 归属判定结果
 * @returns 采样；没有可用段落时返回 null
 */
export function computePersonalTrace(
    paragraphs: AttributedParagraph[],
): PersonalTraceSample | null {
    const included = paragraphs.filter((item) => item.weight > 0);
    if (included.length === 0) {
        return null;
    }
    const text = included.map((item) => item.text).join('\n');
    const charCount = countCharacters(text);
    if (charCount < MIN_SAMPLE_CHARS) {
        return null;
    }

    const clicheTotal = clicheProfile(text, charCount).reduce(
        (sum, item) => sum + item.count,
        0,
    );
    const trace = computeHumanTrace(
        text,
        splitSentences(text),
        included.map((item) => item.text),
        charCount,
        clicheTotal,
    );

    // 加权字数只用于"这次采样在累积画像里占几成"，不影响各项指标的算法
    const effectiveChars = Math.round(
        included.reduce((sum, item) => sum + countCharacters(item.text) * item.weight, 0),
    );

    return {
        trace,
        charCount,
        effectiveChars,
        humanParagraphs: paragraphs.filter((item) => item.origin === 'human').length,
        revisedParagraphs: paragraphs.filter((item) => item.origin === 'revised').length,
        aiParagraphs: paragraphs.filter((item) => item.origin === 'ai').length,
    };
}

/**
 * 判断画像成熟度
 *
 * 为什么分档：写三千字就断定"你的写法是短句多"是噪声，
 * 拿噪声去约束模型，比不约束更糟。
 * @param effectiveChars 累计加权字数
 * @returns 成熟度
 */
export function personalTraceStage(effectiveChars: number): PersonalTraceStage {
    if (effectiveChars >= PERSONAL_TRACE_STABLE_CHARS) {
        return 'stable';
    }
    return effectiveChars >= PERSONAL_TRACE_FORMING_CHARS ? 'forming' : 'collecting';
}

/**
 * 注入参数
 *
 * 为什么要分档传 stage：作者写了三千字就断定"你爱写短句"是噪声，
 * 拿噪声去约束模型比不约束更糟，所以收集阶段一律不注入。
 */
export interface PersonalPromptInput {
    /** 作者自己的画像 */
    trace: HumanTrace;
    /** 成熟度 */
    stage: PersonalTraceStage;
    /** 作者自己写过的原文片段，只有稳定阶段才给 */
    excerpts?: string[];
    /**
     * 参照时间（ISO 字符串）
     *
     * 有值时说明这不是"现在的写法"，而是作者特意指回的一段旧写法。
     * 措辞必须改口，否则模型会把旧习惯当成他现在的习惯继续沿用。
     */
    anchorAt?: string;
}

/**
 * 把比例说成人话
 * @param value 0-1 的比例
 * @returns 百分比文字
 */
function ratioText(value: number): string {
    return `${Math.round(value * 100)}%`;
}

/**
 * 把作者自己的画像翻成提示词
 *
 * 写法和人味那一层刻意不同：人味层说"人都是这样的"，这里只说"你是这样的"。
 * 所以每条规则都从画像本身推出来，画像里没有的特征不写——
 * 否则等于又拿一份通用风格盖在作者头上。
 * @param input 画像与成熟度
 * @returns 提示块；收集阶段返回空串
 */
export function personalTracePromptBlock(input: PersonalPromptInput): string {
    if (input.stage === 'collecting') {
        return '';
    }
    const trace = input.trace;
    // 指回旧写法时要改口，明说"这是从前"，
    // 否则模型会以为作者现在还这样写，等于把旧习惯固化下去
    const anchorDate = input.anchorAt ? input.anchorAt.slice(0, 10) : '';
    const lines: string[] = [
        anchorDate
            ? `这是作者 ${anchorDate} 那阵子的写法（他特意要找回这个手感，别按近期习惯来）：`
            : '作者自己的写法（这是他长期写出来的习惯，和通用风格冲突时以这里为准）：',
    ];

    // 段落节奏：画像整齐就顺着整齐写，别用通用审美硬掰
    if (trace.paragraphLengthCV >= 0.55) {
        lines.push('- 段落长短要不齐：该铺开的地方用长段，也可以一句话单独成段。');
    } else if (trace.paragraphLengthCV >= 0.4) {
        lines.push('- 段落长短有起伏就行，不要每段都差不多长。');
    } else {
        lines.push('- 他习惯段落长度比较整齐，不要为了"有节奏"刻意把段落切碎。');
    }

    if (trace.singleSentenceParagraphRatio >= 0.15) {
        lines.push('- 允许一句话就单独成段，尤其是动作刚落下的那一下。');
    }

    // 收尾：有人爱收束，有人爱留空，两种都算他的写法
    if (trace.summaryEndingRatio >= 0.5) {
        lines.push('- 他常在段末补一句收束或感受，保持这个收口。');
    } else if (trace.summaryEndingRatio < 0.3) {
        lines.push('- 不要在每段末尾都收一句感慨或总结，很多段落说到一半就可以停。');
    }

    if (trace.transitionPerThousand < 1.5) {
        lines.push('- 少用"然后、于是、接着、与此同时"这类衔接词，让段落直接跳过去。');
    }

    if (trace.abstractFeelingPerThousand < 1.0) {
        lines.push(
            '- 少写"一种说不出的感觉"这类抽象概括，只写看得见的动作、声音和物件。',
        );
    }

    if (trace.unfinishedSentenceRatio >= 0.08) {
        lines.push('- 允许句子用省略号或破折号收尾，不必把话说完。');
    }

    // 示范只给稳定阶段：早期样本还看不出手感，给了反而带偏
    //
    // 指回旧写法时一律不给：手边只有当下的章节，
    // 拿"现在的字"当"从前的示范"自相矛盾，旧章节也可能已经改过稿。
    const excerpts =
        input.stage === 'stable' && !anchorDate ? (input.excerpts ?? []).slice(0, 3) : [];
    if (excerpts.length > 0) {
        lines.push('下面几段是他自己以前写的，只照着这个手感写，不要照抄内容：');
        excerpts.forEach((excerpt, index) => {
            lines.push(`示范 ${index + 1}：${excerpt}`);
        });
    }

    return lines.join('\n');
}

/** 一个时间点的画像快照，用来比对写法有没有变 */
export interface TraceSnapshot {
    /** 时间，ISO 字符串 */
    at: string;
    /** 当时累计的加权字数 */
    effectiveChars: number;
    /** 当时的画像 */
    trace: HumanTrace;
}

/** 写法漂移的白话总结 */
export interface PersonalDriftSummary {
    /** 一句话总述 */
    headline: string;
    /** 逐条变化 */
    items: string[];
}

/**
 * 比对首尾两份快照，说清写法变在哪
 *
 * 为什么只比首尾：中间点抖一下多半是换题材、写对白多，
 * 恰恰是首尾拉开的差距才叫"写久了变了"。
 * @param snapshots 快照，按时间升序
 * @returns 总结；不足两份或没有变化时返回 null
 */
export function summarizeDrift(snapshots: TraceSnapshot[]): PersonalDriftSummary | null {
    if (snapshots.length < 2) {
        return null;
    }
    const first = snapshots[0];
    const last = snapshots[snapshots.length - 1];
    const items: string[] = [];

    /** 比例项的变化描述 */
    const pushRatio = (label: string, before: number, after: number): void => {
        if (Math.abs(after - before) < 0.05) {
            return;
        }
        const direction = after > before ? '变多了' : '变少了';
        items.push(`${label} ${ratioText(before)} → ${ratioText(after)}，${direction}`);
    };
    /** 系数项的变化描述 */
    const pushValue = (
        label: string,
        before: number,
        after: number,
        step: number,
        unit: string,
    ): void => {
        if (Math.abs(after - before) < step) {
            return;
        }
        const direction = after > before ? '变大了' : '变小了';
        items.push(`${label} ${before}${unit} → ${after}${unit}，${direction}`);
    };

    pushValue('段长波动', first.trace.paragraphLengthCV, last.trace.paragraphLengthCV, 0.1, '');
    pushRatio(
        '单句成段',
        first.trace.singleSentenceParagraphRatio,
        last.trace.singleSentenceParagraphRatio,
    );
    pushRatio('段末收尾', first.trace.summaryEndingRatio, last.trace.summaryEndingRatio);
    pushValue(
        '衔接词',
        first.trace.transitionPerThousand,
        last.trace.transitionPerThousand,
        0.5,
        ' 次/千字',
    );
    pushValue(
        '抽象概括',
        first.trace.abstractFeelingPerThousand,
        last.trace.abstractFeelingPerThousand,
        0.5,
        ' 次/千字',
    );

    if (items.length === 0) {
        return null;
    }
    return {
        headline: `从 ${first.at.slice(0, 10)} 到现在，写法有 ${items.length} 处变化`,
        items,
    };
}
