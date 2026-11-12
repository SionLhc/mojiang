/**
 * 快速记录
 * 不建项目、不选文件夹，记一句话就走。内容落在固定的「收件箱」项目里。
 */

import type { QuickNoteResult } from '../../shared/types';
import { writeTextFile } from './content';
import { readBookMeta, createBook } from './library';
import { logInfo } from './logger';

/** 收件箱项目名，也是目录名 */
const INBOX_NAME = '收件箱';

/**
 * 生成文件名用的时间戳
 * @returns 形如 20261112-2140
 */
function timestamp(): string {
    const now = new Date();
    const pad = (value: number): string => String(value).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
        now.getHours(),
    )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/**
 * 记一条快速笔记
 * @param text 内容，第一行会被当成标题
 * @returns 落在哪
 */
export async function createQuickNote(text: string): Promise<QuickNoteResult> {
    const content = text.trim();
    if (content.length === 0) {
        throw new Error('内容是空的');
    }

    // 收件箱不存在就建一个笔记类型的项目
    let meta = readBookMeta(INBOX_NAME);
    if (!meta) {
        meta = createBook({
            title: INBOX_NAME,
            genre: '',
            chapterWordTarget: 1000,
            kind: 'notes',
        });
    }

    const firstLine = content.split('\n')[0].trim();
    const title = firstLine.length > 0 ? firstLine.slice(0, 40) : '随手记';
    const stamp = timestamp();
    const path = `随手记-${stamp}`;

    const body = `# ${title}\n\n${content}\n`;
    await writeTextFile(meta.id, `文档/${path}.md`, body);

    logInfo('快速记录', { bookId: meta.id, path });
    return { bookId: meta.id, path, title };
}
