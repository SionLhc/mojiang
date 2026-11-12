/**
 * 系统提示拼接
 * 放在 core 里是为了能被自检覆盖——"自定义指令是否真的进了请求"
 * 不能只靠肉眼，要有一条能跑通的验证。
 */

/** 自定义指令的抬头，明确告诉模型这段优先级更高 */
const CUSTOM_HEADER =
    '【作者指定的写作指令，优先级高于上面的通用风格要求，必须逐条遵守】';

/**
 * 把内置规则和作者的指令拼成最终的系统提示
 * @param base 内置规则
 * @param styleGuide 作者在设置里写的指令
 * @returns 完整系统提示
 */
export function composeSystemPrompt(base: string, styleGuide: string): string {
    const custom = styleGuide.trim();
    if (custom.length === 0) {
        return base;
    }
    return [base, '', CUSTOM_HEADER, custom].join('\n');
}
