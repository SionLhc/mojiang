/**
 * 模型调用 IPC
 * 关键约束：网络请求全部在主进程发，渲染进程拿不到 Key，也绕不过预算检查。
 */

import { ipcMain, type WebContents } from 'electron';
import {
    createProvider,
    DEFAULT_BASE_URLS,
    DEFAULT_PRICES,
    describeNetworkError,
    estimateCost,
    estimatePromptTokens,
    type ProviderId,
} from '@mojiang/llm';
import type { CostEstimate } from '../../shared/api';
import type { LlmChatParams, LlmStreamEvent, ProviderModels } from '../../shared/types';
import { logError, logInfo } from '../services/logger';
import { getApiKey } from '../services/secrets';
import { loadSettings, recordUsage } from '../services/settings';

/** 正在进行的请求，用于取消 */
const activeRequests = new Map<string, AbortController>();

/**
 * 安全地往渲染进程推事件，窗口关了就静默丢弃
 * @param sender 目标
 * @param event 事件
 */
function sendSafe(sender: WebContents, event: LlmStreamEvent): void {
    if (sender.isDestroyed()) {
        return;
    }
    try {
        sender.send('llm:stream', event);
    } catch (error) {
        logError('推送流式事件失败', error);
    }
}

/**
 * 按 provider 建实例，Key 从加密存储里取
 * @param providerId provider
 * @param baseUrl 覆盖基地址
 * @returns provider 实例
 */
function buildProvider(providerId: ProviderId, baseUrl?: string) {
    const apiKey = getApiKey(providerId);
    const resolvedBaseUrl = baseUrl && baseUrl.trim().length > 0 ? baseUrl : DEFAULT_BASE_URLS[providerId];
    return createProvider({ id: providerId, baseUrl: resolvedBaseUrl, apiKey });
}

/**
 * 注册模型相关 IPC
 */
export function registerLlmIpc(): void {
    ipcMain.handle(
        'llm:test',
        async (_event, providerId: ProviderId, baseUrl: string): Promise<{ ok: boolean; message: string }> => {
            try {
                const provider = buildProvider(providerId, baseUrl);
                return await provider.testConnection();
            } catch (error) {
                return { ok: false, message: describeNetworkError(error) };
            }
        },
    );

    ipcMain.handle(
        'llm:models',
        async (_event, providerId: ProviderId, baseUrl: string): Promise<ProviderModels> => {
            try {
                const provider = buildProvider(providerId, baseUrl);
                const models = await provider.listModels();
                return { providerId, models };
            } catch (error) {
                logError('拉模型列表失败', error);
                return { providerId, models: [] };
            }
        },
    );

    ipcMain.handle(
        'llm:estimate',
        async (_event, promptContents: string[], outputTokens: number): Promise<CostEstimate> => {
            const settings = loadSettings();
            const prices = settings.prices ?? DEFAULT_PRICES;
            const promptTokens = estimatePromptTokens(Array.isArray(promptContents) ? promptContents : []);
            const estimatedOutputTokens = Math.max(0, Math.round(outputTokens || 0));
            const costCny = estimateCost(
                settings.provider.id,
                settings.provider.model,
                { promptTokens, completionTokens: estimatedOutputTokens },
                prices,
            );
            return {
                promptTokens,
                estimatedOutputTokens,
                costCny,
                overChapterLimit: costCny > settings.budget.perChapterLimitCny,
                overMonthlyLimit: settings.usage.costCny + costCny > settings.budget.monthlyLimitCny,
            };
        },
    );

    ipcMain.handle('llm:cancel', async (_event, requestId: string) => {
        const controller = activeRequests.get(requestId);
        if (controller) {
            controller.abort();
            activeRequests.delete(requestId);
        }
    });

    ipcMain.handle('llm:chat', async (event, params: LlmChatParams) => {
        const settings = loadSettings();

        if (settings.usage.costCny >= settings.budget.monthlyLimitCny) {
            return {
                accepted: false,
                message: `这个月已经花了 ¥${settings.usage.costCny.toFixed(2)}，到了你设的上限。去设置里调高，或者下个月再用。`,
            };
        }

        if (!params || typeof params.requestId !== 'string' || !Array.isArray(params.messages)) {
            return { accepted: false, message: '调用参数不完整' };
        }

        let provider;
        try {
            provider = buildProvider(params.providerId, settings.provider.baseUrl);
        } catch (error) {
            return { accepted: false, message: describeNetworkError(error) };
        }

        const controller = new AbortController();
        activeRequests.set(params.requestId, controller);
        const sender = event.sender;
        const prices = settings.prices ?? DEFAULT_PRICES;

        // 不 await：立刻把 accepted 返回给界面，流式内容靠事件推
        void (async () => {
            try {
                for await (const chunk of provider.chat({
                    model: params.model,
                    messages: params.messages,
                    temperature: params.temperature,
                    maxTokens: params.maxTokens,
                    signal: controller.signal,
                })) {
                    if (chunk.delta.length > 0) {
                        sendSafe(sender, {
                            requestId: params.requestId,
                            type: 'chunk',
                            delta: chunk.delta,
                        });
                    }
                    if (chunk.done) {
                        const usage = chunk.usage ?? { promptTokens: 0, completionTokens: 0 };
                        const costCny = estimateCost(
                            params.providerId,
                            params.model,
                            usage,
                            prices,
                        );
                        recordUsage(costCny, usage.promptTokens, usage.completionTokens);
                        sendSafe(sender, {
                            requestId: params.requestId,
                            type: 'done',
                            usage,
                            costCny,
                            // 服务端自报的模型名比配置值权威，配置错时会露出来
                            model: chunk.model ?? params.model,
                        });
                        logInfo('模型调用完成', {
                            purpose: params.purpose,
                            configured: params.model,
                            reported: chunk.model ?? null,
                            costCny,
                            promptTokens: usage.promptTokens,
                            completionTokens: usage.completionTokens,
                        });
                    }
                }
            } catch (error) {
                sendSafe(sender, {
                    requestId: params.requestId,
                    type: 'error',
                    message: describeNetworkError(error),
                });
                logError('模型调用失败', error);
            } finally {
                activeRequests.delete(params.requestId);
            }
        })();

        return { accepted: true };
    });
}
