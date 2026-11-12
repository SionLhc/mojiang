/**
 * 展示格式化工具
 * 只做"人看的东西"，不参与任何计算逻辑。
 */

/**
 * 字数展示：一万以上用"万字"
 * @param count 字数
 * @returns 展示文本
 */
export function formatCharCount(count: number): string {
    if (count >= 10000) {
        return `${(count / 10000).toFixed(1)} 万字`;
    }
    return `${count} 字`;
}

/**
 * 金额展示
 * @param amount 人民币金额
 * @returns 展示文本
 */
export function formatCny(amount: number): string {
    if (amount <= 0) {
        return '¥0';
    }
    if (amount < 0.01) {
        return `¥${amount.toFixed(4)}`;
    }
    return `¥${amount.toFixed(2)}`;
}

/**
 * 时间展示：今天显示时分，其他显示月日
 * @param iso ISO 时间字符串
 * @returns 展示文本
 */
export function formatTime(iso: string): string {
    if (!iso) {
        return '';
    }
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
        return '';
    }
    const now = new Date();
    const sameDay =
        date.getFullYear() === now.getFullYear() &&
        date.getMonth() === now.getMonth() &&
        date.getDate() === now.getDate();
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    if (sameDay) {
        return `${hh}:${mm}`;
    }
    return `${date.getMonth() + 1}/${date.getDate()} ${hh}:${mm}`;
}

/**
 * 从异常里取人话消息
 * Electron 的 invoke 错误会带 "Error invoking remote method" 前缀，这里剥掉
 * @param error 异常
 * @returns 消息
 */
export function errorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message
            .replace(/^Error invoking remote method '[^']+':\s*/, '')
            .replace(/^Error:\s*/, '');
    }
    return '出了点问题，稍后再试';
}
