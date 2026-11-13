import { useEffect, useState } from 'react';
import { DEFAULT_BASE_URLS, DEFAULT_MODELS, PROVIDER_INFO, type ProviderId } from '@mojiang/llm';
import type { AppPaths, ConnectionResult } from '@shared/types';
import Modal from '@/components/Modal';
import {
    BODY_FONTS,
    THEMES,
    UI_SCALES,
    type BodyFontId,
    type ThemeId,
} from '@/lib/appearance';
import { errorMessage } from '@/lib/format';
import { useAppStore } from '@/store/useAppStore';

/** 属性 */
interface SettingsDialogProps {
    open: boolean;
    onClose: () => void;
}

/** 标签页 */
type SettingsTab = 'model' | 'writing' | 'ai' | 'appearance' | 'data';

/** 页签定义，顺序即展示顺序 */
const TABS: Array<{ key: SettingsTab; label: string }> = [
    { key: 'model', label: '模型' },
    { key: 'writing', label: '写作' },
    { key: 'ai', label: 'AI 指令' },
    { key: 'appearance', label: '外观' },
    { key: 'data', label: '数据' },
];

/**
 * 设置弹窗
 * 所有改动点"保存"才生效，避免手滑把 Key 或模型改坏
 */
export default function SettingsDialog({ open, onClose }: SettingsDialogProps) {
    const settings = useAppStore((state) => state.settings);
    const updateSettings = useAppStore((state) => state.updateSettings);
    const refreshBooks = useAppStore((state) => state.refreshBooks);
    const closeBook = useAppStore((state) => state.closeBook);
    const pushToast = useAppStore((state) => state.pushToast);

    const [tab, setTab] = useState<SettingsTab>('model');
    const [providerId, setProviderId] = useState<ProviderId>('deepseek');
    const [baseUrl, setBaseUrl] = useState('');
    const [model, setModel] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [hasKey, setHasKey] = useState(false);
    const [encryption, setEncryption] = useState('');
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<ConnectionResult | null>(null);
    const [paths, setPaths] = useState<AppPaths | null>(null);
    const [version, setVersion] = useState('');

    const [wordTarget, setWordTarget] = useState(3000);
    const [fontSize, setFontSize] = useState(17);
    const [theme, setTheme] = useState<ThemeId>('paper');
    const [uiScale, setUiScale] = useState(1);
    const [bodyFont, setBodyFont] = useState<BodyFontId>('system');
    const [styleGuide, setStyleGuide] = useState('');
    const [forbiddenWords, setForbiddenWords] = useState('');
    const [checklist, setChecklist] = useState('');
    const [perChapterLimit, setPerChapterLimit] = useState(1);
    const [monthlyLimit, setMonthlyLimit] = useState(30);

    // 打开时把当前设置灌进本地表单
    useEffect(() => {
        if (!open || !settings) {
            return;
        }
        setProviderId(settings.provider.id);
        setBaseUrl(settings.provider.baseUrl);
        setModel(settings.provider.model);
        setWordTarget(settings.writing.chapterWordTarget);
        setFontSize(settings.ui.fontSize);
        setTheme(settings.ui.theme);
        setUiScale(settings.ui.uiScale);
        setBodyFont(settings.ui.bodyFont);
        setStyleGuide(settings.ai.styleGuide);
        setForbiddenWords(settings.writing.forbiddenWords.join('、'));
        setChecklist(settings.writing.checklist.join('\n'));
        setPerChapterLimit(settings.budget.perChapterLimitCny);
        setMonthlyLimit(settings.budget.monthlyLimitCny);
        setApiKey('');
        setTestResult(null);

        void (async () => {
            try {
                const [keyExists, encryptionText, appPaths, appVersion] = await Promise.all([
                    window.api.secrets.has(settings.provider.id),
                    window.api.secrets.describe(),
                    window.api.app.paths(),
                    window.api.app.version(),
                ]);
                setHasKey(keyExists);
                setEncryption(encryptionText);
                setPaths(appPaths);
                setVersion(appVersion);
            } catch {
                // 这些是辅助信息，读不到不影响主流程
            }
        })();
    }, [open, settings]);

    if (!settings) {
        return null;
    }

    /**
     * 切换 provider 时把地址和模型换成该家默认值
     * @param id provider
     */
    function selectProvider(id: ProviderId): void {
        setProviderId(id);
        setBaseUrl(DEFAULT_BASE_URLS[id]);
        setModel(DEFAULT_MODELS[id]);
        setTestResult(null);
        void window.api.secrets.has(id).then(setHasKey);
    }

    /**
     * 保存全部设置
     */
    async function handleSave(): Promise<void> {
        if (!settings) {
            return;
        }
        try {
            if (apiKey.trim().length > 0) {
                await window.api.secrets.set(providerId, apiKey.trim());
            }
            await updateSettings({
                provider: { id: providerId, baseUrl, model },
                writing: {
                    chapterWordTarget: wordTarget,
                    forbiddenWords: forbiddenWords
                        .split(/[、,，\s]+/)
                        .map((word) => word.trim())
                        .filter((word) => word.length > 0),
                    checklist: checklist
                        .split('\n')
                        .map((line) => line.trim())
                        .filter((line) => line.length > 0),
                    perspective: settings.writing.perspective,
                },
                ui: { ...settings.ui, fontSize, theme, uiScale, bodyFont },
                ai: { styleGuide },
                budget: { perChapterLimitCny: perChapterLimit, monthlyLimitCny: monthlyLimit },
            });
            setApiKey('');
            setHasKey(await window.api.secrets.has(providerId));
            pushToast('success', '设置已保存');
            onClose();
        } catch (error) {
            pushToast('error', errorMessage(error));
        }
    }

    /**
     * 测试连接，会先把新 Key 存下来再测
     */
    async function handleTest(): Promise<void> {
        setTesting(true);
        setTestResult(null);
        try {
            if (apiKey.trim().length > 0) {
                await window.api.secrets.set(providerId, apiKey.trim());
                setHasKey(true);
            }
            const result = await window.api.llm.test(providerId, baseUrl);
            setTestResult(result);
        } catch (error) {
            setTestResult({ ok: false, message: errorMessage(error) });
        } finally {
            setTesting(false);
        }
    }

    /**
     * 换书库目录
     */
    async function handleChangeRoot(): Promise<void> {
        try {
            const next = await window.api.app.changeRoot();
            if (!next) {
                return;
            }
            setPaths(await window.api.app.paths());
            closeBook();
            await refreshBooks();
            pushToast('success', `书库已切到 ${next}`);
        } catch (error) {
            pushToast('error', errorMessage(error));
        }
    }

    return (
        <Modal
            open={open}
            title="设置"
            subtitle="Key 只存本机，不上传；书稿目录可以随时更换或备份"
            onClose={onClose}
            widthClass="max-w-3xl"
            footer={
                <>
                    <button type="button" className="btn-ghost" onClick={onClose}>
                        取消
                    </button>
                    <button type="button" className="btn-primary" onClick={() => void handleSave()}>
                        保存
                    </button>
                </>
            }
        >
            <div className="mb-4 flex gap-1 border-b border-ink-800">
                {TABS.map((item) => (
                    <button
                        type="button"
                        key={item.key}
                        onClick={() => setTab(item.key)}
                        className={`border-b-2 px-3 py-2 text-[14px] transition-colors ${
                            tab === item.key
                                ? 'border-jade-500 text-jade-400'
                                : 'border-transparent text-ink-500 hover:text-ink-300'
                        }`}
                    >
                        {item.label}
                    </button>
                ))}
            </div>

            {tab === 'model' && (
                <div className="space-y-4">
                    <div>
                        <p className="label">服务商</p>
                        <div className="grid grid-cols-2 gap-2">
                            {PROVIDER_INFO.map((item) => (
                                <button
                                    type="button"
                                    key={item.id}
                                    onClick={() => selectProvider(item.id)}
                                    className={`rounded-md border px-3 py-2 text-left ${
                                        providerId === item.id
                                            ? 'border-jade-500 bg-jade-500/10'
                                            : 'border-ink-700 hover:border-ink-600'
                                    }`}
                                >
                                    <p className="text-[14px] text-ink-100">{item.name}</p>
                                    <p className="mt-0.5 text-[13px] text-ink-500">{item.description}</p>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="label" htmlFor="settings-base-url">
                                Base URL
                            </label>
                            <input
                                id="settings-base-url"
                                className="field"
                                value={baseUrl}
                                onChange={(event) => setBaseUrl(event.target.value)}
                            />
                        </div>
                        <div>
                            <label className="label" htmlFor="settings-model">
                                模型
                            </label>
                            <input
                                id="settings-model"
                                className="field"
                                value={model}
                                onChange={(event) => setModel(event.target.value)}
                            />
                        </div>
                    </div>

                    <div>
                        <label className="label" htmlFor="settings-api-key">
                            API Key {hasKey ? '（已保存，留空表示不改）' : '（还没填）'}
                        </label>
                        <div className="flex gap-2">
                            <input
                                id="settings-api-key"
                                type="password"
                                className="field"
                                placeholder={hasKey ? '••••••••' : '粘贴 Key'}
                                value={apiKey}
                                onChange={(event) => setApiKey(event.target.value)}
                            />
                            <button
                                type="button"
                                className="btn-outline shrink-0"
                                onClick={() => void handleTest()}
                                disabled={testing}
                            >
                                {testing ? '测试中…' : '测试连接'}
                            </button>
                        </div>
                        {encryption && <p className="mt-1.5 text-[13px] text-ink-600">{encryption}</p>}
                        {testResult && (
                            <div className="mt-1.5 space-y-1">
                                <p
                                    className={`text-[13px] ${
                                        testResult.ok ? 'text-jade-400' : 'text-amber-500'
                                    }`}
                                >
                                    {testResult.message}
                                    {testResult.latencyMs !== undefined
                                        ? ` · 延迟 ${testResult.latencyMs}ms`
                                        : ''}
                                </p>

                                {/* 服务端返回的模型清单：确认自己填的模型名确实存在 */}
                                {testResult.models && testResult.models.length > 0 && (
                                    <div className="rounded-md border border-ink-800 bg-ink-850 p-2">
                                        <p className="mb-1 text-[13px] text-ink-500">
                                            服务端可用的模型：
                                        </p>
                                        <div className="flex flex-wrap gap-1">
                                            {testResult.models.map((item) => (
                                                <button
                                                    type="button"
                                                    key={item}
                                                    onClick={() => setModel(item)}
                                                    title="点一下切换到这个模型"
                                                    className={`rounded px-1.5 py-0.5 text-[13px] ${
                                                        item === model
                                                            ? 'bg-jade-500/15 text-jade-400'
                                                            : 'bg-ink-800 text-ink-300 hover:text-ink-100'
                                                    }`}
                                                >
                                                    {item}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="label" htmlFor="settings-per-chapter">
                                单章预算上限（元）
                            </label>
                            <input
                                id="settings-per-chapter"
                                type="number"
                                step="0.1"
                                min="0"
                                className="field"
                                value={perChapterLimit}
                                onChange={(event) => setPerChapterLimit(Number(event.target.value))}
                            />
                        </div>
                        <div>
                            <label className="label" htmlFor="settings-monthly">
                                月度上限（元）
                            </label>
                            <input
                                id="settings-monthly"
                                type="number"
                                step="1"
                                min="0"
                                className="field"
                                value={monthlyLimit}
                                onChange={(event) => setMonthlyLimit(Number(event.target.value))}
                            />
                        </div>
                    </div>

                    <p className="text-[13px] text-ink-600">
                        本月已调用 {settings.usage.calls} 次，输入 {settings.usage.promptTokens} / 输出{' '}
                        {settings.usage.completionTokens} token。
                    </p>
                </div>
            )}

            {tab === 'writing' && (
                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="label" htmlFor="settings-word-target">
                                单章字数目标
                            </label>
                            <input
                                id="settings-word-target"
                                type="number"
                                min="500"
                                step="100"
                                className="field"
                                value={wordTarget}
                                onChange={(event) => setWordTarget(Number(event.target.value))}
                            />
                        </div>
                        <div>
                            <label className="label" htmlFor="settings-font-size">
                                正文字号（px）
                            </label>
                            <input
                                id="settings-font-size"
                                type="number"
                                min="12"
                                max="24"
                                className="field"
                                value={fontSize}
                                onChange={(event) => setFontSize(Number(event.target.value))}
                            />
                        </div>
                    </div>

                    <div>
                        <label className="label" htmlFor="settings-forbidden">
                            禁用词（用、或逗号分隔）
                        </label>
                        <input
                            id="settings-forbidden"
                            className="field"
                            placeholder="例如：不由自主、顿时、这一刻"
                            value={forbiddenWords}
                            onChange={(event) => setForbiddenWords(event.target.value)}
                        />
                        <p className="mt-1 text-[13px] text-ink-600">
                            这些词会写进开写包，AI 写作时会避开。
                        </p>
                    </div>

                    <div>
                        <label className="label" htmlFor="settings-checklist">
                            开写清单（一行一条）
                        </label>
                        <textarea
                            id="settings-checklist"
                            className="field h-28 resize-none"
                            value={checklist}
                            onChange={(event) => setChecklist(event.target.value)}
                        />
                    </div>
                </div>
            )}

            {tab === 'ai' && (
                <div className="space-y-4">
                    <div>
                        <p className="label">写作指令（会附加到每次 AI 请求的系统提示里）</p>
                        <textarea
                            className="field h-44 resize-none leading-relaxed"
                            placeholder={
                                '例如：\n- 保持第三人称限知视角，不写主角看不见的东西\n- 少用形容词堆砌，多用动作和对话推进\n- 对话要短，每个人说话方式要有区别\n- 不主动安排剧情转折，等我说'
                            }
                            value={styleGuide}
                            onChange={(event) => setStyleGuide(event.target.value)}
                        />
                        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-500">
                            这段内容会和内置规则一起发给模型，每一轮对话都生效。留空就只用内置规则。
                            改完点保存，下一句对话立刻按新指令走。
                        </p>
                    </div>

                    <div className="rounded-md border border-ink-800 bg-ink-850 p-3">
                        <p className="text-[13px] text-ink-400">内置规则（不可改，永远在最前面）</p>
                        <ul className="mt-1.5 space-y-1 text-[13px] text-ink-500">
                            <li>· 不替作者决定剧情走向，需要决定时先问一句</li>
                            <li>· 按作者给的章纲和开写包写，不自由发挥</li>
                            <li>· 不整段复述已有正文</li>
                        </ul>
                    </div>
                </div>
            )}

            {tab === 'appearance' && (
                <div className="space-y-5">
                    <div>
                        <p className="label">配色主题</p>
                        <div className="grid grid-cols-4 gap-2">
                            {THEMES.map((item) => (
                                <button
                                    type="button"
                                    key={item.id}
                                    onClick={() => setTheme(item.id)}
                                    className={`rounded-md border p-2 text-left ${
                                        theme === item.id
                                            ? 'border-jade-500 ring-1 ring-jade-500'
                                            : 'border-ink-700 hover:border-ink-600'
                                    }`}
                                >
                                    <span
                                        className="block h-7 w-full rounded border border-ink-700"
                                        style={{ background: item.swatch }}
                                    />
                                    <span className="mt-1.5 block text-[14px] text-ink-100">
                                        {item.name}
                                    </span>
                                    <span className="block text-[13px] leading-snug text-ink-500">
                                        {item.hint}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <p className="label">界面缩放</p>
                        <div className="flex flex-wrap gap-1.5">
                            {UI_SCALES.map((scale) => (
                                <button
                                    type="button"
                                    key={scale}
                                    onClick={() => setUiScale(scale)}
                                    className={`rounded-md border px-3 py-1.5 text-[14px] ${
                                        uiScale === scale
                                            ? 'border-jade-500 bg-jade-500/10 text-jade-400'
                                            : 'border-ink-700 text-ink-300 hover:border-ink-600'
                                    }`}
                                >
                                    {Math.round(scale * 100)}%
                                </button>
                            ))}
                        </div>
                        <p className="mt-1.5 text-[13px] text-ink-500">
                            整块界面等比放大。字还是小就调到 120% 或 130%
                        </p>
                    </div>

                    <div>
                        <p className="label">正文字体</p>
                        <div className="grid grid-cols-4 gap-2">
                            {BODY_FONTS.map((item) => (
                                <button
                                    type="button"
                                    key={item.id}
                                    onClick={() => setBodyFont(item.id)}
                                    style={{ fontFamily: item.stack }}
                                    className={`rounded-md border px-3 py-2 text-[14px] ${
                                        bodyFont === item.id
                                            ? 'border-jade-500 bg-jade-500/10 text-jade-400'
                                            : 'border-ink-700 text-ink-200 hover:border-ink-600'
                                    }`}
                                >
                                    {item.name}
                                </button>
                            ))}
                        </div>
                        <p className="mt-1.5 text-[13px] text-ink-500">只影响正文和预览，界面控件不变</p>
                    </div>

                    <div>
                        <p className="label">正文字号</p>
                        <div className="flex items-center gap-3">
                            <input
                                type="range"
                                min={14}
                                max={26}
                                value={fontSize}
                                onChange={(event) => setFontSize(Number(event.target.value))}
                                className="flex-1"
                                style={{ accentColor: 'rgb(var(--jade-500))' }}
                            />
                            <span className="w-12 text-right text-[14px] text-ink-200">
                                {fontSize}px
                            </span>
                        </div>
                    </div>
                </div>
            )}

            {tab === 'data' && (
                <div className="space-y-4">
                    <div>
                        <p className="label">书稿目录</p>
                        <p className="break-all rounded-md border border-ink-700 bg-ink-850 px-3 py-2 text-[13px] text-ink-300">
                            {paths?.rootDir ?? '读取中…'}
                        </p>
                        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-600">
                            每本书是一个文件夹，Markdown + JSON。可以直接备份、丢网盘、用 Git 管。
                        </p>
                    </div>

                    <div className="flex gap-2">
                        <button
                            type="button"
                            className="btn-outline"
                            onClick={() => void window.api.app.revealRoot()}
                        >
                            在资源管理器里打开
                        </button>
                        <button type="button" className="btn-outline" onClick={() => void handleChangeRoot()}>
                            换一个目录
                        </button>
                    </div>

                    <div>
                        <p className="label">回收站</p>
                        <p className="text-[13px] leading-relaxed text-ink-400">
                            删掉的书和章节会先挪到「回收站」，不会立刻消失。彻底清理需要手动删文件夹。
                        </p>
                    </div>

                    <div>
                        <p className="label">日志</p>
                        <p className="break-all text-[13px] text-ink-400">{paths?.logDir ?? ''}</p>
                        <p className="mt-1 text-[13px] text-ink-600">
                            出问题时把这个目录里的日志发给我，能快很多。
                        </p>
                    </div>

                    <p className="border-t border-ink-800 pt-3 text-[13px] text-ink-600">
                        墨匠 v{version || '0.1.0'} · 数据全部留在本机，只有调模型时正文会发给你选的服务商
                    </p>
                </div>
            )}
        </Modal>
    );
}
