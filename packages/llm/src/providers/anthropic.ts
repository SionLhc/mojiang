/**
 * Anthropic Claude Provider
 * 与 OpenAI 的差别：system 单独字段、必须显式 max_tokens、事件名分得细。
 */

import { describeHttpError, describeNetworkError, readSseData } from '../stream';
import type {
    ChatChunk,
    ChatRequest,
    ConnectionTestResult,
    LLMProvider,
    ModelInfo,
} from '../types';

/** 构造参数 */
export interface AnthropicOptions {
    baseUrl: string;
    apiKey: string;
    fallbackModels: ModelInfo[];
}

/** 流式事件（只声明用到的） */
interface AnthropicEvent {
    type?: string;
    delta?: { type?: string; text?: string };
    usage?: { output_tokens?: number };
    message?: { usage?: { input_tokens?: number } };
}

/** Anthropic provider 实现 */
export class AnthropicProvider implements LLMProvider {
    readonly id = 'anthropic' as const;
    readonly name = 'Anthropic Claude';
    private readonly baseUrl: string;
    private readonly apiKey: string;
    private readonly fallbackModels: ModelInfo[];

    constructor(options: AnthropicOptions) {
        this.baseUrl = options.baseUrl.replace(/\/+$/, '');
        this.apiKey = options.apiKey;
        this.fallbackModels = options.fallbackModels;
    }

    /**
     * 组装请求头
     * @returns 请求头
     */
    private buildHeaders(): Record<string, string> {
        return {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
        };
    }

    /**
     * 流式对话
     * @param request 请求
     * @returns 增量片段
     */
    async *chat(request: ChatRequest): AsyncIterable<ChatChunk> {
        const systemMessage = request.messages
            .filter((message) => message.role === 'system')
            .map((message) => message.content)
            .join('\n\n');
        const dialogue = request.messages
            .filter((message) => message.role !== 'system')
            .map((message) => ({ role: message.role, content: message.content }));

        let response: Response;
        try {
            response = await fetch(`${this.baseUrl}/v1/messages`, {
                method: 'POST',
                headers: this.buildHeaders(),
                body: JSON.stringify({
                    model: request.model,
                    max_tokens: request.maxTokens ?? 4096,
                    system: systemMessage.length > 0 ? systemMessage : undefined,
                    messages: dialogue,
                    temperature: request.temperature,
                    stream: true,
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

        let promptTokens = 0;
        let completionTokens = 0;

        for await (const payload of readSseData(response.body)) {
            let event: AnthropicEvent;
            try {
                event = JSON.parse(payload) as AnthropicEvent;
            } catch {
                continue;
            }

            if (event.type === 'message_start' && event.message?.usage?.input_tokens) {
                promptTokens = event.message.usage.input_tokens;
            }
            if (event.type === 'content_block_delta' && event.delta?.text) {
                yield { delta: event.delta.text, done: false };
            }
            if (event.type === 'message_delta' && event.usage?.output_tokens) {
                completionTokens = event.usage.output_tokens;
            }
            if (event.type === 'message_stop') {
                break;
            }
        }

        yield {
            delta: '',
            done: true,
            usage: { promptTokens, completionTokens },
        };
    }

    /**
     * 拉模型列表
     * @returns 模型清单
     */
    async listModels(): Promise<ModelInfo[]> {
        try {
            const response = await fetch(`${this.baseUrl}/v1/models`, {
                headers: this.buildHeaders(),
            });
            if (!response.ok) {
                return this.fallbackModels;
            }
            const payload = (await response.json()) as { data?: Array<{ id: string; display_name?: string }> };
            const models = payload.data ?? [];
            if (models.length === 0) {
                return this.fallbackModels;
            }
            return models.map((model) => ({
                id: model.id,
                name: model.display_name ?? model.id,
            }));
        } catch {
            return this.fallbackModels;
        }
    }

    /**
     * 测试连接
     * @returns 测试结果
     */
    async testConnection(): Promise<ConnectionTestResult> {
        if (this.apiKey.length === 0) {
            return { ok: false, message: '还没填 API Key' };
        }
        try {
            const response = await fetch(`${this.baseUrl}/v1/models`, {
                headers: this.buildHeaders(),
            });
            if (!response.ok) {
                return { ok: false, message: await describeHttpError(response) };
            }
            return { ok: true, message: '连接成功' };
        } catch (error) {
            return { ok: false, message: describeNetworkError(error) };
        }
    }
}
