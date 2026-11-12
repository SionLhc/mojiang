/**
 * 外观常量：主题、字体、缩放
 * 集中放一处，设置界面和运行时应用共用，避免两边写的不一致
 */

import type { SettingsView } from '@shared/api';

/** 界面设置（从设置视图里取，避免两份定义漂移） */
type UiSettings = SettingsView['ui'];

/** 主题 id */
export type ThemeId = UiSettings['theme'];

/** 字体 id */
export type BodyFontId = UiSettings['bodyFont'];

/** 可选主题 */
export const THEMES: Array<{ id: ThemeId; name: string; hint: string; swatch: string }> = [
    { id: 'paper', name: '米黄纸', hint: '长时间写作不刺眼', swatch: '#fbf7ec' },
    { id: 'snow', name: '纯白', hint: '最亮，适合白天', swatch: '#ffffff' },
    { id: 'green', name: '护眼绿', hint: '低饱和绿底，眼睛更放松', swatch: '#e8f0e2' },
    { id: 'night', name: '墨夜', hint: '暗光环境用', swatch: '#0d1117' },
];

/** 可选字体 */
export const BODY_FONTS: Array<{ id: BodyFontId; name: string; stack: string }> = [
    {
        id: 'system',
        name: '系统默认',
        stack: "'Segoe UI', 'Microsoft YaHei', 'PingFang SC', system-ui, sans-serif",
    },
    { id: 'song', name: '宋体', stack: "'SimSun', 'Songti SC', 'Noto Serif SC', serif" },
    { id: 'kai', name: '楷体', stack: "'KaiTi', 'Kaiti SC', 'STKaiti', serif" },
    { id: 'hei', name: '黑体', stack: "'SimHei', 'Heiti SC', 'Noto Sans SC', sans-serif" },
];

/** 可选缩放比例 */
export const UI_SCALES = [0.9, 1, 1.1, 1.2, 1.3];

/**
 * 取字体栈
 * @param id 字体 id
 * @returns CSS font-family
 */
export function fontStack(id: BodyFontId | undefined): string {
    return BODY_FONTS.find((item) => item.id === id)?.stack ?? BODY_FONTS[0].stack;
}

/**
 * 把外观设置应用到文档根节点
 * @param ui 界面设置
 */
export function applyAppearance(ui: UiSettings): void {
    const root = document.documentElement;
    root.dataset.theme = ui.theme;
    root.style.setProperty('--body-font', fontStack(ui.bodyFont));
    root.style.setProperty('--body-font-size', `${Math.min(Math.max(ui.fontSize, 12), 32)}px`);
    window.api.ui.setZoom(ui.uiScale);
}
