# electron-main.ts

**职责**：Electron 主进程入口，负责单实例、主窗口、菜单、安全头、窗口生命周期和进程退出；不承载编辑器业务。

**接口**：`acquireSingleInstance()`、`createMainWindow()`、`installWindowSecurity()`、`registerAppLifecycle()`、`run()`。

**内部**：
- 在 `app.whenReady()` 前获取单实例锁；第二实例必须通知并聚焦已有窗口，然后以成功状态退出。
- 窗口固定创建为 1200px 宽，Wayland 高度 830px、其他平台 800px，可调整、非置顶、自动隐藏菜单；图标使用打包后的 `src/assets/appicon.png`。
- `webPreferences` 必须显式设置 `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`；当前无 IPC/preload 需求，不得为了文件访问重新开启 Node。
- 通过 `webRequest.onHeadersReceived` 为 renderer 响应设置 `Cross-Origin-Opener-Policy: same-origin` 和 `Cross-Origin-Embedder-Policy: require-corp`；每个头只保留一个有效值，不能同时发送互斥的 `require-corp` 与 `credentialless`。
- 使用 `loadFile(path.join(__dirname, 'src/index.html'))` 加载应用，禁止依赖当前工作目录；加载失败、renderer crash 或 unresponsive 必须显示可诊断错误并进入明确退出路径。
- 菜单至少保留 Reload（F5）和 DevTools（F1）用于开发；生产环境可按 debug 配置隐藏 DevTools，但不得移除窗口恢复能力。
- `window-all-closed` 在非 macOS 退出；macOS 的 `activate` 在无窗口时重建；`before-quit` 取消监听和待处理任务，保证无孤儿进程。
- Electron 不自动启动 TRELLIS2、Minecraft 或 Python 服务；这些服务由用户/脚本独立管理，地址来自 runtime-config。

**边界**：不创建状态、命令、渲染器、UI 或项目对象；不解析导入导出；不绕过 renderer 端口访问文件系统。

**依赖**：runtime-config、platform/packaging 路径约定、Electron app/BrowserWindow/Menu。

