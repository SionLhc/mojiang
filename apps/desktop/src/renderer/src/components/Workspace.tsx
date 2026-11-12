import { useEffect, useState } from 'react';
import { getProjectFeatures } from '@mojiang/core';
import EditorPane from '@/components/EditorPane';
import ExportDialog from '@/components/ExportDialog';
import OutlineDialog from '@/components/OutlineDialog';
import QuickNoteDialog from '@/components/QuickNoteDialog';
import RightPanel from '@/components/RightPanel';
import SearchDialog from '@/components/SearchDialog';
import SettingsDialog from '@/components/SettingsDialog';
import Sidebar from '@/components/Sidebar';
import { useAppStore } from '@/store/useAppStore';

/** 自动保存延迟，毫秒 */
const AUTO_SAVE_DELAY = 2500;
/** 自动体检延迟，毫秒。体检是本地计算，可以比保存更勤 */
const AUTO_CHECK_DELAY = 1200;

/**
 * 三栏工作台
 * 左：书库与章节 / 中：编辑器 / 右：体检与 AI
 */
export default function Workspace() {
    const content = useAppStore((state) => state.content);
    const savedContent = useAppStore((state) => state.savedContent);
    const save = useAppStore((state) => state.save);
    const check = useAppStore((state) => state.check);
    const chapterId = useAppStore((state) => state.chapterId);

    const searchOpen = useAppStore((state) => state.searchOpen);
    const quickNoteOpen = useAppStore((state) => state.quickNoteOpen);
    const openSearch = useAppStore((state) => state.openSearch);
    const closeSearch = useAppStore((state) => state.closeSearch);
    const openQuickNote = useAppStore((state) => state.openQuickNote);
    const closeQuickNote = useAppStore((state) => state.closeQuickNote);

    const [focusMode, setFocusMode] = useState(false);
    const [outlineOpen, setOutlineOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [exportOpen, setExportOpen] = useState(false);

    // 自动保存：停下来 2.5 秒就落盘，减少手动 Ctrl+S
    useEffect(() => {
        if (content === savedContent) {
            return;
        }
        const timer = window.setTimeout(() => {
            void save();
        }, AUTO_SAVE_DELAY);
        return () => window.clearTimeout(timer);
    }, [content, savedContent, save]);

    // 自动体检：正文变动后 1.2 秒重算，纯本地，0 token
    // 笔记和文档项目没有体检，直接跳过
    const book = useAppStore((state) => state.book);
    const withHealth = getProjectFeatures(book?.kind).health;
    useEffect(() => {
        if (!withHealth || !chapterId || content.trim().length === 0) {
            return;
        }
        const timer = window.setTimeout(() => {
            void check();
        }, AUTO_CHECK_DELAY);
        return () => window.clearTimeout(timer);
    }, [content, chapterId, check, withHealth]);

    // 快捷键：Ctrl+S 保存，Ctrl+Shift+F 搜索，Ctrl+Shift+N 快速记录
    useEffect(() => {
        const handler = (event: KeyboardEvent): void => {
            const withCtrl = event.ctrlKey || event.metaKey;
            if (!withCtrl) {
                return;
            }
            const key = event.key.toLowerCase();
            if (!event.shiftKey && key === 's') {
                event.preventDefault();
                void save();
                return;
            }
            if (event.shiftKey && key === 'f') {
                event.preventDefault();
                openSearch();
                return;
            }
            if (event.shiftKey && key === 'n') {
                event.preventDefault();
                openQuickNote();
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [save, openSearch, openQuickNote]);

    return (
        <div className="flex h-full min-h-0">
            {!focusMode && (
                <Sidebar
                    onOpenOutline={() => setOutlineOpen(true)}
                    onOpenSettings={() => setSettingsOpen(true)}
                    onOpenExport={() => setExportOpen(true)}
                />
            )}
            <EditorPane
                focusMode={focusMode}
                onToggleFocus={() => {
                    // 进专注模式必须回到正文，否则"专注"的是账本表格
                    if (!focusMode) {
                        useAppStore.getState().setActiveView('chapter');
                    }
                    setFocusMode((value) => !value);
                }}
            />
            {!focusMode && <RightPanel />}

            <OutlineDialog open={outlineOpen} onClose={() => setOutlineOpen(false)} />
            <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
            <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
            <SearchDialog open={searchOpen} onClose={closeSearch} />
            <QuickNoteDialog open={quickNoteOpen} onClose={closeQuickNote} />
        </div>
    );
}
