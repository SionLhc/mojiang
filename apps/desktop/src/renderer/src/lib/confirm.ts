/**
 * 统一的确认框
 *
 * 走主进程的原生消息框，不再用 window.confirm：
 * window.confirm 关闭后会让中文输入法失效，用户接着新建文档就打不进字了。
 * 原来的文案习惯用空行分段，这里按空行拆成「标题 + 说明」两段显示。
 */

/**
 * 弹确认框，等用户选择
 * @param text 提示文案，空行之后的部分会作为补充说明
 * @returns 用户点了「确定」为 true
 */
export async function askConfirm(text: string): Promise<boolean> {
    const [message, ...rest] = text.split('\n\n');
    const detail = rest.join('\n\n').trim();
    try {
        return await window.api.dialog.confirm(message.trim(), detail.length > 0 ? detail : undefined);
    } catch {
        // 拿不到主进程就当作没同意，避免误删
        return false;
    }
}
