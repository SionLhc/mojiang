/**
 * 技能仓库
 *
 * 技能就是「墨匠/技能/」目录下的一个 .mjskill 文件（JSON 内容）。
 * 用文件而不是数据库，作者能直接打开看、改了立刻生效，也不会锁在应用里。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'fs';
import { basename, extname, join } from 'path';
import {
    builtinSkills,
    featuredMarketSkills,
    parseMarketIndex,
    parseSkill,
    type MarketSkill,
    type MarketSkillState,
    type Skill,
} from '@mojiang/core';
import { ensureRootDirs, getSkillDir } from './paths';
import { logError, logInfo } from './logger';

/** 技能文件扩展名 */
const SKILL_EXTENSION = '.mjskill';

/**
 * 拼技能文件路径（id 已在 parseSkill 里做过白名单校验）
 * @param id 技能 id
 * @returns 绝对路径
 */
function skillPath(id: string): string {
    return join(getSkillDir(), `${id}${SKILL_EXTENSION}`);
}

/**
 * 确保技能目录存在
 */
function ensureSkillDir(): void {
    ensureRootDirs();
    const dir = getSkillDir();
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
}

/**
 * 比较两个版本号，只认 x.y.z 的数字部分
 * @param left 版本 A
 * @param right 版本 B
 * @returns 负数表示 A 旧，0 相同，正数表示 A 新
 */
function compareVersion(left: string, right: string): number {
    const parse = (value: string): number[] =>
        value.split('.').map((part) => Number.parseInt(part, 10) || 0);
    const a = parse(left);
    const b = parse(right);
    for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
        const diff = (a[index] ?? 0) - (b[index] ?? 0);
        if (diff !== 0) {
            return diff;
        }
    }
    return 0;
}

/**
 * 把一个旧版内置技能迁移到新版定义
 *
 * 原则：能力声明（modules/icon）跟代码走，作者写过的内容（prompt/rules/checkers）不覆盖。
 * 这样作者改过措辞不会被升级冲掉，但新版本加的模块归属能生效。
 * @param disk 磁盘上现有的技能
 * @param code 代码里的内置定义
 * @returns 需要写回的新技能；不需要迁移返回 null
 */
function migrateBuiltinSkill(disk: Skill, code: Skill): Skill | null {
    if (compareVersion(disk.version, code.version) >= 0) {
        return null;
    }
    return {
        ...code,
        // 作者可能改过这几项，保留磁盘上的
        prompt: disk.prompt,
        rules: disk.rules.length > 0 ? disk.rules : code.rules,
        checkers: disk.checkers.length > 0 ? disk.checkers : code.checkers,
        // 作者自己加了示范就留着，没加才补代码里的
        examples: disk.examples.length > 0 ? disk.examples : code.examples,
        // 启停是作者的决定，迁移必须保留
        enabled: disk.enabled,
        builtin: true,
    };
}

/**
 * 首次启动写内置技能，之后每次启动做一次版本迁移
 * 同名文件已存在时不整体覆盖——作者可能已经改过
 */
export function seedBuiltinSkills(): void {
    try {
        ensureSkillDir();
        for (const skill of builtinSkills()) {
            const target = skillPath(skill.id);
            if (!existsSync(target)) {
                writeFileSync(target, JSON.stringify(skill, null, 4), 'utf-8');
                logInfo('内置技能已写入', { id: skill.id });
                continue;
            }
            const disk = readSkillFile(target);
            // 作者把内置技能改成自己的了（builtin: false），不碰
            if (!disk || disk.builtin !== true) {
                continue;
            }
            const migrated = migrateBuiltinSkill(disk, skill);
            if (migrated) {
                writeFileSync(target, JSON.stringify(migrated, null, 4), 'utf-8');
                logInfo('内置技能已迁移', {
                    id: skill.id,
                    from: disk.version,
                    to: skill.version,
                    modules: migrated.modules,
                });
            }
        }
    } catch (error) {
        logError('写内置技能失败', error);
    }
}

/**
 * 读单个技能文件
 * @param filePath 绝对路径
 * @returns 技能；解析失败返回 null
 */
function readSkillFile(filePath: string): Skill | null {
    try {
        const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown;
        const parsed = parseSkill(raw);
        if (!parsed.ok) {
            logError(`技能文件不合法：${basename(filePath)}`, new Error(parsed.message));
            return null;
        }
        return parsed.skill;
    } catch (error) {
        logError(`技能文件读取失败：${basename(filePath)}`, error);
        return null;
    }
}

/**
 * 列出全部技能，按「内置在前、再按名字」排序
 * @returns 技能列表
 */
export function listSkills(): Skill[] {
    ensureSkillDir();
    const skills: Skill[] = [];
    try {
        for (const name of readdirSync(getSkillDir())) {
            if (extname(name).toLowerCase() !== SKILL_EXTENSION) {
                continue;
            }
            const skill = readSkillFile(join(getSkillDir(), name));
            if (skill) {
                skills.push(skill);
            }
        }
    } catch (error) {
        logError('技能目录读取失败', error);
    }
    return skills.sort((left, right) => {
        if (Boolean(left.builtin) !== Boolean(right.builtin)) {
            return left.builtin ? -1 : 1;
        }
        return left.name.localeCompare(right.name, 'zh');
    });
}

/**
 * 写一个技能到磁盘（整体覆盖）
 * @param skill 技能对象
 */
function writeSkill(skill: Skill): void {
    ensureSkillDir();
    writeFileSync(skillPath(skill.id), JSON.stringify(skill, null, 4), 'utf-8');
}

/**
 * 启用/禁用一个技能
 * @param id 技能 id
 * @param enabled 是否启用
 * @returns 更新后的技能
 */
export function toggleSkill(id: string, enabled: boolean): Skill {
    const skill = listSkills().find((item) => item.id === id);
    if (!skill) {
        throw new Error(`技能不存在：${id}`);
    }
    const next: Skill = { ...skill, enabled: Boolean(enabled) };
    writeSkill(next);
    return next;
}

/** 安装结果 */
export interface SkillInstallResult {
    /** 装好的技能 */
    skill: Skill;
    /** 是否覆盖了同 id 的旧技能 */
    replaced: boolean;
}

/** 下载大小上限，技能只是文本，超过就是不对劲 */
const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024;
/** 下载超时毫秒数 */
const DOWNLOAD_TIMEOUT_MS = 15_000;

/**
 * 从一段文本里把技能 JSON 抠出来
 * 作者往往是把网页上的一大段复制过来，前后可能带说明文字或 ```json 围栏
 * @param text 原始文本
 * @returns JSON 字符串
 */
export function extractSkillJson(text: string): string {
    const start = text.indexOf('{');
    if (start < 0) {
        throw new Error('这段内容里没找到技能：需要一段 { ... } 形式的 JSON');
    }
    const end = text.lastIndexOf('}');
    if (end <= start) {
        // 有开头没结尾，八成是复制时被截断了，直接说清楚
        throw new Error('技能内容不完整：JSON 少了结尾的 }');
    }
    return text.slice(start, end + 1);
}

/**
 * 校验并落盘
 *
 * 这是所有安装通道（文件/文本/链接）的唯一出口：
 * 校验、重名判断、写盘只在这里做一遍，避免四个入口四套逻辑。
 * @param raw 已解析成对象的技能内容
 * @param sourceUrl 来源链接，会写进 homepage 方便溯源
 * @returns 安装结果
 */
export function commitSkill(raw: unknown, sourceUrl?: string): SkillInstallResult {
    const parsed = parseSkill(raw);
    if (!parsed.ok) {
        throw new Error(parsed.message);
    }
    const skill = parsed.skill;
    // 从链接装的，把链接记下来，日后作者能顺着找回原帖
    if (sourceUrl && !skill.homepage) {
        skill.homepage = sourceUrl;
    }

    const existing = listSkills().find((item) => item.id === skill.id);
    // 内置技能不允许被外部包顶替
    if (existing?.builtin && !skill.builtin) {
        throw new Error(`技能 id「${skill.id}」和内置技能重名，换个 id 再装`);
    }

    writeSkill(skill);
    logInfo('技能已安装', {
        id: skill.id,
        version: skill.version,
        modules: skill.modules,
        replaced: Boolean(existing),
    });
    return { skill, replaced: Boolean(existing) };
}

/**
 * 从文本安装（网页上复制的一段、聊天窗口里贴的 JSON 都走这里）
 * @param text 原始文本
 * @param sourceUrl 来源链接
 * @returns 安装结果
 */
export function installSkillFromText(text: string, sourceUrl?: string): SkillInstallResult {
    let raw: unknown;
    try {
        raw = JSON.parse(extractSkillJson(text)) as unknown;
    } catch (error) {
        // extractSkillJson 抛的是中文提示，别被 JSON 错误覆盖掉
        if (error instanceof SyntaxError) {
            logError('技能内容 JSON 解析失败', error);
            throw new Error('技能内容不是合法 JSON，可能是复制时被截断了');
        }
        throw error;
    }
    return commitSkill(raw, sourceUrl);
}

/**
 * 从文件安装
 * 不强制扩展名：有人会把技能存成 .json 或 .txt
 * @param filePath 文件路径
 * @returns 安装结果
 */
export function installSkillFromFile(filePath: string): SkillInstallResult {
    if (!existsSync(filePath)) {
        throw new Error('文件不存在，可能被移动或删除了');
    }
    let text: string;
    try {
        text = readFileSync(filePath, 'utf-8');
    } catch (error) {
        logError('技能文件读取失败', error);
        throw new Error('这个文件读不了，可能被其他程序占用');
    }
    return installSkillFromText(text);
}

/**
 * 下载一段文本（技能文件、商店清单都走这里）
 * 加了大小上限和超时，免得一个坏链接把界面卡死
 * @param url 直链
 * @returns 文本内容
 */
async function downloadText(url: string): Promise<string> {
    let target: URL;
    try {
        target = new URL(url.trim());
    } catch {
        throw new Error('链接格式不对，要 http 或 https 开头的完整地址');
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
        throw new Error('只支持 http/https 链接');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
        const response = await fetch(target, { signal: controller.signal, redirect: 'follow' });
        if (!response.ok) {
            throw new Error(`下载失败：HTTP ${response.status}`);
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length > MAX_DOWNLOAD_BYTES) {
            throw new Error('这个文件太大了，技能应该只有几十 KB');
        }
        return buffer.toString('utf-8');
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            throw new Error('下载超时，检查一下网络或链接');
        }
        logError('技能下载失败', error);
        throw new Error(error instanceof Error ? error.message : '下载失败');
    } finally {
        clearTimeout(timer);
    }
}

/**
 * 从链接安装
 * @param url 技能文件的直链
 * @returns 安装结果
 */
export async function installSkillFromUrl(url: string): Promise<SkillInstallResult> {
    const text = await downloadText(url);
    return installSkillFromText(text, url.trim());
}

/**
 * 给商店条目补上本机安装状态
 * @param item 商店条目
 * @param installed 本机已装技能，按 id 索引
 * @returns 带状态的条目
 */
function attachMarketState(item: MarketSkill, installed: Map<string, Skill>): MarketSkillState {
    const local = installed.get(item.skill.id);
    const installedVersion = local ? local.version : '';
    return {
        ...item,
        installedVersion,
        // 本机版本比商店低才算有更新
        hasUpdate:
            installedVersion.length > 0 && compareVersion(installedVersion, item.skill.version) < 0,
    };
}

/**
 * 本机已装技能按 id 索引
 * @returns id 到技能的映射
 */
function installedMap(): Map<string, Skill> {
    return new Map(listSkills().map((skill) => [skill.id, skill]));
}

/**
 * 把本机自己写的技能导出成商店清单
 * 内置的不导出：那是应用自带的，别人装了本来就有
 * @returns 清单 JSON 文本，可以直接托管到任意静态站点
 */
export function exportSkillIndex(): string {
    const items = listSkills()
        .filter((skill) => !skill.builtin)
        .map((skill) => {
            // 复制一份再删除运行态字段，避免把"装没装、开没开"发到清单里
            const copy: Record<string, unknown> = { ...skill };
            delete copy.enabled;
            delete copy.builtin;
            return { skill: copy, tags: [] as string[], pitch: skill.description };
        });
    return JSON.stringify({ skills: items }, null, 4);
}

/**
 * 商店列表：内置精选 + 本机安装状态
 * 精选写在代码里，所以断网也能看到、也能装
 * @returns 条目列表
 */
export function listMarketSkills(): MarketSkillState[] {
    const installed = installedMap();
    return featuredMarketSkills().map((item) => attachMarketState(item, installed));
}

/**
 * 从精选商店安装一个技能
 * 只认清单里的 id：渲染层传什么内容都不作数，防止绕过校验往磁盘写任意东西
 * @param id 技能 id
 * @returns 安装结果
 */
export function installSkillFromMarket(id: string): SkillInstallResult {
    const item = featuredMarketSkills().find((entry) => entry.skill.id === id);
    if (!item) {
        throw new Error(`商店里没有「${id}」，可能清单已更新`);
    }
    return commitSkill({ ...item.skill, enabled: true }, item.skill.homepage);
}

/**
 * 加载外部清单（别人维护的 index.json）
 * @param url 清单直链
 * @returns 带安装状态的条目列表
 */
export async function fetchMarketIndex(url: string): Promise<MarketSkillState[]> {
    const text = await downloadText(url);
    let raw: unknown;
    try {
        raw = JSON.parse(text) as unknown;
    } catch (error) {
        logError('商店清单 JSON 解析失败', error);
        throw new Error('清单不是合法 JSON，检查一下这个链接是不是原始文件');
    }
    const parsed = parseMarketIndex(raw);
    if (!parsed.ok) {
        throw new Error(parsed.message ?? '清单里没有可用技能');
    }
    if (parsed.skipped > 0) {
        logInfo('商店清单有坏条目', { skipped: parsed.skipped, url });
    }
    const installed = installedMap();
    return parsed.items.map((item) => attachMarketState(item, installed));
}

/**
 * 从外部文件导入技能（保留旧名，内部走统一入口）
 * @param filePath 用户选中的技能文件
 * @returns 导入后的技能
 */
export function importSkill(filePath: string): Skill {
    return installSkillFromFile(filePath).skill;
}

/**
 * 删除一个技能，内置技能不允许删
 * @param id 技能 id
 */
export function removeSkill(id: string): void {
    const skill = listSkills().find((item) => item.id === id);
    if (!skill) {
        throw new Error(`技能不存在：${id}`);
    }
    if (skill.builtin) {
        throw new Error('内置技能不能删除，可以禁用');
    }
    unlinkSync(skillPath(id));
}
