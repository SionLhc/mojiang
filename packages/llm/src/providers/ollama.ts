/**
 * Ollama 本地 Provider
 * 完全离线的写作模式靠它，用 NDJSON 而不是 SSE。
 */

import { describeHttpError, describeNetworkError, readLines } from '../stream';
import type {
    ChatChunk,
    ChatRequest,
    ConnectionTestResult,
    LLMProvider,
    ModelInfo,
} from '../types';

/** 构造参数 */
export interface OllamaOptions {
    baseUrl: string;
    fallbackModels: ModelInfo[];
}

/** NDJSON 单行结构 */
interface OllamaFrame {
    message?: { role?: string; content?: string };
    done?: boolean;
    prompt_eval_count?: number;
    eval_count?: number;
}

/** Ollama provider 实现 */
export class OllamaProvider implements LLMProvider {
    readonly id = 'ollama' as const;
    readonly name = 'Ollama 本地';
    private readonly baseUrl: string;
    private readonly fallbackModels: ModelInfo[];

    constructor(options: OllamaOptions) {
        this.baseUrl = options.baseUrl.replace(/\/+$/, '');
        this.fallbackModels = options.fallbackModels;
    }

    /**
     * 流式对话
     * @param request 请求
     * @returns 增量片段
     */
    async *chat(request: ChatRequest): AsyncIterable<ChatChunk> {
        let response: Response;
        try {
            response = await fetch(`${this.baseUrl}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: request.model,
                    messages: request.messages,
                    stream: true,
                    options: {
                        temperature: request.temperature,
                        num_predict: request.maxTokens,
                    },
                }),
                signal: request.signal,
            });
        } catch (error) {
            throw new Error(
                `连不上本地 Ollama（${this.baseUrl}），确认 ollama serve 已经启动。${describeNetworkError(error)}`,
            );
        }

        if (!response.ok) {
            throw new Error(await describeHttpError(response));
        }
        if (!response.body) {
            throw new Error('Ollama 没有返回数据流，检查模型是否已 pull');
        }

        let promptTokens = 0;
        let completionTokens = 0;

        for await (const line of readLines(response.body)) {
            let frame: OllamaFrame;
            try {
                frame = JSON.parse(line) as OllamaFrame;
            } catch {
                continue;
            }
            const content = frame.message?.content;
            if (content) {
                yield { delta: content, done: false };
            }
            if (frame.prompt_eval_count) {
                promptTokens = frame.prompt_eval_count;
            }
            if (frame.eval_count) {
                completionTokens = frame.eval_count;
            }
        }

        yield {
            delta: '',
            done: true,
            usage: { promptTokens, completionTokens },
        };
    }

    /**
     * 拉本地模型列表
     * @returns 模型清单
     */
    async listModels(): Promise<ModelInfo[]> {
        try {
            const response = await fetch(`${this.baseUrl}/api/tags`);
            if (!response.ok) {
                return this.fallbackModels;
            }
            const payload = (await response.json()) as { models?: Array<{ name: string }> };
            const models = payload.models ?? [];
            if (models.length === 0) {
                return this.fallbackModels;
            }
            return models.map((model) => ({ id: model.name, name: model.name }));
        } catch {
            return this.fallbackModels;
        }
    }

    /**
     * 测试连接
     * @returns 测试结果
     */
    async testConnection(): Promise<ConnectionTestResult> {
        try {
            const response = await fetch(`${this.baseUrl}/api/tags`);
            if (!response.ok) {
                return { ok: false, message: await describeHttpError(response) };
            }
            const payload = (await response.json()) as { models?: Array<{ name: string }> };
            const count = payload.models?.length ?? 0;
            if (count === 0) {
                return {
                    ok: true,
                    message: '连上了，但本地还没有模型。先跑 ollama pull qwen2.5:7b',
                };
            }
            return { ok: true, message: `连接成功，本地有 ${count} 个模型` };
        } catch (error) {
            return {
                ok: false,
                message: `连不上本地 Ollama（${this.baseUrl}）。${describeNetworkError(error)}`,
            };
        }
    }
}
