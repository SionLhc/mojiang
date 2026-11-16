/**
 * 图片文字识别（本地 OCR）
 * 用 Windows 自带的 OCR 引擎（Windows.Media.Ocr）识别图片里的文字，
 * 不联网、不需要视觉模型。识别结果作为附件交给 AI。
 */

import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { promisify } from 'util';
import { app } from 'electron';
import { logError } from './logger';

const execFileAsync = promisify(execFile);

/** PowerShell OCR 脚本：WinRT 调 Windows.Media.Ocr，输出 UTF-8 */
const OCR_SCRIPT = `param([string]$ImagePath)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]

function Await($WinRtTask, $ResultType) {
    $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'
    })[0].MakeGenericMethod($ResultType)
    $netTask = $asTask.Invoke($null, @($WinRtTask))
    $netTask.Wait(-1) | Out-Null
    $netTask.Result
}

$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($ImagePath)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) {
    Write-Output 'NO_OCR_ENGINE'
    exit 1
}
$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
Write-Output $result.Text
`;

/** 识别结果 */
export interface OcrResult {
    ok: boolean;
    text: string;
    /** 失败原因 */
    message?: string;
}

/**
 * 清掉 OCR 输出的毛病：中文字之间被插的空格、多余空白行
 * @param raw 原始输出
 * @returns 整理后的文字
 */
function tidyOcrText(raw: string): string {
    return raw
        .split('\n')
        .map((line) =>
            line
                .replace(/[ \t]+/g, ' ')
                // 中文与中文之间的空格直接去掉（OCR 常把「测试」识别成「测 试」）
                .replace(/(?<=[\u4e00-\u9fa5])\s+(?=[\u4e00-\u9fa5])/g, '')
                .trim(),
        )
        .filter((line) => line.length > 0)
        .join('\n')
        .trim();
}

/**
 * 脚本每次启动写到 userData 下，避免打包后找不到资源
 * @returns 脚本绝对路径
 */
async function ensureScript(): Promise<string> {
    const target = join(app.getPath('userData'), 'ocr-image.ps1');
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, OCR_SCRIPT, 'utf-8');
    return target;
}

/**
 * 识别一张图片里的文字
 * @param imagePath 图片绝对路径
 * @returns 识别结果
 */
export async function ocrImageFile(imagePath: string): Promise<OcrResult> {
    try {
        const script = await ensureScript();
        const { stdout } = await execFileAsync(
            'powershell.exe',
            ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-ImagePath', imagePath],
            { timeout: 30000, windowsHide: true },
        );
        if (stdout.includes('NO_OCR_ENGINE')) {
            return { ok: false, text: '', message: '这台电脑没装可用的 OCR 语言包，图片识别用不了' };
        }
        const text = tidyOcrText(stdout);
        if (text.length === 0) {
            return { ok: false, text: '', message: '没从图片里认出文字（可能是纯图形）' };
        }
        return { ok: true, text };
    } catch (error) {
        logError('图片识别失败', error);
        return { ok: false, text: '', message: '图片识别失败，换张清晰点的截图试试' };
    }
}

/**
 * 识别内存里的图片（粘贴的截图走这里）
 * @param bytes 图片字节
 * @param mimeType MIME 类型
 * @returns 识别结果
 */
export async function ocrImageBuffer(bytes: Uint8Array, mimeType: string): Promise<OcrResult> {
    const ext = mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpg' : 'png';
    const tempPath = join(app.getPath('temp'), `mojiang-ocr-${randomUUID()}.${ext}`);
    try {
        await writeFile(tempPath, bytes);
        return await ocrImageFile(tempPath);
    } catch (error) {
        logError('图片识别失败', error);
        return { ok: false, text: '', message: '图片识别失败' };
    } finally {
        await unlink(tempPath).catch(() => undefined);
    }
}
