/**
 * 流式响应解析工具
 * 三种协议（OpenAI SSE / Anthropic SSE / Ollama NDJSON）共用这一套读流逻辑。
 */

/**
 * 按行读取响应体，只产出以 data: 开头的负载
 * @param body 响应体流
 * @returns data 负载字符串的异步迭代器
 */
export async function* readSseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            // 最后一段可能不完整，留到下一轮
            buffer = lines.pop() ?? '';
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith('data:')) {
                    yield trimmed.slice(5).trim();
                }
            }
        }
        const tail = buffer.trim();
        if (tail.startsWith('data:')) {
            yield tail.slice(5).trim();
        }
    } finally {
        reader.releaseLock();
    }
}

/**
 * 按行读取响应体，产出每一行文本，Ollama 的 NDJSON 用它
 * @param body 响应体流
 * @returns 行字符串的异步迭代器
 */
export async function* readLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.length > 0) {
                    yield trimmed;
                }
            }
        }
        const tail = buffer.trim();
        if (tail.length > 0) {
            yield tail;
        }
    } finally {
        reader.releaseLock();
    }
}

/**
 * 从错误响应里抽出人能看懂的原因
 * 各家错误结构不一致，这里做尽力而为的提取，抽不到就返回原始文本前 200 字
 * @param response 失败的响应
 * @returns 错误说明
 */
export async function describeHttpError(response: Response): Promise<string> {
    let raw = '';
    try {
        raw = await response.text();
    } catch {
        raw = '';
    }

    try {
        const parsed = JSON.parse(raw) as {
            error?: { message?: string } | string;
            message?: string;
        };
        if (typeof parsed.error === 'string') {
            return parsed.error;
        }
        if (parsed.error?.message) {
            return parsed.error.message;
        }
        if (parsed.message) {
            return parsed.message;
        }
    } catch {
        // 不是 JSON，走到下面的兜底
    }

    const hint = mapStatusHint(response.status);
    const body = raw.slice(0, 200);
    return body.length > 0 ? `${hint}（HTTP ${response.status}）${body}` : `${hint}（HTTP ${response.status}）`;
}

/**
 * 常见状态码的人话解释，规划书要求不能只抛 stack trace
 * @param status HTTP 状态码
 * @returns 人话提示
 */
function mapStatusHint(status: number): string {
    if (status === 401 || status === 403) {
        return 'API Key 好像不对，去 设置 → 模型 里重新填一下';
    }
    if (status === 402) {
        return 'API 余额不够了，去服务商后台充值';
    }
    if (status === 404) {
        return '接口地址或模型名不对，检查 Base URL 和模型';
    }
    if (status === 429) {
        return '请求太频繁或超出配额，等一分钟再试';
    }
    if (status >= 500) {
        return '服务商那边出错了，稍后重试或换一个模型';
    }
    return '请求失败';
}

/**
 * 把网络错误转成人话
 * @param error 原始错误
 * @returns 人话提示
 */
export function describeNetworkError(error: unknown): string {
    if (error instanceof Error) {
        if (error.name === 'AbortError') {
            return '已取消';
        }
        if (error.message.includes('fetch failed') || error.message.includes('ECONNREFUSED')) {
            return '网络断了或服务地址连不上，正在用本地功能';
        }
        if (error.message.includes('timeout')) {
            return '模型超时了，要换便宜模型或稍后再试吗';
        }
        return error.message;
    }
    return '未知错误';
}
