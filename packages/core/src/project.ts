/**
 * 项目类型与能力矩阵
 * 墨匠不只有小说：同一个编辑器，装不同类型的项目，显示不同的工具。
 * 关键设计：小说那套功能一个不删，只是在别的类型下藏起来，不干扰。
 */

/** 项目类型 */
export type ProjectKind = 'novel' | 'notes' | 'docs';

/** 项目类型的中文名与说明，建项目时用 */
export const PROJECT_KINDS: Array<{
    kind: ProjectKind;
    name: string;
    description: string;
}> = [
    {
        kind: 'novel',
        name: '小说',
        description: '整套写作工具：体检、账本、伏笔、八问大纲、开写包',
    },
    {
        kind: 'notes',
        name: '笔记',
        description: '干净编辑器 + 目录树 + 搜索，适合日常记录和整理',
    },
    {
        kind: 'docs',
        name: '工作文档',
        description: '和笔记一样，但默认按文件夹组织，适合项目和会议记录',
    },
];

/** 一个类型支持哪些能力 */
export interface ProjectFeature {
    /** 章节体检（12 类词库 + 六维基线） */
    health: boolean;
    /** JSONPatch 账本 */
    ledger: boolean;
    /** 伏笔登记 */
    foreshadow: boolean;
    /** 人设卡 */
    characters: boolean;
    /** 黄金三章诊断 */
    golden3: boolean;
    /** 开写包 */
    writingPackage: boolean;
    /** 八问大纲 */
    outline8: boolean;
    /** 市场调研 */
    market: boolean;
    /** 剧情编排画布 */
    plot: boolean;
    /** 码字统计 */
    stats: boolean;
    /** 素材卡片盒 */
    materials: boolean;
    /** 敏感词检查 */
    sensitive: boolean;
    /** 流程图 / 思维导图 */
    diagram: boolean;
    /** 内容根目录的物理名字 */
    contentDir: string;
    /** 界面上一级内容的叫法，如"正文"/"文档" */
    contentLabel: string;
    /** 新建条目的按钮文案 */
    createLabel: string;
    /** 文件名是否用 001 这种编号（小说按章，笔记按标题） */
    numberedFiles: boolean;
    /** 是否有细纲这一层 */
    beatSheet: boolean;
}

/** 小说：全套 */
const NOVEL_FEATURE: ProjectFeature = {
    health: true,
    ledger: true,
    foreshadow: true,
    characters: true,
    golden3: true,
    writingPackage: true,
    outline8: true,
    market: true,
    plot: true,
    // 新四件是通用工具，写小说、记笔记、写文档都用得上
    stats: true,
    materials: true,
    sensitive: true,
    diagram: true,
    contentDir: '正文',
    contentLabel: '正文',
    createLabel: '新建章节',
    numberedFiles: true,
    beatSheet: true,
};

/** 笔记：只留编辑器和通用能力 */
const NOTES_FEATURE: ProjectFeature = {
    health: false,
    ledger: false,
    foreshadow: false,
    characters: false,
    golden3: false,
    writingPackage: false,
    outline8: false,
    market: false,
    // 画板是通用能力，笔记和工作文档也能用来梳理结构
    plot: true,
    // 新四件是通用工具：统计、素材、敏感词、图表都跟项目类型无关
    stats: true,
    materials: true,
    sensitive: true,
    diagram: true,
    contentDir: '文档',
    contentLabel: '文档',
    createLabel: '新建文档',
    numberedFiles: false,
    beatSheet: false,
};

/** 工作文档：和笔记一样，只是文案更偏工作 */
const DOCS_FEATURE: ProjectFeature = {
    ...NOTES_FEATURE,
    contentLabel: '文档',
    createLabel: '新建文档',
};

/**
 * 按类型取能力
 * @param kind 项目类型，老数据没有这个字段时按小说处理
 * @returns 能力矩阵
 */
export function getProjectFeatures(kind: ProjectKind | undefined): ProjectFeature {
    if (kind === 'notes') {
        return NOTES_FEATURE;
    }
    if (kind === 'docs') {
        return DOCS_FEATURE;
    }
    return NOVEL_FEATURE;
}

/**
 * 判断是不是小说项目
 * @param kind 项目类型
 * @returns 是否小说
 */
export function isNovel(kind: ProjectKind | undefined): boolean {
    return getProjectFeatures(kind).health;
}
