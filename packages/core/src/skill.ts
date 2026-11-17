/**
 * 技能（Skill）：把"写作套路"从一句话指令升级成可安装、可校验的插件
 *
 * 一个技能就是一个 JSON（扩展名 .mjskill），包含：
 * - 触发词：作者输入里出现这些词就自动命中
 * - 技能指令：命中后拼进系统提示，约束模型的写作路径
 * - 校验规则：输出回来后检查（字数/禁用词/解释腔等），不合格就自动重试
 *
 * 这个文件只有纯逻辑，不依赖 Node/Electron，渲染进程和主进程都能用。
 */

/** 技能可适用的模块，对应墨匠的三类项目 */
export type SkillModule = 'novel' | 'docs' | 'notes';

/** 全部模块，顺序固定：UI 展示、解析默认值都按这个顺序 */
export const SKILL_MODULES: SkillModule[] = ['novel', 'docs', 'notes'];

/**
 * 旧字段 kind 的类型，只为兼容早期技能文件保留
 * any 等价于"三个模块都适用"
 */
export type SkillKind = SkillModule | 'any';

/** 模块的中文名，主进程和渲染层共用一份，避免两处各写一遍 */
export const SKILL_MODULE_LABELS: Record<SkillModule, string> = {
    novel: '小说',
    docs: '文档',
    notes: '笔记',
};

/** 输出校验器的类型 */
export type CheckerType =
    | 'minChars'
    | 'maxChars'
    | 'forbiddenWords'
    | 'mustInclude'
    | 'noExplanation'
    | 'paragraphs';

/** 一条输出校验规则 */
export interface SkillChecker {
    /** 校验器类型 */
    type: CheckerType;
    /** 阈值（字数/段数）或词表 */
    value?: number | string[];
    /** 不通过时给模型看的说明，也会显示给作者 */
    message: string;
}

/** 技能里带的示范片段：给模型看"写成什么样算好" */
export interface SkillExample {
    /** 作者的原始输入 */
    input: string;
    /** 作者满意的那一版输出 */
    output: string;
}

/** 技能定义 */
export interface Skill {
    /** 唯一 id，也是文件名 */
    id: string;
    /** 显示名 */
    name: string;
    /** 版本号 */
    version: string;
    /** 作者/来源 */
    author: string;
    /** 一句话说明 */
    description: string;
    /** 适用模块：当前项目类型在里面才命中。空数组在解析阶段就会被补成全部模块 */
    modules: SkillModule[];
    /** 触发词，作者输入里包含任意一个即命中 */
    triggers: string[];
    /** 技能指令，命中后拼进系统提示 */
    prompt: string;
    /** 硬规则清单 */
    rules: string[];
    /** 输出校验规则 */
    checkers: SkillChecker[];
    /** 示范片段，最多 3 条，命中时一并塞进提示 */
    examples: SkillExample[];
    /** 一个 emoji 当图标，省得打包图片 */
    icon?: string;
    /** 作者主页/原始地址，方便溯源 */
    homepage?: string;
    /** 是否启用 */
    enabled: boolean;
    /** 是否内置技能（内置的不允许删除，只能禁用） */
    builtin?: boolean;
}

/** 技能解析失败的结果 */
export interface SkillParseError {
    ok: false;
    message: string;
}

/** 技能解析成功的结果 */
export interface SkillParseOk {
    ok: true;
    skill: Skill;
}

/** 解析结果 */
export type SkillParseResult = SkillParseOk | SkillParseError;

/** 技能 id 合法性：只允许字母数字横线下划线，防止路径穿越 */
const SKILL_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** 允许的校验器类型白名单 */
const CHECKER_TYPES: CheckerType[] = [
    'minChars',
    'maxChars',
    'forbiddenWords',
    'mustInclude',
    'noExplanation',
    'paragraphs',
];

/** 示范片段最多留几条：多了会把系统提示撑大，反而拖累效果 */
const MAX_EXAMPLES = 3;
/** 单条示范的输入输出上限，防止有人往里塞整章 */
const MAX_EXAMPLE_CHARS = 1200;
/** 技能指令长度上限，防止把整本小说塞进 prompt */
const MAX_PROMPT_CHARS = 4000;

/**
 * 把未知值转成字符串，非字符串返回空串
 * @param value 任意值
 * @returns 字符串
 */
function asString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

/**
 * 把未知值转成字符串数组，过滤空项
 * @param value 任意值
 * @returns 字符串数组
 */
function asStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.map((item) => asString(item)).filter((item) => item.length > 0);
}

/**
 * 把任意值归一成模块数组
 * 兼容三种写法：modules: ['novel']、kind: 'novel'、kind: 'any'
 * @param modulesRaw 新字段 modules
 * @param kindRaw 旧字段 kind
 * @returns 模块列表，至少含一个
 */
function parseModules(modulesRaw: unknown, kindRaw: unknown): SkillModule[] {
    const picked: SkillModule[] = [];
    if (Array.isArray(modulesRaw)) {
        for (const item of modulesRaw) {
            const value = asString(item) as SkillModule;
            if (SKILL_MODULES.includes(value) && !picked.includes(value)) {
                picked.push(value);
            }
        }
    }
    if (picked.length > 0) {
        return picked;
    }

    // 退回旧字段：kind 是 any（或压根没写）就当三类都能用
    const kind = asString(kindRaw) as SkillKind;
    if (kind === 'novel' || kind === 'docs' || kind === 'notes') {
        return [kind];
    }
    return [...SKILL_MODULES];
}

/**
 * 解析示范片段，超长和空条目直接丢掉
 * @param raw 原始值
 * @returns 示范片段
 */
function parseExamples(raw: unknown): SkillExample[] {
    if (!Array.isArray(raw)) {
        return [];
    }
    const examples: SkillExample[] = [];
    for (const item of raw) {
        if (examples.length >= MAX_EXAMPLES) {
            break;
        }
        if (!item || typeof item !== 'object') {
            continue;
        }
        const record = item as Record<string, unknown>;
        const input = asString(record.input).slice(0, MAX_EXAMPLE_CHARS);
        const output = asString(record.output).slice(0, MAX_EXAMPLE_CHARS);
        // 只有输入没有输出，对模型没用
        if (input.length === 0 || output.length === 0) {
            continue;
        }
        examples.push({ input, output });
    }
    return examples;
}

/**
 * 解析单条校验规则，非法返回 null
 * @param raw 原始值
 * @returns 校验规则或 null
 */
function parseChecker(raw: unknown): SkillChecker | null {
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    const record = raw as Record<string, unknown>;
    const type = asString(record.type) as CheckerType;
    if (!CHECKER_TYPES.includes(type)) {
        return null;
    }
    const message = asString(record.message) || '输出没通过校验，请重写';
    const value = record.value;
    if (type === 'forbiddenWords' || type === 'mustInclude') {
        const words = asStringArray(value);
        return words.length > 0 ? { type, value: words, message } : null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return { type, value, message };
    }
    return { type, message };
}

/**
 * 解析一个技能 JSON
 * 容错为主：能用的字段尽量保留，缺 id/name/prompt 才判失败
 * @param raw 从文件读到的原始 JSON
 * @returns 解析结果
 */
export function parseSkill(raw: unknown): SkillParseResult {
    if (!raw || typeof raw !== 'object') {
        return { ok: false, message: '技能文件不是合法的 JSON 对象' };
    }
    const record = raw as Record<string, unknown>;
    const id = asString(record.id);
    const name = asString(record.name);
    const prompt = asString(record.prompt);

    if (!SKILL_ID_PATTERN.test(id)) {
        return { ok: false, message: '技能 id 缺失或含非法字符（只能用字母数字横线下划线）' };
    }
    if (name.length === 0) {
        return { ok: false, message: '技能缺少 name' };
    }
    if (prompt.length === 0) {
        return { ok: false, message: '技能缺少 prompt（技能指令）' };
    }

    const checkers = Array.isArray(record.checkers)
        ? record.checkers
              .map((item) => parseChecker(item))
              .filter((item): item is SkillChecker => item !== null)
        : [];
    const icon = asString(record.icon).slice(0, 4);
    const homepage = asString(record.homepage);

    return {
        ok: true,
        skill: {
            id,
            name,
            version: asString(record.version) || '1.0.0',
            author: asString(record.author) || '未知',
            description: asString(record.description),
            // 新字段优先，老文件的 kind 由 parseModules 兜底转换
            modules: parseModules(record.modules, record.kind),
            triggers: asStringArray(record.triggers),
            prompt: prompt.slice(0, MAX_PROMPT_CHARS),
            rules: asStringArray(record.rules),
            checkers,
            examples: parseExamples(record.examples),
            icon: icon.length > 0 ? icon : undefined,
            homepage: homepage.length > 0 ? homepage : undefined,
            enabled: record.enabled !== false,
            builtin: record.builtin === true,
        },
    };
}

/** 技能命中结果 */
export interface SkillMatch {
    /** 命中的技能 */
    skill: Skill;
    /** 命中的触发词 */
    trigger: string;
}

/**
 * 判断技能是否适用于某个模块
 * @param skill 技能
 * @param module 当前项目对应的模块
 * @returns 是否适用
 */
export function skillAppliesTo(skill: Skill, module: SkillModule): boolean {
    return skill.modules.includes(module);
}

/**
 * 按作者输入匹配技能
 * 规则：模块对得上 → 触发词命中 → 取命中词最长的那个（更具体）
 * 输入越长越像"具体指令"，所以只做包含匹配，不做模糊
 * @param input 作者这次的输入
 * @param module 当前项目对应的模块
 * @param skills 已启用的技能列表
 * @returns 命中的技能，没命中返回 null
 */
export function matchSkill(
    input: string,
    module: SkillModule,
    skills: Skill[],
): SkillMatch | null {
    return matchAllSkills(input, module, skills)[0] ?? null;
}

/**
 * 匹配出所有命中的技能，按触发词长度从长到短排
 * 一轮只用一个技能（取最具体那个），但作者需要知道"还有谁也命中了"，
 * 否则会以为技能是全部一起生效的
 * @param input 作者这次的输入
 * @param module 当前项目对应的模块
 * @param skills 已启用的技能列表
 * @returns 命中列表，可能为空
 */
export function matchAllSkills(
    input: string,
    module: SkillModule,
    skills: Skill[],
): SkillMatch[] {
    const text = input.trim();
    if (text.length === 0) {
        return [];
    }

    const matches: SkillMatch[] = [];
    for (const skill of skills) {
        if (!skill.enabled) {
            continue;
        }
        // 模块不匹配就跳过：只给文档用的技能，不该在小说里冒出来
        if (!skillAppliesTo(skill, module)) {
            continue;
        }
        // 一个技能只记最长的那条触发词，免得同一技能占两个位置
        let longest = '';
        for (const trigger of skill.triggers) {
            if (trigger.length > 0 && text.includes(trigger) && trigger.length > longest.length) {
                longest = trigger;
            }
        }
        if (longest.length > 0) {
            matches.push({ skill, trigger: longest });
        }
    }

    // 触发词越长越具体，优先用它
    return matches.sort((left, right) => right.trigger.length - left.trigger.length);
}

/**
 * 把命中技能的指令、规则和示范拼成系统提示块
 * @param skill 技能
 * @returns 提示块
 */
export function skillPromptBlock(skill: Skill): string {
    const lines: string[] = [
        `【本次命中技能：${skill.name}${skill.version ? ` v${skill.version}` : ''}】`,
        skill.prompt,
    ];
    if (skill.rules.length > 0) {
        lines.push('技能硬规则（必须逐条遵守）：');
        skill.rules.forEach((rule, index) => {
            lines.push(`${index + 1}. ${rule}`);
        });
    }
    if (skill.examples.length > 0) {
        // 示范比形容词管用：模型照着抄文风，比听"写得自然点"有效得多
        lines.push('示范（作者认可的效果，照这个水准写，不要照抄内容）：');
        skill.examples.forEach((example, index) => {
            lines.push(`示范 ${index + 1} 输入：${example.input}`);
            lines.push(`示范 ${index + 1} 输出：${example.output}`);
        });
    }
    return lines.join('\n');
}

/**
 * 项目类型到技能模块的映射
 * 旧名保留，避免调用方全改一遍
 * @param projectKind 项目类型
 * @returns 技能模块
 */
export function toSkillKind(projectKind: string | undefined): SkillModule {
    if (projectKind === 'docs' || projectKind === 'notes') {
        return projectKind;
    }
    return 'novel';
}
