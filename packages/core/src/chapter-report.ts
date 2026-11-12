/**
 * 章节体检合并：词库闸 + 基线闸 → 一个综合分
 * 这个文件是"右侧体检面板"唯一的数据来源。
 */

import { evaluateAgainstBaseline } from './baseline';
import { runLexiconCheck, type LexiconOptions } from './lexicon/detector';
import { computeTextMetrics, roundMetrics } from './text/metrics';
import type { Baseline, ChapterReport, TextMetrics } from './types';

/** 体检输入 */
export interface ChapterReportInput {
    chapterId: string;
    title: string;
    text: string;
    /** 没有基线时传 null，界面会提示先建基线 */
    baseline: Baseline | null;
    /** 词库检测选项，可带专有名词豁免表 */
    lexiconOptions?: LexiconOptions;
}

/**
 * 计算一章的综合体检结论
 * 综合分 = 词库分 50% + 基线分 50%；没有基线时只用词库分，并保留 null 让界面提示
 * @param input 体检输入
 * @returns 章节报告
 */
export function buildChapterReport(input: ChapterReportInput): ChapterReport {
    const metrics: TextMetrics = roundMetrics(computeTextMetrics(input.text));
    const lexicon = runLexiconCheck(input.text, input.lexiconOptions);
    const baselineVerdict = input.baseline
        ? evaluateAgainstBaseline(metrics, input.baseline)
        : null;

    const score = baselineVerdict
        ? Math.round(lexicon.score * 0.5 + baselineVerdict.score * 0.5)
        : lexicon.score;

    return {
        chapterId: input.chapterId,
        title: input.title,
        charCount: metrics.charCount,
        metrics,
        lexicon,
        baseline: baselineVerdict,
        score,
        generatedAt: new Date().toISOString(),
    };
}

/**
 * 把体检结论渲染成 Markdown，写入 报告/ 目录
 * @param report 章节报告
 * @returns Markdown 文本
 */
export function renderChapterReportMarkdown(report: ChapterReport): string {
    const lines: string[] = [];
    lines.push(`# 体检报告 · ${report.title}`);
    lines.push('');
    lines.push(`- 综合分：**${report.score}**`);
    lines.push(`- 字数：${report.charCount}`);
    lines.push(`- 词库闸：${report.lexicon.score}`);
    lines.push(`- 基线闸：${report.baseline ? report.baseline.score : '未建基线'}`);
    lines.push(`- 生成时间：${report.generatedAt}`);
    lines.push('');

    lines.push('## 六维指标');
    lines.push('');
    lines.push('| 维度 | 本章 | 基线 μ | 偏离 σ | 是否出带 |');
    lines.push('|---|---|---|---|---|');
    for (const drift of report.baseline?.drifts ?? []) {
        lines.push(
            `| ${drift.label} | ${drift.value} | ${drift.mu} | ${drift.zScore} | ${
                drift.outOfBand ? '⚠️ 出带' : '正常'
            } |`,
        );
    }
    if (!report.baseline) {
        lines.push('| （未建基线） | - | - | - | - |');
    }
    lines.push('');

    lines.push('## 词库闸命中');
    lines.push('');
    const hitCategories = report.lexicon.summaries.filter((item) => item.count > 0);
    if (hitCategories.length === 0) {
        lines.push('十二类全部通过。');
    } else {
        for (const summary of hitCategories) {
            lines.push(`- ${summary.category}：${summary.count} 处（${summary.severity}）`);
        }
    }
    lines.push('');

    if (report.lexicon.findings.length > 0) {
        lines.push('### 明细');
        lines.push('');
        for (const finding of report.lexicon.findings.slice(0, 50)) {
            lines.push(`- 【${finding.category}】"${finding.snippet}" — ${finding.message}`);
        }
    }

    return lines.join('\n');
}
