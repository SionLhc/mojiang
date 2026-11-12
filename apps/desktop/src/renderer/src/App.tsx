import { useEffect } from 'react';
import Onboarding from '@/components/Onboarding';
import TitleBar from '@/components/TitleBar';
import Toaster from '@/components/Toaster';
import Workspace from '@/components/Workspace';
import { applyAppearance } from '@/lib/appearance';
import { useAppStore } from '@/store/useAppStore';

/**
 * 应用根组件
 * 启动顺序：拉设置 → 判断是否首次 → 引导页或工作台
 */
export default function App() {
    const ready = useAppStore((state) => state.ready);
    const settings = useAppStore((state) => state.settings);
    const bootstrap = useAppStore((state) => state.bootstrap);

    useEffect(() => {
        void bootstrap();
    }, [bootstrap]);

    // 设置一变就重新套用主题、字体、字号、缩放
    useEffect(() => {
        if (settings) {
            applyAppearance(settings.ui);
        }
    }, [settings]);

    const needOnboarding = ready && settings !== null && !settings.firstRunDone;

    return (
        <div className="flex h-full flex-col bg-ink-950">
            <TitleBar />
            <div className="min-h-0 flex-1">
                {!ready ? (
                    <div className="flex h-full items-center justify-center text-sm text-ink-500">
                        正在打开墨匠…
                    </div>
                ) : settings === null ? (
                    // 读不到设置通常是数据目录没有写权限，这种情况必须说人话
                    <div className="flex h-full flex-col items-center justify-center gap-3">
                        <p className="text-sm text-ink-200">读不到设置文件</p>
                        <p className="max-w-md text-center text-[13px] leading-relaxed text-ink-500">
                            可能是「文档/墨匠」目录没有写权限，或者被安全软件拦了。
                            可以先在磁盘上换个位置，或者用管理员权限跑一次。
                        </p>
                        <button type="button" className="btn-primary" onClick={() => void bootstrap()}>
                            重试
                        </button>
                    </div>
                ) : needOnboarding ? (
                    <Onboarding />
                ) : (
                    <Workspace />
                )}
            </div>
            <Toaster />
        </div>
    );
}
