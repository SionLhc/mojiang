import { useCallback, useEffect, useRef, useState } from 'react';
import {
    SKILL_MODULES,
    SKILL_MODULE_LABELS,
    type MarketSkillState,
    type Skill,
} from '@mojiang/core';
import Modal from '@/components/Modal';
import SkillToggle from '@/components/SkillToggle';
import { askConfirm } from '@/lib/confirm';
import { errorMessage } from '@/lib/format';
import { useAppStore } from '@/store/useAppStore';

/** 属性 */
interface SkillDialogProps {
    open: boolean;
    onClose: () => void;
}

/** 弹窗内的两个页签 */
type SkillTab = 'installed' | 'market';

/**
 * 技能管理弹窗
 * 左半边是"我装了什么"（启停、删除），右半边是"还有哪些能装"（商店）
 */
export default function SkillDialog({ open, onClose }: SkillDialogProps) {
    const pushToast = useAppStore((state) => state.pushToast);
    const bumpSkills = useAppStore((state) => state.bumpSkills);
    const settings = useAppStore((state) => state.settings);
    const updateSettings = useAppStore((state) => state.updateSettings);
    const [tab, setTab] = useState<SkillTab>('installed');
    const [skills, setSkills] = useState<Skill[]>([]);
    /** 商店精选（带本机安装状态） */
    const [marketSkills, setMarketSkills] = useState<MarketSkillState[]>([]);
    /** 外部清单加载进来的条目，单独放，方便标来源 */
    const [loadedSkills, setLoadedSkills] = useState<MarketSkillState[]>([]);
    /** 外部清单地址 */
    const [marketUrl, setMarketUrl] = useState('');
    /** 自动加载过的地址，防止同一个坏地址被反复请求 */
    const autoLoadedUrl = useRef('');
    /** 正在装哪个技能，用于只禁用那一张卡 */
    const [busyId, setBusyId] = useState('');
    const [busy, setBusy] = useState(false);
    /** 粘贴框内容：可能是技能 JSON，也可能是一条链接 */
    const [pasteText, setPasteText] = useState('');
    /** 安装失败的说明，直接显示在粘贴框下面，比 toast 好读 */
    const [installError, setInstallError] = useState('');
    /** 商店相关的错误/提示 */
    const [marketError, setMarketError] = useState('');

    /**
     * 重新拉一遍已安装列表
     */
    const reload = useCallback(async (): Promise<void> => {
        try {
            setSkills(await window.api.skill.list());
        } catch (error) {
            pushToast('error', errorMessage(error));
        }
    }, [pushToast]);

    /**
     * 重新拉一遍商店清单（安装状态会跟着变）
     */
    const reloadMarket = useCallback(async (): Promise<void> => {
        try {
            setMarketSkills(await window.api.skill.market());
        } catch (error) {
            pushToast('error', errorMessage(error));
        }
    }, [pushToast]);

    // 每次打开都重拉：作者可能在外面直接改了技能文件
    useEffect(() => {
        if (open) {
            void reload();
            void reloadMarket();
        }
    }, [open, reload, reloadMarket]);

    // 上次用过的清单地址回填：不用每次重新粘一遍链接
    useEffect(() => {
        const saved = settings?.skill.marketIndexUrl ?? '';
        if (saved.length > 0) {
            setMarketUrl((previous) => (previous.length === 0 ? saved : previous));
        }
    }, [settings?.skill.marketIndexUrl]);

    /**
     * 启用/禁用
     * @param skill 技能
     */
    async function handleToggle(skill: Skill): Promise<void> {
        setBusy(true);
        try {
            await window.api.skill.toggle(skill.id, !skill.enabled);
            await reload();
            await reloadMarket();
            bumpSkills();
        } catch (error) {
            pushToast('error', errorMessage(error));
        } finally {
            setBusy(false);
        }
    }

    /**
     * 导入文件（走文件选择框）
     */
    async function handleImportFile(): Promise<void> {
        setBusy(true);
        setInstallError('');
        try {
            const result = await window.api.skill.import();
            if (result.canceled) {
                return;
            }
            if (result.message) {
                setInstallError(result.message);
                return;
            }
            if (result.skill) {
                pushToast('success', `已安装「${result.skill.name}」`);
            }
            await reload();
            await reloadMarket();
            bumpSkills();
        } catch (error) {
            setInstallError(errorMessage(error));
        } finally {
            setBusy(false);
        }
    }

    /**
     * 粘贴安装：链接走下载，其余按技能内容解析
     */
    async function handleInstallPaste(): Promise<void> {
        const text = pasteText.trim();
        if (text.length === 0) {
            setInstallError('先粘点东西进来');
            return;
        }
        setBusy(true);
        setInstallError('');
        try {
            const isUrl = /^https?:\/\//i.test(text);
            const result = isUrl
                ? await window.api.skill.installUrl(text)
                : await window.api.skill.installText(text);
            if (!result.ok) {
                setInstallError(result.message);
                return;
            }
            pushToast(
                'success',
                result.replaced
                    ? `已更新「${result.skill.name}」到 v${result.skill.version}`
                    : `已安装「${result.skill.name}」`,
            );
            setPasteText('');
            await reload();
            await reloadMarket();
            bumpSkills();
        } catch (error) {
            setInstallError(errorMessage(error));
        } finally {
            setBusy(false);
        }
    }

    /**
     * 从商店一键安装
     * 装完不切页签：作者常常连着装几个
     * @param item 商店条目
     * @param fromLoaded 是否来自外部清单（外部条目不在内置精选里，得按内容装）
     */
    async function handleMarketInstall(item: MarketSkillState, fromLoaded: boolean): Promise<void> {
        setBusyId(item.skill.id);
        setMarketError('');
        try {
            // 精选走 id（主进程只认白名单）；外部条目走文本通道，照样过同一套校验
            const result = fromLoaded
                ? await window.api.skill.installText(JSON.stringify(item.skill))
                : await window.api.skill.marketInstall(item.skill.id);
            if (!result.ok) {
                setMarketError(result.message);
                return;
            }
            pushToast(
                'success',
                result.replaced
                    ? `已更新「${result.skill.name}」到 v${result.skill.version}`
                    : `已安装「${result.skill.name}」，输入里带上触发词就会生效`,
            );
            await reload();
            await reloadMarket();
            if (fromLoaded) {
                // 外部条目重新拉一次要再走网络，直接把状态改掉更快
                setLoadedSkills((previous) =>
                    previous.map((entry) =>
                        entry.skill.id === item.skill.id
                            ? {
                                  ...entry,
                                  installedVersion: result.skill.version,
                                  hasUpdate: false,
                              }
                            : entry,
                    ),
                );
            }
            bumpSkills();
        } catch (error) {
            setMarketError(errorMessage(error));
        } finally {
            setBusyId('');
        }
    }

    /**
     * 加载外部清单
     * @param urlInput 指定地址（自动加载时用），不传则用输入框里的
     */
    const handleLoadMarket = useCallback(
        async (urlInput?: string): Promise<void> => {
            const url = (urlInput ?? marketUrl).trim();
            if (url.length === 0) {
                setMarketError('先填一个清单链接');
                return;
            }
            setBusy(true);
            setMarketError('');
            try {
                const result = await window.api.skill.marketLoad(url);
                if (!result.ok) {
                    setMarketError(result.message);
                    return;
                }
                setLoadedSkills(result.items);
                // 记住这个地址，下次打开商店直接自动加载
                if (settings) {
                    await updateSettings({
                        skill: { ...settings.skill, marketIndexUrl: url },
                    });
                }
                pushToast('success', `清单加载成功，共 ${result.items.length} 个技能`);
            } catch (error) {
                setMarketError(errorMessage(error));
            } finally {
                setBusy(false);
            }
        },
        [marketUrl, pushToast, settings, updateSettings],
    );

    // 存过地址就自动加载一次：作者只维护自己的清单时，打开商店就是他的列表
    // autoLoadedUrl 记住试过的地址，失败后不再自动重试（否则 busy 一翻转就会死循环）
    useEffect(() => {
        const saved = settings?.skill.marketIndexUrl ?? '';
        if (!open || tab !== 'market' || saved.length === 0) {
            return;
        }
        if (loadedSkills.length > 0 || busy) {
            return;
        }
        if (autoLoadedUrl.current === saved) {
            return;
        }
        autoLoadedUrl.current = saved;
        void handleLoadMarket(saved);
    }, [open, tab, settings?.skill.marketIndexUrl, loadedSkills.length, busy, handleLoadMarket]);

    /**
     * 把自己写的技能导出成清单 JSON 并复制
     * 作者传到自己仓库，别人贴链接就能用——不需要我这边有服务器
     */
    async function handleExportIndex(): Promise<void> {
        try {
            const json = await window.api.skill.exportIndex();
            await navigator.clipboard.writeText(json);
            pushToast('success', '清单 JSON 已复制，托管到静态站点就能分享');
        } catch (error) {
            pushToast('error', errorMessage(error));
        }
    }

    /**
     * 删除技能（内置技能只能禁用）
     * @param skill 技能
     */
    async function handleRemove(skill: Skill): Promise<void> {
        if (!(await askConfirm(`删除技能「${skill.name}」？删了就找不回来了。`))) {
            return;
        }
        setBusy(true);
        try {
            await window.api.skill.remove(skill.id);
            await reload();
            await reloadMarket();
            bumpSkills();
        } catch (error) {
            pushToast('error', errorMessage(error));
        } finally {
            setBusy(false);
        }
    }

    return (
        <Modal
            open={open}
            title="技能"
            subtitle="技能 = 适用模块 + 触发词 + 指令 + 输出校验。模块对得上、输入里带触发词才生效，不合格会自动重写。"
            onClose={onClose}
            widthClass="max-w-2xl"
            footer={
                <>
                    <button
                        type="button"
                        className="btn-outline text-[13px]"
                        onClick={() => void window.api.skill.reveal()}
                    >
                        打开技能目录
                    </button>
                    <button
                        type="button"
                        className="btn-primary text-[13px]"
                        onClick={() => void handleImportFile()}
                        disabled={busy}
                    >
                        从文件安装
                    </button>
                </>
            }
        >
            {/* 两个页签：已安装 / 商店。装和管分开，避免一屏塞两件事 */}
            <div className="mb-3 flex gap-1 border-b border-ink-800">
                {(
                    [
                        { key: 'installed', label: `已安装 ${skills.length}` },
                        { key: 'market', label: '商店' },
                    ] as Array<{ key: SkillTab; label: string }>
                ).map((item) => (
                    <button
                        type="button"
                        key={item.key}
                        onClick={() => setTab(item.key)}
                        className={`border-b-2 px-3 py-1.5 text-[13px] transition-colors ${
                            tab === item.key
                                ? 'border-jade-500 text-jade-400'
                                : 'border-transparent text-ink-500 hover:text-ink-300'
                        }`}
                    >
                        {item.label}
                    </button>
                ))}
            </div>

            {tab === 'installed' && (
                <div className="space-y-3">
                    {/* 安装区常驻在顶部：这是作者最常见的动作，不该藏在二级菜单里 */}
                    <div className="rounded-xl border border-ink-700 bg-ink-850 p-3">
                        <p className="text-[12px] text-ink-400">
                            把技能内容和链接粘在下面即可安装；也可以直接把 .mjskill 文件拖进窗口。
                        </p>
                        <textarea
                            value={pasteText}
                            onChange={(event) => setPasteText(event.target.value)}
                            rows={3}
                            spellCheck={false}
                            placeholder={
                                '{ "id": "my-skill", "name": "我的技能", "prompt": "..." }\n或 https://example.com/my-skill.mjskill'
                            }
                            className="mt-2 w-full resize-none rounded-lg border border-ink-750 bg-ink-900/60 px-2 py-1.5 text-[12px] leading-relaxed text-ink-100 outline-none placeholder:text-ink-600 focus:border-jade-500/50"
                        />
                        <div className="mt-2 flex items-center justify-between gap-3">
                            <span className="min-w-0 flex-1 truncate text-[11px] text-red-400">
                                {installError}
                            </span>
                            <button
                                type="button"
                                className="btn-primary shrink-0 text-[12px]"
                                onClick={() => void handleInstallPaste()}
                                disabled={busy || pasteText.trim().length === 0}
                            >
                                安装
                            </button>
                        </div>
                    </div>

                    {skills.length === 0 && (
                        <p className="rounded-lg border border-ink-700 bg-ink-850 px-3 py-6 text-center text-[13px] text-ink-500">
                            还没有技能。上面粘一个，或者去「商店」里点一个。
                        </p>
                    )}

                    {skills.map((skill) => (
                        <div
                            key={skill.id}
                            className={`rounded-xl border p-3 transition-colors ${
                                skill.enabled
                                    ? 'border-ink-700 bg-ink-850'
                                    : 'border-ink-800 bg-ink-900 opacity-60'
                            }`}
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                        <span className="text-[14px] leading-none">
                                            {skill.icon ?? '🧩'}
                                        </span>
                                        <span className="text-[13px] font-medium text-ink-100">
                                            {skill.name}
                                        </span>
                                        {/* 全模块通用的只挂一个"通用"，避免三个标签挤成一片 */}
                                        {skill.modules.length === SKILL_MODULES.length ? (
                                            <span className="rounded-full bg-jade-500/10 px-1.5 py-0.5 text-[11px] text-jade-500">
                                                通用
                                            </span>
                                        ) : (
                                            skill.modules.map((module) => (
                                                <span
                                                    key={module}
                                                    className="rounded-full bg-jade-500/10 px-1.5 py-0.5 text-[11px] text-jade-500"
                                                >
                                                    {SKILL_MODULE_LABELS[module]}
                                                </span>
                                            ))
                                        )}
                                        {skill.builtin && (
                                            <span className="rounded-full bg-ink-800 px-1.5 py-0.5 text-[11px] text-ink-400">
                                                内置
                                            </span>
                                        )}
                                        <span className="text-[11px] text-ink-600">
                                            v{skill.version}
                                        </span>
                                    </div>
                                    <p className="mt-1 text-[12px] leading-relaxed text-ink-500">
                                        {skill.description || '（没有说明）'}
                                    </p>
                                    <p className="mt-1 text-[11px] text-ink-600">
                                        触发词：{skill.triggers.join(' / ') || '无'}
                                        {skill.checkers.length > 0
                                            ? ` · ${skill.checkers.length} 条校验`
                                            : ''}
                                        {skill.examples.length > 0
                                            ? ` · ${skill.examples.length} 条示范`
                                            : ''}
                                    </p>
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                    <SkillToggle
                                        enabled={skill.enabled}
                                        busy={busy}
                                        onToggle={() => void handleToggle(skill)}
                                    />
                                    {!skill.builtin && (
                                        <button
                                            type="button"
                                            className="text-[11px] text-ink-600 hover:text-red-400"
                                            onClick={() => void handleRemove(skill)}
                                            disabled={busy}
                                        >
                                            删除
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {tab === 'market' && (
                <div className="space-y-3">
                    <p className="rounded-lg border border-ink-800 bg-ink-900/50 px-3 py-2 text-[12px] leading-relaxed text-ink-500">
                        精选技能随应用内置，断网也能装。装上就是本地文件，随时能停用或删掉。
                    </p>

                    {marketError.length > 0 && (
                        <p className="rounded-lg border border-red-900/40 bg-red-950/20 px-3 py-2 text-[12px] text-red-400">
                            {marketError}
                        </p>
                    )}

                    {marketSkills.map((item) => (
                        <MarketCard
                            key={item.skill.id}
                            item={item}
                            busy={busyId === item.skill.id}
                            onInstall={() => void handleMarketInstall(item, false)}
                        />
                    ))}

                    {/* 外部清单：别人的清单也能一键装，打开商店的扩展口子 */}
                    <div className="rounded-xl border border-ink-700 bg-ink-850 p-3">
                        <p className="text-[12px] text-ink-400">
                            别人维护了清单？贴 index.json 链接就能加载。
                        </p>
                        <div className="mt-2 flex gap-2">
                            <input
                                value={marketUrl}
                                onChange={(event) => setMarketUrl(event.target.value)}
                                spellCheck={false}
                                placeholder="https://example.com/skills/index.json"
                                className="min-w-0 flex-1 rounded-lg border border-ink-750 bg-ink-900/60 px-2 py-1.5 text-[12px] text-ink-100 outline-none placeholder:text-ink-600 focus:border-jade-500/50"
                            />
                            <button
                                type="button"
                                className="btn-outline shrink-0 text-[12px]"
                                onClick={() => void handleLoadMarket()}
                                disabled={busy || marketUrl.trim().length === 0}
                            >
                                加载清单
                            </button>
                        </div>
                        {/* 反向通道：把自己的技能导出成同样的清单，托管出去就成别人的"外部清单" */}
                        <div className="mt-2 flex items-center justify-between gap-2">
                            <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-ink-600">
                                你写的技能也能发出去：复制清单 JSON，传到任意静态站点即可分享。
                            </p>
                            <button
                                type="button"
                                className="shrink-0 text-[11px] text-jade-500 hover:underline"
                                onClick={() => void handleExportIndex()}
                            >
                                复制我的清单
                            </button>
                        </div>
                    </div>

                    {loadedSkills.length > 0 && (
                        <div className="space-y-2">
                            <p className="pt-1 text-[12px] text-ink-500">
                                外部清单（{loadedSkills.length} 个）
                            </p>
                            {loadedSkills.map((item) => (
                                <MarketCard
                                    key={`loaded-${item.skill.id}`}
                                    item={item}
                                    busy={busyId === item.skill.id}
                                    onInstall={() => void handleMarketInstall(item, true)}
                                />
                            ))}
                        </div>
                    )}
                </div>
            )}
        </Modal>
    );
}

/** 商店卡片属性 */
interface MarketCardProps {
    /** 条目 */
    item: MarketSkillState;
    /** 这一张正在装 */
    busy: boolean;
    /** 点安装 */
    onInstall: () => void;
}

/**
 * 商店里的一张技能卡
 * 按钮文案随状态变：安装 / 更新到 vX / 已安装
 * @param props 见 MarketCardProps
 */
function MarketCard({ item, busy, onInstall }: MarketCardProps) {
    const installed = item.installedVersion.length > 0;
    return (
        <div className="rounded-xl border border-ink-750 bg-ink-850 p-3">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[14px] leading-none">{item.skill.icon ?? '🧩'}</span>
                        <span className="text-[13px] font-medium text-ink-100">
                            {item.skill.name}
                        </span>
                        {item.skill.modules.length === SKILL_MODULES.length ? (
                            <span className="rounded-full bg-jade-500/10 px-1.5 py-0.5 text-[11px] text-jade-500">
                                通用
                            </span>
                        ) : (
                            item.skill.modules.map((module) => (
                                <span
                                    key={module}
                                    className="rounded-full bg-jade-500/10 px-1.5 py-0.5 text-[11px] text-jade-500"
                                >
                                    {SKILL_MODULE_LABELS[module]}
                                </span>
                            ))
                        )}
                        <span className="text-[11px] text-ink-600">v{item.skill.version}</span>
                    </div>
                    <p className="mt-1 text-[12px] leading-relaxed text-ink-400">{item.pitch}</p>
                    <p className="mt-1 text-[11px] text-ink-600">
                        触发词：{item.skill.triggers.join(' / ') || '无'}
                    </p>
                </div>
                <button
                    type="button"
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] transition-colors ${
                        item.hasUpdate
                            ? 'bg-jade-500/20 text-jade-500 hover:bg-jade-500/30'
                            : installed
                              ? 'bg-ink-800 text-ink-500'
                              : 'bg-jade-500 text-ink-950 hover:bg-jade-400'
                    }`}
                    onClick={onInstall}
                    disabled={busy || (installed && !item.hasUpdate)}
                    title={installed && !item.hasUpdate ? '已经装过了' : '装上就能用'}
                >
                    {busy
                        ? '安装中…'
                        : item.hasUpdate
                          ? `更新到 v${item.skill.version}`
                          : installed
                            ? '已安装'
                            : '安装'}
                </button>
            </div>
        </div>
    );
}
