/**
 * 开写包：一次取齐 16 项上下文
 * 核心约束：取不到的必须说明原因和补救方法，不许编。
 */

import type { WritingPackage, WritingPackageItem } from './types';

/** 16 项的固定定义，key 与顺序都不能随意改，AI 提示词依赖它 */
export const PACKAGE_SLOTS: Array<{ key: string; label: string; fix: string }> = [
    { key: 'previousTail', label: '上一章承接口', fix: '打开上一章正文，确认它已保存' },
    { key: 'hook', label: '上一章结尾钩子', fix: '在上一章末尾补一个未解决的悬念' },
    { key: 'beatSheet', label: '本章细纲', fix: '在"细纲"里为本章写 3-5 条情节节拍' },
    { key: 'characters', label: '出场人物卡', fix: '在"人设"里补齐本章出场角色的说话方式' },
    { key: 'foreshadows', label: '待回收伏笔', fix: '在"伏笔"里登记已埋的线索' },
    { key: 'forbiddenWords', label: '禁用词', fix: '在设置里填几个你不想再看到的词' },
    { key: 'baseline', label: '六维基线', fix: '选 3 章以上你认可的正文建一次基线' },
    { key: 'anchor', label: '锚段', fix: '挑一段你最满意的正文标为锚段' },
    { key: 'lastReport', label: '上次体检结论', fix: '先对上一章跑一次体检' },
    { key: 'ledger', label: '账本摘要', fix: '在"账本"里记录人物当前状态' },
    { key: 'checklist', label: '开写清单', fix: '在设置里写本章要检查的要点' },
    { key: 'readerExpectation', label: '读者期待', fix: '在细纲里写清前文对读者的承诺' },
    { key: 'timeline', label: '时间线', fix: '在账本里记录当前故事时间' },
    { key: 'constraints', label: '本章硬约束', fix: '确认单章字数目标和叙事人称' },
    { key: 'continuity', label: '连续性提醒', fix: '检查地点、天气、伤势是否接得上' },
    { key: 'styleSample', label: '风格样本段', fix: '从旧章里抄一段满意的文字作为风格参考' },
];

/** 开写包输入：只有取到的项才传，取不到的直接不传 */
export type WritingPackageInput = Partial<Record<string, string>>;

/**
 * 组装开写包
 * @param input 已取到的内容
 * @returns 开写包，缺失项进 degraded
 */
export function assembleWritingPackage(input: WritingPackageInput): WritingPackage {
    const items: WritingPackageItem[] = [];
    const degraded: string[] = [];

    for (const slot of PACKAGE_SLOTS) {
        const content = input[slot.key];
        const hasContent = typeof content === 'string' && content.trim().length > 0;

        if (hasContent) {
            items.push({ key: slot.key, label: slot.label, content: content.trim() });
            continue;
        }

        items.push({
            key: slot.key,
            label: slot.label,
            content: '',
            degradedReason: slot.fix,
        });
        degraded.push(`${slot.label}：${slot.fix}`);
    }

    return {
        items,
        degraded,
        assembledAt: new Date().toISOString(),
    };
}

/**
 * 把开写包渲染成给 AI 的提示块
 * 缺失项也写进去，明确告诉模型"这块没有，不要编"
 * @param pack 开写包
 * @returns 提示文本
 */
export function renderWritingPackagePrompt(pack: WritingPackage): string {
    const lines: string[] = ['【开写包】'];
    for (const item of pack.items) {
        if (item.degradedReason) {
            lines.push(`## ${item.label}`);
            lines.push('（本次没有取到，不要编造，需要时提醒作者补充）');
            continue;
        }
        lines.push(`## ${item.label}`);
        lines.push(item.content);
    }
    return lines.join('\n\n');
}

/**
 * 统计开写包完整度，界面进度条用
 * @param pack 开写包
 * @returns 0-1
 */
export function packageCompleteness(pack: WritingPackage): number {
    if (pack.items.length === 0) {
        return 0;
    }
    const ready = pack.items.filter((item) => !item.degradedReason).length;
    return Math.round((ready / pack.items.length) * 100) / 100;
}
