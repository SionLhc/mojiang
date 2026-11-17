/**
 * 技能商店
 *
 * 商店分两层：
 * 1. 精选技能：直接写在代码里，离线也能看到、能装，不依赖任何服务器
 * 2. 外部清单：作者给一个 index.json 链接，就能加载别人维护的技能列表
 *
 * 这里只做数据与解析，不碰文件和网络，主进程和渲染进程都能用。
 */

import { parseSkill, type Skill } from './skill';

/** 商店里的一条技能 */
export interface MarketSkill {
    /** 技能本体，装上就能用 */
    skill: Skill;
    /** 分类标签，商店里用来快速扫 */
    tags: string[];
    /** 推荐语：说明"什么情况下该装它"，比 description 更直白 */
    pitch: string;
}

/** 商店条目 + 本机安装状态 */
export interface MarketSkillState extends MarketSkill {
    /** 本机已安装的版本，没装是空串 */
    installedVersion: string;
    /** 是否有更新（本机版本低于商店版本） */
    hasUpdate: boolean;
}

/** 外部清单的解析结果 */
export interface MarketParseResult {
    /** 是否解析成功（一条都没解析出来算失败） */
    ok: boolean;
    /** 能用的条目 */
    items: MarketSkill[];
    /** 被跳过的条数，用于提示"这份清单有问题的条目我没装" */
    skipped: number;
    /** 失败原因，中文 */
    message?: string;
}

/** 精选技能的原始定义：先写成普通对象，再交给 parseSkill 统一校验，避免两套规则 */
interface FeaturedRaw {
    /** 技能字段 */
    skill: Record<string, unknown>;
    /** 分类标签 */
    tags: string[];
    /** 推荐语 */
    pitch: string;
}

/**
 * 精选技能清单
 * 挑选标准：日常办公文档里高频、且"模型自由发挥容易写歪"的场景
 */
const FEATURED_RAW: FeaturedRaw[] = [
    {
        tags: ['会议', '摘要'],
        pitch: '开会录音转出来的乱稿，整理成能直接发群的决议和待办。',
        skill: {
            id: 'meeting-minutes',
            name: '会议纪要',
            version: '1.0.0',
            icon: '🗒️',
            author: '墨匠精选',
            description: '把零散的会议记录整理成决议、待办、悬而未决三块',
            modules: ['docs', 'notes'],
            triggers: ['会议纪要', '整理会议', '会议记录'],
            prompt:
                '把作者给的内容整理成三段，只输出正文：\n' +
                '1. 结论：会上定下来的事，按重要性排，一条一句\n' +
                '2. 待办：谁 / 做什么 / 什么时候前做完\n' +
                '3. 未决：有分歧或没定论的点，写清分歧在哪',
            rules: [
                '不编造会上没提到的结论和日期',
                '待办必须带责任人，没说就写「未指定」，不要猜',
                '不写「好的，我来整理」这类开场白，也不加结尾总结',
            ],
            checkers: [
                { type: 'noExplanation', message: '直接给纪要，不要解释你在做什么' },
                { type: 'minChars', value: 80, message: '太短了，把结论和待办写全' },
            ],
            examples: [
                {
                    input: '小王说下周三前给方案，老李觉得预算还得再看，先按去年的走',
                    output:
                        '结论\n- 预算暂按去年标准执行\n\n待办\n- 小王：下周三前交出方案\n- 老李：核对预算口径\n\n未决\n- 预算是否上调，等老李核完再定',
                },
            ],
        },
    },
    {
        tags: ['职场', '汇报'],
        pitch: '把一周的零散记录写成领导一眼能看完的周报，不写空话。',
        skill: {
            id: 'weekly-report',
            name: '周报整理',
            version: '1.0.0',
            icon: '📅',
            author: '墨匠精选',
            description: '本周产出 / 卡点风险 / 下周计划三段式周报',
            modules: ['docs'],
            triggers: ['写周报', '周报'],
            prompt:
                '把作者给的一周记录整理成周报，三段，只输出正文：\n' +
                '1. 本周完成：每条带结果或数据，不写「参与了」\n' +
                '2. 卡住的事：卡在哪、需要谁配合\n' +
                '3. 下周计划：最多 3 条，可执行，带时间',
            rules: [
                '不写「积极推进」「持续跟进」这类空话',
                '有数据就保留数据，没有数据不要编',
                '每条不超过两行',
            ],
            checkers: [{ type: 'noExplanation', message: '直接给周报正文' }],
            examples: [
                {
                    input: '周一改完接口文档，周三跟产品对了三次需求，报表还没做完，下周想上线灰度',
                    output:
                        '本周完成\n- 接口文档改完并同步给前端\n- 与产品三次对齐需求，范围已定稿\n\n卡住的事\n- 数据报表未完成，等数据组给字段口径\n\n下周计划\n- 周二前完成报表\n- 周四灰度上线，观察一天',
                },
            ],
        },
    },
    {
        tags: ['决策', '对比'],
        pitch: '两个以上方案要选一个时，先拉齐对比维度，再给结论。',
        skill: {
            id: 'proposal-compare',
            name: '方案对比',
            version: '1.0.0',
            icon: '⚖️',
            author: '墨匠精选',
            description: '同维度表格对比 + 推荐结论 + 主要风险',
            modules: ['docs'],
            triggers: ['方案对比', '选型', '对比方案'],
            prompt:
                '输出三部分，只输出正文：\n' +
                '1. 一张 Markdown 表格：行是维度，列是方案，格子里写事实或打分\n' +
                '2. 推荐：选哪个，理由最多 3 条\n' +
                '3. 风险：选它的主要代价，以及什么情况下该改选',
            rules: [
                '所有方案必须用同一批维度，不能一个说成本一个说体验',
                '不确定的数据标「待确认」，不要编',
                '结尾不要写「各有优劣，请自行选择」这种话',
            ],
            checkers: [{ type: 'noExplanation', message: '直接给对比表和结论' }],
            examples: [
                {
                    input: '自建服务还是买现成的，团队 3 个人，预算一年 20 万，要求三个月上线',
                    output:
                        '| 维度 | 自建 | 采购 |\n| --- | --- | --- |\n| 三个月上线 | 风险高 | 可行 |\n| 年成本 | 人力为主，待确认 | 约 15 万 |\n| 长期可控性 | 高 | 中 |\n\n推荐：采购。理由：三人团队三个月自建来不及；试错成本低。\n\n风险：数据迁移和供应商锁定，合同里要留导出条款。',
                },
            ],
        },
    },
    {
        tags: ['产品', '需求'],
        pitch: '口头需求落成文档，缺的信息它会明确标出来而不是瞎补。',
        skill: {
            id: 'prd-draft',
            name: '需求文档',
            version: '1.0.0',
            icon: '📋',
            author: '墨匠精选',
            description: '背景 / 目标 / 场景 / 流程 / 验收标准 / 待确认',
            modules: ['docs'],
            triggers: ['需求文档', 'PRD', '需求说明'],
            prompt:
                '按顺序输出，只输出正文：\n' +
                '1. 背景与问题\n2. 目标与非目标\n3. 用户与场景\n' +
                '4. 主流程（编号步骤）\n5. 验收标准（每条都能判定通过与否）\n6. 待确认问题',
            rules: [
                '目标要可度量，写不出指标就写「待确认」',
                '不写技术实现方案，除非作者明确要',
                '信息不足的地方标「待确认：xxx」，不要自己编',
            ],
            checkers: [{ type: 'noExplanation', message: '直接给文档' }],
            examples: [],
        },
    },
    {
        tags: ['沟通', '邮件'],
        pitch: '把想说的话变成一封对方知道要做什么的邮件。',
        skill: {
            id: 'email-reply',
            name: '邮件撰写',
            version: '1.0.0',
            icon: '✉️',
            author: '墨匠精选',
            description: '主题 / 称呼 / 正文 / 下一步，第一段就说诉求',
            modules: ['docs', 'notes'],
            triggers: ['写邮件', '回邮件', '邮件润色'],
            prompt:
                '输出四段，只输出邮件内容：\n主题：\n称呼：\n正文：第一段直接说结论或诉求，后面给依据\n' +
                '下一步：明确要对方做什么、什么时候前',
            rules: [
                '不用「见信如晤」这类过时套话',
                '第一段必须让对方知道他需要做什么',
                '不承诺作者没说过的期限',
            ],
            checkers: [{ type: 'noExplanation', message: '直接给邮件正文' }],
            examples: [],
        },
    },
    {
        tags: ['学习', '笔记'],
        pitch: '看书的划线别只躺着，整理成摘录、理解、可用三块。',
        skill: {
            id: 'reading-notes',
            name: '读书笔记',
            version: '1.0.0',
            icon: '📚',
            author: '墨匠精选',
            description: '原文摘录 / 我的理解 / 可用之处，三层分开',
            modules: ['notes', 'docs'],
            triggers: ['读书笔记', '摘录整理'],
            prompt:
                '输出三部分，只输出正文：\n' +
                '1. 摘录：只挑关键句，原样保留\n' +
                '2. 理解：用作者自己的话说一遍，不抄原文\n' +
                '3. 可用：下次写作或工作里怎么用，要具体到场景',
            rules: [
                '摘录和自己的理解必须分开，不许混在一段里',
                '不写读后感式的空泛评价',
                '没有页码就不要编页码',
            ],
            checkers: [{ type: 'noExplanation', message: '直接给笔记' }],
            examples: [],
        },
    },
    {
        tags: ['整理', '待办'],
        pitch: '一堆聊天记录里把真正要做的事捞出来，做成表格。',
        skill: {
            id: 'action-items',
            name: '提炼待办',
            version: '1.0.0',
            icon: '✅',
            author: '墨匠精选',
            description: '从杂乱记录里提取事项 / 负责人 / 截止 / 依赖',
            modules: ['notes', 'docs'],
            triggers: ['提待办', '行动项', '待办清单'],
            prompt:
                '输出一张 Markdown 表格，列：事项 / 负责人 / 截止时间 / 依赖。\n' +
                '表格后加一句：最关键的一件事是什么。信息缺失写「未指定」。',
            rules: [
                '只提真的要动手做的事，「了解一下」这种丢掉',
                '不要为了凑数把一个事项拆成五条',
            ],
            checkers: [{ type: 'noExplanation', message: '直接给表格' }],
            examples: [
                {
                    input: '老张说他来对接供应商，月底前要有报价；我这边把预算表补一补，等报价回来才能定',
                    output:
                        '| 事项 | 负责人 | 截止时间 | 依赖 |\n| --- | --- | --- | --- |\n' +
                        '| 对接供应商拿报价 | 老张 | 月底前 | 无 |\n' +
                        '| 补预算表 | 我 | 未指定 | 等报价 |\n\n' +
                        '最关键：报价决定预算，先盯老张这条。',
                },
            ],
        },
    },
    {
        tags: ['合同', '风险'],
        pitch: '看合同的甲方乙方，先把自己签了什么、漏了什么列清楚。',
        skill: {
            id: 'contract-points',
            name: '合同要点',
            version: '1.0.0',
            icon: '🔍',
            author: '墨匠精选',
            description: '权利义务 / 风险条款 / 缺失项，只做文本梳理',
            modules: ['docs'],
            triggers: ['合同要点', '审合同', '看合同'],
            prompt:
                '输出三段，只输出正文：\n' +
                '1. 我方权利义务：逐条列，保留原文表述\n' +
                '2. 风险条款：指出位置和风险点\n' +
                '3. 缺失项：这类合同通常该有但本文没有的条款\n' +
                '最后单独一行写：以上仅为文本梳理，不构成法律意见。',
            rules: [
                '只做文本梳理，不给法律结论，不给诉讼建议',
                '引用条款保留原文，不要改写成自己的话',
                '拿不准的标「需律师确认」',
            ],
            checkers: [
                {
                    type: 'mustInclude',
                    value: ['不构成法律意见'],
                    message: '结尾必须带上「不构成法律意见」的声明',
                },
            ],
            examples: [],
        },
    },
];

/**
 * 解析一条商店条目
 * 支持两种写法：{ skill: {...}, tags, pitch } 和直接是技能对象
 * @param raw 原始条目
 * @returns 条目，不合法返回 null
 */
function parseMarketItem(raw: unknown): MarketSkill | null {
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    const record = raw as Record<string, unknown>;
    // 直接是技能对象时，把整条当 skill
    const skillRaw = record.skill && typeof record.skill === 'object' ? record.skill : record;
    const parsed = parseSkill(skillRaw);
    if (!parsed.ok) {
        return null;
    }
    const tags = Array.isArray(record.tags)
        ? record.tags.map((tag) => (typeof tag === 'string' ? tag.trim() : '')).filter((tag) => tag.length > 0)
        : [];
    const pitch = typeof record.pitch === 'string' ? record.pitch.trim() : '';
    return {
        skill: parsed.skill,
        tags,
        // 没写推荐语就用技能说明顶，商店里不能空着
        pitch: pitch.length > 0 ? pitch : parsed.skill.description,
    };
}

/**
 * 内置精选技能
 * @returns 能直接装的条目列表
 */
export function featuredMarketSkills(): MarketSkill[] {
    const items: MarketSkill[] = [];
    for (const entry of FEATURED_RAW) {
        const item = parseMarketItem(entry);
        if (item) {
            items.push(item);
        }
    }
    return items;
}

/**
 * 解析外部清单
 * 兼容三种形状：[...]、{ skills: [...] }、单条技能对象
 * 坏条目跳过而不整体失败——别人的清单难免有写错的，不该连累整页
 * @param raw 已解析成对象的清单
 * @returns 解析结果
 */
export function parseMarketIndex(raw: unknown): MarketParseResult {
    if (!raw || typeof raw !== 'object') {
        return { ok: false, items: [], skipped: 0, message: '清单不是合法的 JSON' };
    }

    let list: unknown[];
    if (Array.isArray(raw)) {
        list = raw;
    } else {
        const record = raw as Record<string, unknown>;
        const container = record.skills ?? record.items ?? record.market;
        if (Array.isArray(container)) {
            list = container;
        } else {
            // 单条技能也能当清单用，方便只分享一个技能
            list = [raw];
        }
    }

    const items: MarketSkill[] = [];
    let skipped = 0;
    for (const entry of list) {
        const item = parseMarketItem(entry);
        if (item) {
            items.push(item);
        } else {
            skipped += 1;
        }
    }

    if (items.length === 0) {
        return {
            ok: false,
            items: [],
            skipped,
            message:
                skipped > 0
                    ? '这份清单里的条目都不可用，检查一下 id / name / prompt 有没有缺'
                    : '清单是空的',
        };
    }
    return { ok: true, items, skipped };
}
