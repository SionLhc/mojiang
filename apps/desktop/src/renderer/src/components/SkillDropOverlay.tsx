/**
 * 拖拽安装技能时的提示层
 * 放在 App 层渲染，书架页和工作区都能用：作者刚下完文件时常常还停在书架上
 * @param props active 是否正在拖拽技能文件
 */
export default function SkillDropOverlay({ active }: { active: boolean }) {
    if (!active) {
        return null;
    }
    return (
        // pointer-events-none 让鼠标事件穿透，否则会打断 drop
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-ink-950/60 backdrop-blur-sm">
            <div className="rounded-2xl border-2 border-dashed border-jade-500/50 bg-ink-900/85 px-10 py-8 text-center">
                <p className="text-[15px] font-medium text-ink-100">松手安装技能</p>
                <p className="mt-1 text-[12px] text-ink-400">支持 .mjskill 文件</p>
            </div>
        </div>
    );
}
