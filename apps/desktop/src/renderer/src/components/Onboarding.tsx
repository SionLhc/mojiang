import { useState } from 'react';
import { DEFAULT_BASE_URLS, DEFAULT_MODELS, PROVIDER_INFO, type ProviderId } from '@mojiang/llm';
import type { ConnectionResult } from '@shared/types';
import { errorMessage } from '@/lib/format';
import { useAppStore } from '@/store/useAppStore';

/** 步骤定义 */
const STEPS = ['欢迎', '选模型', '填 Key', '测试连接', '建第一本书'];

/**
 * 首次启动引导
 * 硬规则：任何一步都能跳过，不接模型也能用体检和账本
 */
export default function Onboarding() {
    const updateSettings = useAppStore((state) => state.updateSettings);
    const createBook = useAppStore((state) => state.createBook);
    const pushToast = useAppStore((state) => state.pushToast);

    const [step, setStep] = useState(0);
    const [providerId, setProviderId] = useState<ProviderId>('deepseek');
    const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URLS.deepseek);
    const [model, setModel] = useState(DEFAULT_MODELS.deepseek);
    const [apiKey, setApiKey] = useState('');
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<ConnectionResult | null>(null);
    const [bookTitle, setBookTitle] = useState('');
    const [genre, setGenre] = useState('都市');

    const providerInfo = PROVIDER_INFO.find((item) => item.id === providerId);

    /**
     * 选 provider 时把地址和模型重置成默认值
     * @param id provider
     */
    function selectProvider(id: ProviderId): void {
        setProviderId(id);
        setBaseUrl(DEFAULT_BASE_URLS[id]);
        setModel(DEFAULT_MODELS[id]);
        setTestResult(null);
    }

    /**
     * 保存 Key 并测试连接
     */
    async function handleTest(): Promise<void> {
        setTesting(true);
        setTestResult(null);
        try {
            if (apiKey.trim().length > 0) {
                await window.api.secrets.set(providerId, apiKey.trim());
            }
            await updateSettings({ provider: { id: providerId, baseUrl, model } });
            const result = await window.api.llm.test(providerId, baseUrl);
            setTestResult(result);
        } catch (error) {
            setTestResult({ ok: false, message: errorMessage(error) });
        } finally {
            setTesting(false);
        }
    }

    /**
     * 结束引导，写设置并可选择建一本书
     * @param withBook 是否顺手建书
     */
    async function finish(withBook: boolean): Promise<void> {
        try {
            await updateSettings({
                firstRunDone: true,
                provider: { id: providerId, baseUrl, model },
            });
            if (withBook && bookTitle.trim().length > 0) {
                await createBook({ title: bookTitle.trim(), genre, chapterWordTarget: 3000 });
            }
        } catch (error) {
            pushToast('error', errorMessage(error));
        }
    }

    return (
        <div className="flex h-full items-center justify-center bg-ink-950 px-6">
            <div className="flex w-full max-w-3xl overflow-hidden rounded-xl border border-ink-800 bg-ink-900 shadow-2xl">
                {/* 左侧步骤条 */}
                <aside className="w-48 shrink-0 border-r border-ink-800 bg-ink-850 px-4 py-6">
                    <p className="mb-6 text-[14px] font-semibold tracking-widest text-ink-500">开始使用</p>
                    <ol className="space-y-4">
                        {STEPS.map((label, index) => (
                            <li key={label} className="flex items-center gap-2 text-[14px]">
                                <span
                                    className={`flex h-5 w-5 items-center justify-center rounded-full text-[13px] ${
                                        index < step
                                            ? 'bg-jade-600 text-ink-950'
                                            : index === step
                                              ? 'bg-jade-500 text-ink-950'
                                              : 'bg-ink-750 text-ink-500'
                                    }`}
                                >
                                    {index < step ? '✓' : index + 1}
                                </span>
                                <span className={index <= step ? 'text-ink-200' : 'text-ink-500'}>{label}</span>
                            </li>
                        ))}
                    </ol>
                    <p className="mt-8 text-[13px] leading-relaxed text-ink-500">
                        不想接模型也可以先用。体检、账本、伏笔都是本地算，零成本。
                    </p>
                </aside>

                {/* 右侧内容 */}
                <div className="flex min-h-[430px] flex-1 flex-col p-8">
                    <div className="flex-1">
                        {step === 0 && (
                            <div className="space-y-4">
                                <h1 className="text-xl font-semibold text-ink-100">墨匠是什么</h1>
                                <p className="text-sm leading-relaxed text-ink-300">
                                    一个本地运行的网文写作台。你定方向、定设定、拍板；AI 负责写、改、查。
                                </p>
                                <ul className="space-y-2 text-sm text-ink-300">
                                    <li>· 每本书就是磁盘上一个文件夹，Markdown + JSON，随时能打开</li>
                                    <li>· 换模型不改数据，基线、账本、伏笔全部与模型无关</li>
                                    <li>· 体检和落账在本地算，不花一分钱</li>
                                    <li>· 只有调模型时，正文才会发给你选的服务商</li>
                                </ul>
                            </div>
                        )}

                        {step === 1 && (
                            <div className="space-y-3">
                                <h1 className="text-xl font-semibold text-ink-100">选一个模型服务</h1>
                                <p className="text-[14px] text-ink-400">以后随时能在设置里换，不影响已有书稿。</p>
                                <div className="grid grid-cols-2 gap-2">
                                    {PROVIDER_INFO.map((item) => (
                                        <button
                                            type="button"
                                            key={item.id}
                                            onClick={() => selectProvider(item.id)}
                                            className={`rounded-lg border p-3 text-left transition-colors ${
                                                providerId === item.id
                                                    ? 'border-jade-500 bg-jade-500/10'
                                                    : 'border-ink-700 hover:border-ink-600 hover:bg-ink-850'
                                            }`}
                                        >
                                            <p className="text-sm font-medium text-ink-100">{item.name}</p>
                                            <p className="mt-1 text-[13px] leading-relaxed text-ink-400">
                                                {item.description}
                                            </p>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {step === 2 && (
                            <div className="space-y-4">
                                <h1 className="text-xl font-semibold text-ink-100">填写 API Key</h1>
                                <p className="text-[14px] leading-relaxed text-ink-400">
                                    {providerInfo?.keyHint}
                                </p>
                                <div>
                                    <label className="label" htmlFor="api-key">
                                        API Key
                                    </label>
                                    <input
                                        id="api-key"
                                        type="password"
                                        className="field"
                                        placeholder={providerInfo?.needsKey ? 'sk-...' : '本地模型不需要 Key'}
                                        value={apiKey}
                                        onChange={(event) => setApiKey(event.target.value)}
                                        disabled={!providerInfo?.needsKey}
                                    />
                                    <p className="mt-2 text-[13px] text-ink-500">
                                        Key 用系统钥匙串加密存在本机，不会写进书稿目录，也不会发到任何服务器。
                                    </p>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="label" htmlFor="base-url">
                                            Base URL
                                        </label>
                                        <input
                                            id="base-url"
                                            className="field"
                                            value={baseUrl}
                                            onChange={(event) => setBaseUrl(event.target.value)}
                                        />
                                    </div>
                                    <div>
                                        <label className="label" htmlFor="model-name">
                                            默认模型
                                        </label>
                                        <input
                                            id="model-name"
                                            className="field"
                                            value={model}
                                            onChange={(event) => setModel(event.target.value)}
                                        />
                                    </div>
                                </div>
                            </div>
                        )}

                        {step === 3 && (
                            <div className="space-y-4">
                                <h1 className="text-xl font-semibold text-ink-100">测试一下连接</h1>
                                <p className="text-[14px] text-ink-400">
                                    测试只会请求一次模型列表，不会消耗你的额度。
                                </p>
                                <button
                                    type="button"
                                    className="btn-outline"
                                    onClick={() => void handleTest()}
                                    disabled={testing}
                                >
                                    {testing ? '正在测试…' : '测试连接'}
                                </button>
                                {testResult && (
                                    <div
                                        className={`rounded-md border px-3 py-2 text-[14px] leading-relaxed ${
                                            testResult.ok
                                                ? 'border-jade-600 bg-jade-600/10 text-jade-400'
                                                : 'border-amber-500/60 bg-amber-500/10 text-amber-500'
                                        }`}
                                    >
                                        {testResult.message}
                                        {!testResult.ok && (
                                            <p className="mt-1 text-ink-400">
                                                可以先跳过，用本地功能写；之后在 设置 → 模型 里再配。
                                            </p>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {step === 4 && (
                            <div className="space-y-4">
                                <h1 className="text-xl font-semibold text-ink-100">建第一本书</h1>
                                <div>
                                    <label className="label" htmlFor="book-title">
                                        书名
                                    </label>
                                    <input
                                        id="book-title"
                                        className="field"
                                        placeholder="例如：我本想摆烂"
                                        value={bookTitle}
                                        onChange={(event) => setBookTitle(event.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="label" htmlFor="book-genre">
                                        题材
                                    </label>
                                    <input
                                        id="book-genre"
                                        className="field"
                                        value={genre}
                                        onChange={(event) => setGenre(event.target.value)}
                                    />
                                </div>
                                <p className="text-[13px] text-ink-500">
                                    目录会建在「文档/墨匠/书库/书名」，你可以随时用资源管理器打开、备份、丢进网盘。
                                </p>
                            </div>
                        )}
                    </div>

                    {/* 底部按钮 */}
                    <div className="mt-6 flex items-center justify-between border-t border-ink-800 pt-4">
                        <button
                            type="button"
                            className="btn-ghost"
                            onClick={() => void finish(false)}
                            title="跳过引导，稍后再配"
                        >
                            跳过，直接用本地功能
                        </button>
                        <div className="flex gap-2">
                            {step > 0 && (
                                <button type="button" className="btn-outline" onClick={() => setStep(step - 1)}>
                                    上一步
                                </button>
                            )}
                            {step < 4 ? (
                                <button
                                    type="button"
                                    className="btn-primary"
                                    onClick={() => setStep(step + 1)}
                                >
                                    下一步
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    className="btn-primary"
                                    onClick={() => void finish(true)}
                                >
                                    开始写
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
