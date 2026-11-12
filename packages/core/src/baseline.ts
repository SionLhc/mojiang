/**
 * 六维基线：用作者自己认可的章节建立 μ±σ，偏离 1.5σ 就出带。
 * 关键约束：正在检查的章永远不进取样，否则自己和自己比永远合格。
 */

import {
    DIMENSION_KEYS,
    DIMENSION_LABELS,
    type Baseline,
    type BaselineVerdict,
    type DimensionBaseline,
    type DimensionDrift,
    type DimensionValues,
    type TextMetrics,
} from './types';

/** 出带阈值，单位是标准差 */
export const DRIFT_SIGMA = 1.5;

/** 建基线至少需要几章，少于这个数量界面要提示"样本不足" */
export const MIN_BASELINE_SAMPLES = 3;

/** 一章的取样输入 */
export interface MetricSample {
    chapterId: string;
    metrics: TextMetrics;
}

/**
 * 从完整指标里挑出六个维度
 * @param metrics 完整指标
 * @returns 六维数值
 */
export function toDimensions(metrics: TextMetrics): DimensionValues {
    return {
        syntaxComplexity: metrics.syntaxComplexity,
        modifierDensity: metrics.modifierDensity,
        abstraction: metrics.abstraction,
        actionDensity: metrics.actionDensity,
        uncertainty: metrics.uncertainty,
        blankSpace: metrics.blankSpace,
    };
}

/**
 * 计算总体标准差
 * @param values 样本值
 * @param mean 均值
 * @returns 标准差
 */
function standardDeviation(values: number[], mean: number): number {
    if (values.length === 0) {
        return 0;
    }
    const variance =
        values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    return Math.sqrt(variance);
}

/**
 * 把 sigma 兜一个下限
 * 如果作者三章几乎一模一样，sigma 会接近 0，任何微小变化都会被判出带
 * @param mu 均值
 * @param sigma 原始标准差
 * @returns 可用的标准差
 */
function stabilizeSigma(mu: number, sigma: number): number {
    const floor = Math.max(Math.abs(mu) * 0.08, 0.5);
    return sigma < floor ? floor : sigma;
}

/**
 * 用若干章样本建立基线
 * @param samples 取样章节
 * @returns 基线
 */
export function computeBaseline(samples: MetricSample[]): Baseline {
    const dimensions = {} as Record<(typeof DIMENSION_KEYS)[number], DimensionBaseline>;

    for (const key of DIMENSION_KEYS) {
        const values = samples.map((sample) => sample.metrics[key]);
        const mu = values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
        const sigma = stabilizeSigma(mu, standardDeviation(values, mu));
        dimensions[key] = {
            mu: Math.round(mu * 100) / 100,
            sigma: Math.round(sigma * 100) / 100,
            sampleCount: values.length,
        };
    }

    return {
        sampleChapters: samples.map((sample) => sample.chapterId),
        dimensions,
        updatedAt: new Date().toISOString(),
    };
}

/**
 * 基线闸：把一章六维和基线对比，找出出带的维度
 * @param metrics 待检章节指标
 * @param baseline 已有基线
 * @param threshold 出带阈值，默认 1.5 sigma
 * @returns 基线闸结论
 */
export function evaluateAgainstBaseline(
    metrics: TextMetrics,
    baseline: Baseline,
    threshold: number = DRIFT_SIGMA,
): BaselineVerdict {
    const drifts: DimensionDrift[] = [];
    let deduction = 0;

    for (const key of DIMENSION_KEYS) {
        const stat = baseline.dimensions[key];
        const value = metrics[key];
        const sigma = stat.sigma > 0 ? stat.sigma : 1;
        const zScore = (value - stat.mu) / sigma;
        const outOfBand = Math.abs(zScore) > threshold;
        if (outOfBand) {
            // 出带越远扣分越多，单维最多扣 25 分，避免一个维度毁掉整章
            deduction += Math.min(25, (Math.abs(zScore) - threshold) * 15);
        }
        drifts.push({
            key,
            label: DIMENSION_LABELS[key],
            value: Math.round(value * 100) / 100,
            mu: stat.mu,
            sigma: stat.sigma,
            zScore: Math.round(zScore * 100) / 100,
            outOfBand,
        });
    }

    const score = Math.max(0, Math.min(100, Math.round(100 - deduction)));

    return {
        score,
        drifts,
        outOfBandKeys: drifts.filter((drift) => drift.outOfBand).map((drift) => drift.key),
    };
}

/**
 * 生成一句人话解释，界面直接展示
 * @param drift 单维偏离
 * @returns 解释文字
 */
export function describeDrift(drift: DimensionDrift): string {
    const direction = drift.zScore > 0 ? '高于' : '低于';
    return `${drift.label} ${drift.value}，${direction}你的基线 ${drift.mu}（偏离 ${Math.abs(drift.zScore)}σ）`;
}
