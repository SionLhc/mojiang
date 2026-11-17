import { useEffect, useState } from 'react';
import Onboarding from '@/components/Onboarding';
import SkillDropOverlay from '@/components/SkillDropOverlay';
import TitleBar from '@/components/TitleBar';
import Toaster from '@/components/Toaster';
import Workspace from '@/components/Workspace';
import { applyAppearance } from '@/lib/appearance';
import { hasRecentEdit, useAppStore } from '@/store/useAppStore';

/**
 * 应用根组件
 * 启动顺序：拉设置 → 判断是否首次 → 引导页或工作台
 */
export default function App() {
    const ready = useAppStore((state) => state.ready);
    const settings = useAppStore((state) => state.settings);
    const bootstrap = useAppStore((state) => state.bootstrap);
    const pushToast = useAppStore((state) => state.pushToast);
    const bumpSkills = useAppStore((state) => state.bumpSkills);
    /** 是否正拖着技能文件悬在窗口上 */
    const [skillDragOver, setSkillDragOver] = useState(false);

    useEffect(() => {
        void bootstrap();
    }, [bootstrap]);

    // 拖拽安装技能：放在根组件上，书架页和工作区都能拖进来
    useEffect(() => {
        /**
         * 是不是技能文件
         * @param name 文件名
         * @returns 是否交给安装流程
         */
        const isSkillFile = (name: string): boolean => /\.(mjskill|json|txt)$/i.test(name);

        /**
         * 判断这次拖拽要不要接管
         * dragover 阶段拿不到文件名时按 MIME 猜：图片等明显不是技能的直接放行
         * @param event 拖拽事件
         * @returns 是否接管
         */
        const shouldTakeOver = (event: DragEvent): boolean => {
            const transfer = event.dataTransfer;
            if (!transfer) {
                return false;
            }
            const file = transfer.files[0];
            if (file) {
                return isSkillFile(file.name);
            }
            return Array.from(transfer.items).some(
                (item) =>
                    item.kind === 'file' &&
                    (item.type === '' ||
                        item.type === 'application/json' ||
                        item.type.startsWith('text/')),
            );
        };

        const handleDragOver = (event: DragEvent): void => {
            if (!shouldTakeOver(event)) {
                return;
            }
            // 不拦住的话窗口会直接打开这个文件
            event.preventDefault();
            setSkillDragOver(true);
        };

        const handleDragLeave = (event: DragEvent): void => {
            // 只有真正离开窗口才收起提示，否则在子元素间移动会一直闪
            if (event.relatedTarget === null) {
                setSkillDragOver(false);
            }
        };

        const handleDrop = (event: DragEvent): void => {
            const file = event.dataTransfer?.files[0];
            if (!file || !shouldTakeOver(event)) {
                return;
            }
            event.preventDefault();
            setSkillDragOver(false);
            // Electron 32 起 File.path 没了，本地路径要从主进程用 webUtils 取
            const filePath = window.api.attachment.pathForFile(file);
            if (!filePath) {
                pushToast('error', '读不到这个文件的路径，换个方式装吧');
                return;
            }
            void window.api.skill.installPath(filePath).then((result) => {
                if (!result.ok) {
                    pushToast('error', result.message);
                    return;
                }
                pushToast(
                    'success',
                    result.replaced
                        ? `已更新「${result.skill.name}」到 v${result.skill.version}`
                        : `已安装「${result.skill.name}」`,
                );
                bumpSkills();
            });
        };

        window.addEventListener('dragover', handleDragOver);
        window.addEventListener('dragleave', handleDragLeave);
        window.addEventListener('drop', handleDrop);
        return () => {
            window.removeEventListener('dragover', handleDragOver);
            window.removeEventListener('dragleave', handleDragLeave);
            window.removeEventListener('drop', handleDrop);
        };
    }, [pushToast, bumpSkills]);

    // 码字计时心跳：每分钟看一眼，最近 3 分钟编辑过就记 60 秒写作时长
    useEffect(() => {
        const timer = window.setInterval(() => {
            if (hasRecentEdit()) {
                void window.api.stats.record(0, 60);
            }
        }, 60 * 1000);
        return () => window.clearInterval(timer);
    }, []);

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
            <SkillDropOverlay active={skillDragOver} />
            <Toaster />
        </div>
    );
}
