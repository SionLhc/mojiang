/**
 * 主进程入口
 * 安全基线：contextIsolation 开、nodeIntegration 关、禁止窗口内跳转、外链走系统浏览器。
 */

import { app, BrowserWindow, dialog, shell } from 'electron';
import { join } from 'path';
import { registerAllIpc } from './ipc';
import { runPackageSelfTest, runSelfTest } from './selftest';
import { logError, logInfo } from './services/logger';
import { ensureRootDirs, getRootDir } from './services/paths';
import { initSettingsFile, loadSettings } from './services/settings';

/** 是否开发模式 */
const isDev = !app.isPackaged;

/** 主窗口引用，避免被 GC */
let mainWindow: BrowserWindow | null = null;

/**
 * 按当前主题取窗口底色
 * 渲染进程起来之前先铺这个颜色，省得启动时闪一下白或黑
 * @returns 十六进制颜色
 */
function windowBackground(): string {
    const colors: Record<string, string> = {
        paper: '#fbf7ec',
        snow: '#ffffff',
        green: '#e8f0e2',
        night: '#0d1117',
    };
    try {
        const settings = loadSettings();
        return colors[settings.ui.theme] ?? colors.paper;
    } catch {
        return colors.paper;
    }
}

/**
 * 取窗口图标路径
 * 打包后图标在 resources 里（exe 自身的图标因为没签名工具改不了，只能靠这个）
 * @returns 图标绝对路径
 */
function resolveIconPath(): string {
    return app.isPackaged
        ? join(process.resourcesPath, 'icon.png')
        : join(__dirname, '../../build/icon-256.png');
}

/**
 * 创建主窗口
 */
function createWindow(): void {
    mainWindow = new BrowserWindow({
        width: 1440,
        height: 920,
        minWidth: 1080,
        minHeight: 680,
        backgroundColor: windowBackground(),
        icon: resolveIconPath(),
        show: false,
        // 无边框 + 自绘标题栏，视觉上更像一个写作台而不是浏览器
        frame: false,
        titleBarStyle: 'hidden',
        webPreferences: {
            preload: join(__dirname, '../preload/index.js'),
            contextIsolation: true,
            nodeIntegration: false,
            // preload 需要访问 electron 模块，所以关掉 sandbox（沙箱下 preload 只能用有限 API）
            sandbox: false,
            webSecurity: true,
            spellcheck: false,
        },
    });

    mainWindow.on('ready-to-show', () => {
        mainWindow?.show();
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // 窗口内不允许开新窗口，外链交给系统浏览器
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//i.test(url)) {
            void shell.openExternal(url);
        }
        return { action: 'deny' };
    });

    // 防止页面被导航走（比如误点一个链接把整个应用换掉）
    mainWindow.webContents.on('will-navigate', (event, url) => {
        const isDevServer = isDev && url.startsWith('http://localhost');
        if (!isDevServer) {
            event.preventDefault();
        }
    });

    if (isDev && process.env.ELECTRON_RENDERER_URL) {
        void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    } else {
        void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
    }
}

// Windows 任务栏图标与通知归属
if (process.platform === 'win32') {
    app.setAppUserModelId('com.mojiang.desktop');
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    // 已经有实例在跑，直接退出，避免两个窗口同时写同一本书
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) {
                mainWindow.restore();
            }
            mainWindow.focus();
        }
    });

    app.whenReady().then(async () => {
        try {
            ensureRootDirs();
            initSettingsFile();
            logInfo('应用启动', { rootDir: getRootDir(), version: app.getVersion() });
        } catch (error) {
            logError('数据目录创建失败', error);
            dialog.showErrorBox(
                '数据目录用不了',
                `墨匠无法在下面这个位置创建文件夹：\n${getRootDir()}\n\n可能是权限或磁盘问题。启动后可以去 设置 → 数据 里换一个目录。`,
            );
        }

        registerAllIpc();
        createWindow();

        // 冒烟测试：验证主进程能起来、目录能建、渲染进程没白屏
        if (process.argv.includes('--smoke') && mainWindow) {
            try {
                logInfo('核心算法自检结果', runSelfTest());
                logInfo('开写包自检结果', await runPackageSelfTest());
            } catch (error) {
                logError('自检失败', error);
            }
            const smokeWindow = mainWindow;
            smokeWindow.webContents.on('console-message', (_event, level, message) => {
                logInfo(`渲染进程日志[${level}]`, { message });
            });
            smokeWindow.webContents.on('did-finish-load', () => {
                // 等 2.5 秒让 bootstrap 的 IPC 往返跑完，再检查界面到底停在哪一屏
                setTimeout(() => {
                    void (async () => {
                        try {
                            const result = await smokeWindow.webContents.executeJavaScript(
                                `({
                                    rootChildren: document.getElementById('root')?.children.length ?? -1,
                                    hasApi: typeof window.api === 'object',
                                    preview: (document.body.innerText || '').slice(0, 160)
                                })`,
                            );
                            logInfo('渲染进程检查结果', result);
                        } catch (error) {
                            logError('渲染进程检查失败', error);
                        }
                        setTimeout(() => {
                            logInfo('冒烟测试结束，退出');
                            app.quit();
                        }, 400);
                    })();
                }, 2500);
            });
        }

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                createWindow();
            }
        });
    });
}

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
