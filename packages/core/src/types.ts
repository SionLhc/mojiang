/**
 * 墨匠核心类型定义
 * 这里只放纯数据结构和纯函数所需的类型，不引用任何 Node / Electron API，
 * 保证这个包将来可以独立成 npm 包、CLI 或网页版复用。
 */

/** 六维指标的固定键名顺序，用于雷达图与基线比较 */
export const DIMENSION_KEYS = [
    'syntaxComplexity',
    'modifierDensity',
    'abstraction',
    'actionDensity',
    'uncertainty',
    'blankSpace',
] as const;

export type DimensionKey = (typeof DIMENSION_KEYS)[number];

/** 维度中文名，界面直接展示，避免每处写映射 */
export const DIMENSION_LABELS: Record<DimensionKey, string> = {
    syntaxComplexity: '句法复杂度',
    modifierDensity: '修饰密度',
    abstraction: '抽象度',
    actionDensity: '动作密度',
    uncertainty: '不确定性',
    blankSpace: '留白指数',
};

/** 章节体检得到的六维数值 */
export type DimensionValues = Record<DimensionKey, number>;

/** 一次文本分析结果 */
export interface TextMetrics extends DimensionValues {
    /** 正文字数（不含空白） */
    charCount: number;
    /** 句子数 */
    sentenceCount: number;
    /** 对话行字数占比 0-1 */
    dialogueRatio: number;
}

/** 单维基线：均值 mu、标准差 sigma、参与计算的样本章数 */
export interface DimensionBaseline {
    mu: number;
    sigma: number;
    sampleCount: number;
}

/** 一本书的六维基线 */
export interface Baseline {
    /** 记录该基线由哪些章节取样得出，便于作者回溯 */
    sampleChapters: string[];
    dimensions: Record<DimensionKey, DimensionBaseline>;
    updatedAt: string;
}

/** 单维偏离判定结果 */
export interface DimensionDrift {
    key: DimensionKey;
    label: string;
    value: number;
    mu: number;
    sigma: number;
    /** 偏离了几个 sigma，正数表示高于基线 */
    zScore: number;
    /** 是否超出 ±1.5 sigma */
    outOfBand: boolean;
}

/** 一章的基线闸结论 */
export interface BaselineVerdict {
    /** 0-100 的基线得分，100 表示六维全部贴住基线 */
    score: number;
    drifts: DimensionDrift[];
    outOfBandKeys: DimensionKey[];
}

/** 词库检测的严重程度 */
export type Severity = 'info' | 'warn' | 'error';

/** 一处可定位的文本问题 */
export interface Finding {
    /** 规则分类标识，如 'cliche_emotion' */
    ruleId: string;
    /** 分类中文名，如 '心理套话' */
    category: string;
    severity: Severity;
    /** 人话描述，直接展示给作者 */
    message: string;
    /** 命中的原文片段 */
    snippet: string;
    /** 在全文中的字符偏移，用于编辑器定位高亮 */
    start: number;
    end: number;
    /** 建议替换词，可以为空 */
    suggestion?: string;
}

/** 单类规则的命中统计 */
export interface CategorySummary {
    category: string;
    ruleId: string;
    count: number;
    severity: Severity;
}

/** 词库闸整体结论 */
export interface LexiconReport {
    findings: Finding[];
    summaries: CategorySummary[];
    /** 0-100，命中越少越高 */
    score: number;
    charCount: number;
}

/** 章节体检合并结论（词库闸 + 基线闸 + 黄金三章可选） */
export interface ChapterReport {
    chapterId: string;
    title: string;
    charCount: number;
    metrics: TextMetrics;
    lexicon: LexiconReport;
    /** 没有基线时为 null，界面提示"先建基线" */
    baseline: BaselineVerdict | null;
    /** 综合分 */
    score: number;
    generatedAt: string;
}

/** 账本中的一个主体状态（扁平键值对，方便 JSONPatch 定位） */
export type LedgerSubjectState = Record<string, string>;

/** 整本账本：主体名 -> 字段表 */
export type LedgerTree = Record<string, LedgerSubjectState>;

/** 账本变更历史的一条记录 */
export interface LedgerPatchRecord {
    op: 'add' | 'replace' | 'remove';
    /** RFC6902 风格路径，如 /林胜/realm */
    path: string;
    value?: string;
    chapter: number;
    /** ISO 时间 */
    at: string;
    /** 人工填写的原因，可选 */
    note?: string;
}

/** 账本文件结构 */
export interface LedgerFile {
    tree: LedgerTree;
    history: LedgerPatchRecord[];
}

/** 正文里标注的账本事实，用于和账本做冲突比对 */
export interface LedgerMark {
    subject: string;
    field: string;
    value: string;
    start: number;
    end: number;
}

/** 账本冲突 */
export interface LedgerConflict {
    subject: string;
    field: string;
    /** 正文里写的内容 */
    written: string;
    /** 账本当前记录的内容 */
    recorded: string;
    /** 正文位置 */
    start: number;
    end: number;
    message: string;
}

/** 伏笔条目 */
export interface Foreshadow {
    id: string;
    content: string;
    plantedChapter: number;
    /** 计划回收章，null 表示未规划 */
    plannedChapter: number | null;
    /** 提到过这条伏笔的章节号 */
    mentions: number[];
    /** 实际回收章，null 表示未回收 */
    payoffChapter: number | null;
    createdAt: string;
}

/** 伏笔文件结构 */
export interface ForeshadowFile {
    items: Foreshadow[];
}

/** 超期扫描结论 */
export interface ForeshadowAlert {
    id: string;
    content: string;
    lastTouchedChapter: number;
    gap: number;
    level: 'info' | 'warn' | 'error';
    message: string;
}

/** 黄金三章单章诊断 */
export interface GoldenChapterDiagnosis {
    chapterNumber: number;
    title: string;
    /** 六项各 0-100 */
    hookStrength: number;
    openingPace: number;
    conflictDensity: number;
    infoDumpRatio: number;
    wordCountOk: boolean;
    dialogueRatio: number;
    score: number;
    notes: string[];
}

/** 人设卡的说话方式 */
export interface SpeechProfile {
    /** 句长习惯：写手用它反查台词是否跑偏 */
    sentenceLength: 'short' | 'medium' | 'long';
    catchphrases: string[];
    forbiddenWords: string[];
    /** 对主角的称呼，随时间可演变，所以是数组 */
    addressToProtagonist: string[];
}

/** 人设卡的语用演变记录 */
export interface SpeechEvolution {
    chapter: number;
    reason: string;
    change: string;
}

/** 人设卡 */
export interface CharacterCard {
    name: string;
    identity: string;
    personality: string[];
    flaw: string;
    speech: SpeechProfile;
    emotionBaseline: {
        normal: string;
        triggers: string[];
    };
    evolutions: SpeechEvolution[];
}

/** OOC 检测结论 */
export interface OocFinding {
    character: string;
    line: string;
    reason: string;
    severity: Severity;
}

/** 千人一腔检测结论 */
export interface SimilarVoicePair {
    characterA: string;
    characterB: string;
    /** 0-1，越高越像 */
    similarity: number;
    message: string;
}

/** 八问中的一道题 */
export interface OutlineQuestion {
    /** 题目 id，如 genre / cheat / tone */
    id: string;
    /** 第几问，从 1 开始 */
    step: number;
    /** 问题正文 */
    question: string;
    /** 为什么问这个 */
    hint: string;
    /** 可选项，作者也可以自由输入 */
    options: string[];
    /** 跳过时用的默认值 */
    defaultValue: string;
}

/** 八问的答案 */
export interface OutlineAnswer {
    /** 题目 id，如 genre / cheat / tone */
    id: string;
    /** 作者填写的正文 */
    value: string;
    /** 是否直接用了默认值跳过 */
    usedDefault: boolean;
}

/** 八问状态机状态 */
export interface OutlineState {
    answers: Record<string, OutlineAnswer>;
    /** 当前进行到第几步，0 起 */
    currentStep: number;
    /** 是否已生成大纲 */
    finished: boolean;
}

/** 开写包里的一项内容 */
export interface WritingPackageItem {
    key: string;
    label: string;
    content: string;
    /** 缺失原因，非空表示这一项没取到 */
    degradedReason?: string;
}

/** 开写包 */
export interface WritingPackage {
    items: WritingPackageItem[];
    /** 取不到的项汇总，界面直接提示，不假装有 */
    degraded: string[];
    assembledAt: string;
}
