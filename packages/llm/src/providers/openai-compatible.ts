/**
 * OpenAI 兼容 Provider
 * DeepSeek、OpenAI、以及任何走 /chat/completions 的服务都用这一个实现。
 */

import { describeHttpError, describeNetworkError, readSseData } from '../stream';
import type {
    ChatChunk,
    ChatRequest,
    ConnectionTestResult,
    LLMProvider,
    ModelInfo,
    ProviderId,
} from '../types';

/** OpenAI 兼容 provider 的构造参数 */
export interface OpenAICompatibleOptions {
    id: ProviderId;
    name: string;
    /** 不含结尾斜杠的基地址，如 https://api.deepseek.com/v1 */
    baseUrl: string;
    apiKey: string;
    /** 拉不到模型列表时用的内置清单 */
    fallbackModels: ModelInfo[];
}

/** OpenAI 流式响应里单帧的结构（只声明用到的字段） */
interface OpenAIStreamFrame {
    /** 服务端自报的模型标识 */
    model?: string;
    choices?: Array<{
        delta?: { content?: string };
        finish_reason?: string | null;
    }>;
    usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
    };
}

/** OpenAI 兼容 provider 实现 */
export class OpenAICompatibleProvider implements LLMProvider {
    readonly id: ProviderId;
    readonly name: string;
    private readonly baseUrl: string;
    private readonly apiKey: string;
    private readonly fallbackModels: ModelInfo[];

    constructor(options: OpenAICompatibleOptions) {
        this.id = options.id;
        this.name = options.name;
        this.baseUrl = options.baseUrl.replace(/\/+$/, '');
        this.apiKey = options.apiKey;
        this.fallbackModels = options.fallbackModels;
    }

    /**
     * 拼请求头，Key 为空时不带 Authorization（本地服务通常不需要）
     * @returns 请求头
     */
    private buildHeaders(): Record<string, string> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        if (this.apiKey.length > 0) {
            headers.Authorization = `Bearer ${this.apiKey}`;
        }
        return headers;
    }

    /**
     * 流式对话
     * @param request 请求
     * @returns 增量片段
     */
    async *chat(request: ChatRequest): AsyncIterable<ChatChunk> {
        let response: Response;
        try {
            response = await fetch(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: this.buildHeaders(),
                body: JSON.stringify({
                    model: request.model,
                    messages: request.messages,
                    stream: true,
                    temperature: request.temperature,
                    max_tokens: request.maxTokens,
                }),
                signal: request.signal,
            });
        } catch (error) {
            throw new Error(describeNetworkError(error));
        }

        if (!response.ok) {
            throw new Error(await describeHttpError(response));
        }
        if (!response.body) {
            throw new Error('服务商没有返回数据流，换一个模型试试');
        }

        let finished = false;
        let usage: ChatChunk['usage'];
        let reportedModel: string | undefined;

        for await (const payload of readSseData(response.body)) {
            if (payload === '[DONE]') {
                finished = true;
                break;
            }
            let frame: OpenAIStreamFrame;
            try {
                frame = JSON.parse(payload) as OpenAIStreamFrame;
            } catch {
                // 个别服务商会夹带非 JSON 的心跳，跳过即可
                continue;
            }
            if (frame.model) {
                reportedModel = frame.model;
            }
            if (frame.usage) {
                usage = {
                    promptTokens: frame.usage.prompt_tokens ?? 0,
                    completionTokens: frame.usage.completion_tokens ?? 0,
                };
            }
            const content = frame.choices?.[0]?.delta?.content;
            if (content) {
                yield { delta: content, done: false };
            }
            if (frame.choices?.[0]?.finish_reason) {
                finished = true;
            }
        }

        yield { delta: '', done: true, usage, model: reportedModel };
        if (!finished) {
            // 流被服务端提前掐断，交给上层决定是否重试
            return;
        }
    }

    /**
     * 拉模型列表
     * @returns 模型清单，拉取失败时返回内置清单
     */
    async listModels(): Promise<ModelInfo[]> {
        try {
            const response = await fetch(`${this.baseUrl}/models`, {
                headers: this.buildHeaders(),
            });
            if (!response.ok) {
                return this.fallbackModels;
            }
            const payload = (await response.json()) as { data?: Array<{ id: string }> };
            const models = payload.data ?? [];
            if (models.length === 0) {
                return this.fallbackModels;
            }
            return models.map((model) => ({ id: model.id, name: model.id }));
        } catch {
            return this.fallbackModels;
        }
    }

    /**
     * 测试连接：直接打一次 /models，失败把原因说人话
     * @returns 测试结果
     */
    async testConnection(): Promise<ConnectionTestResult> {
        const startedAt = Date.now();
        try {
            const response = await fetch(`${this.baseUrl}/models`, {
                headers: this.buildHeaders(),
            });
            const latencyMs = Date.now() - startedAt;
            if (!response.ok) {
                return { ok: false, message: await describeHttpError(response) };
            }

            // 顺手把可用模型列出来，作者能确认自己填的模型名确实存在
            let models: string[] = [];
            try {
                const payload = (await response.json()) as { data?: Array<{ id: string }> };
                models = (payload.data ?? []).map((item) => item.id);
            } catch {
                // 有些网关 /models 返回的不是标准结构，拿到清单是加分项，拿不到不影响连接结论
            }

            return {
                ok: true,
                message: models.length > 0 ? `连接成功，可用模型 ${models.length} 个` : '连接成功',
                models,
                latencyMs,
            };
        } catch (error) {
            return { ok: false, message: describeNetworkError(error) };
        }
    }
}
