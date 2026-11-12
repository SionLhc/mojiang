import { useState } from 'react';
import { getProjectFeatures } from '@mojiang/core';
import ChatPanel from '@/components/ChatPanel';
import HealthPanel from '@/components/HealthPanel';
import { useAppStore } from '@/store/useAppStore';

/**
 * 右栏容器
 * 两个面板都保持挂载，只切显示，否则切 tab 会把流式输出打断。
 * 页签放在全局状态里，因为开写包面板需要主动切到 AI 对话。
 */
export default function RightPanel() {
    const tab = useAppStore((state) => state.rightTab);
    const setTab = useAppStore((state) => state.setRightTab);
    const book = useAppStore((state) => state.book);
    const [collapsed, setCollapsed] = useState(false);

    // 笔记和文档项目没有"文风体检"，只留 AI 对话
    const showHealth = getProjectFeatures(book?.kind).health;
    const tabs: Array<{ key: 'health' | 'chat'; label: string }> = showHealth
        ? [
              { key: 'health', label: '体检' },
              { key: 'chat', label: 'AI 对话' },
          ]
        : [{ key: 'chat', label: 'AI 对话' }];
    const effectiveTab = showHealth ? tab : 'chat';

    if (collapsed) {
        return (
            <aside className="flex w-8 shrink-0 flex-col items-center border-l border-ink-800 bg-ink-900 py-2">
                <button
                    type="button"
                    className="text-ink-500 hover:text-ink-200"
                    title="展开右栏"
                    onClick={() => setCollapsed(false)}
                >
                    ‹
                </button>
                <span className="mt-3 text-[13px] leading-tight text-ink-500 [writing-mode:vertical-rl]">
                    体检 / AI
                </span>
            </aside>
        );
    }

    return (
        <aside className="flex w-80 shrink-0 flex-col border-l border-ink-800 bg-ink-900">
            <div className="flex h-9 shrink-0 items-center border-b border-ink-800">
                {tabs.map((item) => (
                    <button
                        type="button"
                        key={item.key}
                        onClick={() => setTab(item.key)}
                        className={`flex-1 border-b-2 py-2 text-[13px] transition-colors ${
                            effectiveTab === item.key
                                ? 'border-jade-500 text-jade-400'
                                : 'border-transparent text-ink-500 hover:text-ink-300'
                        }`}
                    >
                        {item.label}
                    </button>
                ))}
                <button
                    type="button"
                    className="w-8 text-ink-500 hover:text-ink-200"
                    title="收起右栏"
                    onClick={() => setCollapsed(true)}
                >
                    ›
                </button>
            </div>

            {showHealth && (
                <div className={effectiveTab === 'health' ? 'min-h-0 flex-1' : 'hidden'}>
                    <HealthPanel />
                </div>
            )}
            <div className={effectiveTab === 'chat' ? 'min-h-0 flex-1' : 'hidden'}>
                <ChatPanel />
            </div>
        </aside>
    );
}
