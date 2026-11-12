/**
 * Provider 工厂
 * 应用层永远通过这里拿 provider，不直接 new 具体实现。
 */

import { AnthropicProvider } from './providers/anthropic';
import { OllamaProvider } from './providers/ollama';
import { OpenAICompatibleProvider } from './providers/openai-compatible';
import type { LLMProvider, ModelInfo, ProviderId, ProviderSettings } from './types';

/** 各 provider 的默认 Base URL */
export const DEFAULT_BASE_URLS: Record<ProviderId, string> = {
    deepseek: 'https://api.deepseek.com/v1',
    openai: 'https://api.openai.com/v1',
    anthropic: 'https://api.anthropic.com',
    ollama: 'http://localhost:11434',
    custom: '',
};

/** 各 provider 的默认模型 */
export const DEFAULT_MODELS: Record<ProviderId, string> = {
    deepseek: 'deepseek-chat',
    openai: 'gpt-4o-mini',
    anthropic: 'claude-3-5-sonnet-latest',
    ollama: 'qwen2.5:7b',
    custom: '',
};

/** provider 展示信息，引导页和设置页都用它 */
export const PROVIDER_INFO: Array<{
    id: ProviderId;
    name: string;
    /** 一句话说明适合谁 */
    description: string;
    /** 去哪里拿 Key 的说明 */
    keyHint: string;
    /** 是否需要 API Key */
    needsKey: boolean;
}> = [
    {
        id: 'deepseek',
        name: 'DeepSeek',
        description: '便宜、中文好，做主力最划算',
        keyHint: '去 platform.deepseek.com 注册 → API keys → 创建',
        needsKey: true,
    },
    {
        id: 'openai',
        name: 'OpenAI',
        description: '英文改写强，价格较高',
        keyHint: '去 platform.openai.com → API keys → 创建',
        needsKey: true,
    },
    {
        id: 'anthropic',
        name: 'Anthropic Claude',
        description: '长文改写稳，适合大段重写',
        keyHint: '去 console.anthropic.com → API keys → 创建',
        needsKey: true,
    },
    {
        id: 'ollama',
        name: 'Ollama 本地',
        description: '完全离线、不花钱，需要本机装 Ollama',
        keyHint: '本机跑 ollama pull qwen2.5:7b，不需要 Key',
        needsKey: false,
    },
    {
        id: 'custom',
        name: '自定义',
        description: '任何 OpenAI 格式的服务都能接',
        keyHint: '填服务商给的 Base URL（含 /v1）和 Key',
        needsKey: true,
    },
];

/** 拉不到模型列表时的兜底清单 */
const FALLBACK_MODELS: Record<ProviderId, ModelInfo[]> = {
    deepseek: [
        { id: 'deepseek-chat', name: 'deepseek-chat（日常写作）' },
        { id: 'deepseek-reasoner', name: 'deepseek-reasoner（推理更强）' },
    ],
    openai: [
        { id: 'gpt-4o-mini', name: 'gpt-4o-mini（便宜）' },
        { id: 'gpt-4o', name: 'gpt-4o（强）' },
    ],
    anthropic: [
        { id: 'claude-3-5-sonnet-latest', name: 'Claude 3.5 Sonnet' },
        { id: 'claude-3-5-haiku-latest', name: 'Claude 3.5 Haiku' },
    ],
    ollama: [
        { id: 'qwen2.5:7b', name: 'qwen2.5:7b（中文写作推荐）' },
        { id: 'llama3.2:3b', name: 'llama3.2:3b（轻量）' },
    ],
    custom: [],
};

/**
 * 按设置创建 provider
 * @param settings provider 设置
 * @returns provider 实例
 */
export function createProvider(settings: ProviderSettings): LLMProvider {
    const baseUrl = (settings.baseUrl ?? DEFAULT_BASE_URLS[settings.id]).trim();

    if (settings.id === 'ollama') {
        return new OllamaProvider({
            baseUrl: baseUrl.length > 0 ? baseUrl : DEFAULT_BASE_URLS.ollama,
            fallbackModels: FALLBACK_MODELS.ollama,
        });
    }

    if (settings.id === 'anthropic') {
        return new AnthropicProvider({
            baseUrl: baseUrl.length > 0 ? baseUrl : DEFAULT_BASE_URLS.anthropic,
            apiKey: settings.apiKey ?? '',
            fallbackModels: FALLBACK_MODELS.anthropic,
        });
    }

    if (baseUrl.length === 0) {
        throw new Error('自定义服务需要先填 Base URL');
    }

    return new OpenAICompatibleProvider({
        id: settings.id,
        name: PROVIDER_INFO.find((item) => item.id === settings.id)?.name ?? settings.id,
        baseUrl,
        apiKey: settings.apiKey ?? '',
        fallbackModels: FALLBACK_MODELS[settings.id],
    });
}
