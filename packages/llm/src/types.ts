/**
 * 模型抽象层类型
 * 应用层只依赖这些类型，换模型不改业务代码。
 */

/** 支持的 provider 标识 */
export type ProviderId = 'deepseek' | 'openai' | 'anthropic' | 'ollama' | 'custom';

/** 一条对话消息 */
export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

/** 一次对话请求 */
export interface ChatRequest {
    model: string;
    messages: ChatMessage[];
    temperature?: number;
    maxTokens?: number;
    /** 用来取消请求，界面点"停止"时用 */
    signal?: AbortSignal;
}

/** token 用量 */
export interface TokenUsage {
    promptTokens: number;
    completionTokens: number;
}

/** 流式输出的一个片段 */
export interface ChatChunk {
    /** 增量文本，可能为空串 */
    delta: string;
    /** 是否已结束 */
    done: boolean;
    /** 只有最后一帧可能带用量 */
    usage?: TokenUsage;
    /**
     * 服务端自报的模型标识
     * 这是唯一可信的"实际在用哪个模型"来源，比配置值权威
     */
    model?: string;
}

/** 可选模型信息 */
export interface ModelInfo {
    id: string;
    name: string;
    contextLength?: number;
}

/** 连接测试结果 */
export interface ConnectionTestResult {
    ok: boolean;
    message: string;
    /** 服务端返回的可用模型 id 清单 */
    models?: string[];
    /** 往返延迟毫秒数 */
    latencyMs?: number;
}

/** Provider 统一接口 */
export interface LLMProvider {
    /** provider 标识 */
    readonly id: ProviderId;
    /** 展示名 */
    readonly name: string;
    /** 流式对话 */
    chat(request: ChatRequest): AsyncIterable<ChatChunk>;
    /** 拉模型列表，不支持列表的 provider 返回内置默认值 */
    listModels(): Promise<ModelInfo[]>;
    /** 测试连接，失败要给出人话原因 */
    testConnection(): Promise<ConnectionTestResult>;
}

/** 创建 provider 需要的设置 */
export interface ProviderSettings {
    id: ProviderId;
    /** API 基地址，留空用默认值 */
    baseUrl?: string;
    /** API Key，存系统加密存储，不进项目目录 */
    apiKey?: string;
    /** 默认模型 */
    model?: string;
}
