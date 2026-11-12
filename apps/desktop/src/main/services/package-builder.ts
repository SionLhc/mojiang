/**
 * 开写包组装
 * 规划书的硬要求：取不到的项必须说明原因和补救方法，不许编。
 * 所以这里的每个 slot 要么有真内容，要么缺着——没有"猜一个填进去"。
 */

import {
    assembleWritingPackage,
    computeTextMetrics,
    DIMENSION_KEYS,
    DIMENSION_LABELS,
    runLexiconCheck,
    summarizeLedger,
    summarizePendingForeshadows,
    type Baseline,
    type ForeshadowFile,
    type LedgerFile,
    type WritingPackage,
} from '@mojiang/core';
import { listChapters, listFiles, readChapter, readJsonFile, readTextFile } from './content';
import { readBookMeta } from './library';
import { loadSettings } from './settings';

/** 上一章取多少字作为承接口 */
const PREVIOUS_TAIL_LENGTH = 300;
/** 风格样本取自基线章的多少字 */
const STYLE_SAMPLE_LENGTH = 400;

/**
 * 取文本末尾若干字
 * @param text 文本
 * @param length 长度
 * @returns 截断后的文本
 */
function takeTail(text: string, length: number): string {
    const trimmed = text.trim();
    return trimmed.length <= length ? trimmed : trimmed.slice(trimmed.length - length);
}

/**
 * 把基线渲染成一行行可读的说明
 * @param baseline 基线
 * @returns 文本
 */
function renderBaselineSummary(baseline: Baseline): string {
    const lines = DIMENSION_KEYS.map((key) => {
        const stat = baseline.dimensions[key];
        return `- ${DIMENSION_LABELS[key]}：${stat.mu}（波动 ±${stat.sigma}）`;
    });
    return `取样 ${baseline.sampleChapters.length} 章\n${lines.join('\n')}`;
}

/**
 * 给"人物卡"挑出本章出场的人
 * 判断依据只有名字是否出现在本章或上一章正文里，宁可多带不可漏带
 * @param bookId 书 id
 * @param texts 需要检索的正文
 * @returns 命中的人设卡 Markdown
 */
async function collectAppearedCharacters(bookId: string, texts: string[]): Promise<string> {
    const files = await listFiles(bookId, '人设', '.md');
    const picked: string[] = [];

    for (const file of files) {
        const name = file.replace(/\.md$/, '');
        const appeared = texts.some((text) => text.includes(name));
        if (!appeared) {
            continue;
        }
        const markdown = await readTextFile(bookId, `人设/${file}`);
        if (markdown.trim().length > 0) {
            picked.push(markdown.trim());
        }
    }

    return picked.join('\n\n---\n\n');
}

/**
 * 从账本里挑出时间线相关字段
 * @param ledger 账本
 * @returns 文本
 */
function pickTimeline(ledger: LedgerFile): string {
    const lines: string[] = [];
    for (const [subject, state] of Object.entries(ledger.tree)) {
        const value = state['时间'] ?? state['时间线'] ?? state['当前时间'];
        if (value) {
            lines.push(`- ${subject}：${value}`);
        }
    }
    return lines.join('\n');
}

/**
 * 从账本里挑出连续性相关字段（地点、伤势、状态）
 * @param ledger 账本
 * @returns 文本
 */
function pickContinuity(ledger: LedgerFile): string {
    const lines: string[] = [];
    const keys = ['地点', '位置', '伤势', '状态', '持有'];
    for (const [subject, state] of Object.entries(ledger.tree)) {
        const pairs = keys
            .filter((key) => state[key])
            .map((key) => `${key}=${state[key]}`);
        if (pairs.length > 0) {
            lines.push(`- ${subject}：${pairs.join('，')}`);
        }
    }
    return lines.join('\n');
}

/**
 * 现场跑一次上一章的体检，生成"上次体检结论"
 * 为什么不读报告文件：报告未必要落盘，本地重算更可靠也更快
 * @param text 上一章正文
 * @param properNouns 专有名词
 * @returns 摘要
 */
function buildLastReport(text: string, properNouns: string[]): string {
    const metrics = computeTextMetrics(text);
    const lexicon = runLexiconCheck(text, { properNouns });
    const hits = lexicon.summaries
        .filter((item) => item.count > 0)
        .map((item) => `${item.category} ${item.count} 处`);
    return [
        `上一章 ${metrics.charCount} 字，${metrics.sentenceCount} 句，对话占比 ${Math.round(
            metrics.dialogueRatio * 100,
        )}%`,
        `词库闸 ${lexicon.score} 分，${hits.length > 0 ? hits.join('、') : '十二类全部通过'}`,
    ].join('\n');
}

/**
 * 组装一本书某一章的开写包
 * @param bookId 书 id
 * @param chapterId 章节 id
 * @returns 开写包
 */
export async function buildWritingPackage(bookId: string, chapterId: string): Promise<WritingPackage> {
    const meta = readBookMeta(bookId);
    const settings = loadSettings();
    const chapters = await listChapters(bookId, 'zhengwen');
    const index = chapters.findIndex((item) => item.id === chapterId);
    const currentIndex = index >= 0 ? index : chapters.length;
    const currentNumber = chapters[index]?.index ?? currentIndex + 1;
    const previous = index > 0 ? chapters[index - 1] : null;

    const currentText = index >= 0 ? await readChapter(bookId, 'zhengwen', chapterId) : '';
    const previousText = previous ? await readChapter(bookId, 'zhengwen', previous.id) : '';

    const ledger = await readJsonFile<LedgerFile>(bookId, '账本.json', { tree: {}, history: [] });
    const foreshadow = await readJsonFile<ForeshadowFile>(bookId, '伏笔.json', { items: [] });
    const baseline = await readJsonFile<Baseline | null>(bookId, '基线.json', null);

    const properNouns = [...Object.keys(ledger.tree)];

    /** 组装用的输入，只有取到才塞进去 */
    const input: Record<string, string> = {};

    if (previous) {
        const tail = takeTail(previousText, PREVIOUS_TAIL_LENGTH);
        if (tail.length > 0) {
            input.previousTail = `（${previous.title} 结尾 ${tail.length} 字）\n${tail}`;
        }
        const paragraphs = previousText.split('\n').filter((line) => line.trim().length > 0);
        const lastParagraph = paragraphs[paragraphs.length - 1];
        if (lastParagraph) {
            input.hook = lastParagraph.trim();
        }
        input.lastReport = buildLastReport(previousText, properNouns);
    }

    const beatSheet = await readTextFile(bookId, `细纲/${chapterId}.md`);
    if (beatSheet.trim().length > 0) {
        input.beatSheet = beatSheet.trim();
    }

    const characters = await collectAppearedCharacters(bookId, [currentText, previousText]);
    if (characters.length > 0) {
        input.characters = characters;
    }

    if (foreshadow.items.length > 0) {
        const pending = summarizePendingForeshadows(foreshadow, currentNumber);
        if (pending !== '（没有待回收的伏笔）') {
            input.foreshadows = pending;
        }
    }

    if (Object.keys(ledger.tree).length > 0) {
        input.ledger = summarizeLedger(ledger);
        const timeline = pickTimeline(ledger);
        if (timeline.length > 0) {
            input.timeline = timeline;
        }
        const continuity = pickContinuity(ledger);
        if (continuity.length > 0) {
            input.continuity = continuity;
        }
    }

    if (baseline) {
        input.baseline = renderBaselineSummary(baseline);
    }

    const anchor = await readTextFile(bookId, '锚段.md');
    if (anchor.trim().length > 0) {
        input.anchor = anchor.trim();
    }

    // 风格样本：从基线取样的第一章开头截一段，标注来源，作者能判断该不该用
    if (baseline && baseline.sampleChapters.length > 0) {
        const sampleChapter = baseline.sampleChapters[0];
        const sampleText = await readChapter(bookId, 'zhengwen', sampleChapter);
        if (sampleText.trim().length > 0) {
            input.styleSample = `（取自第 ${sampleChapter} 章开头）\n${sampleText
                .trim()
                .slice(0, STYLE_SAMPLE_LENGTH)}`;
        }
    }

    if (settings.writing.forbiddenWords.length > 0) {
        input.forbiddenWords = settings.writing.forbiddenWords.join('、');
    }
    if (settings.writing.checklist.length > 0) {
        input.checklist = settings.writing.checklist.map((line) => `- ${line}`).join('\n');
    }

    const wordTarget = meta?.chapterWordTarget ?? settings.writing.chapterWordTarget;
    const perspective = settings.writing.perspective === 'first' ? '第一人称' : '第三人称';
    input.constraints = `单章字数目标 ${wordTarget} 字；${perspective}叙事；这是第 ${currentNumber} 章`;

    return assembleWritingPackage(input);
}
