# web-platform.ts

**职责**：浏览器与 Electron renderer 共用的宿主能力实现，包括文件、下载、剪贴板、存储、URL/history 和页面生命周期事件。

**接口**：实现 platform-port 的 `openFile`、`saveFile`、`readClipboard`、`writeClipboard`；内部提供 `storage`、`history`、`resolveAssetUrl`、`subscribeVisibility`、`subscribePageHide` 和 `capabilities`。

**内部**：
- 文件打开使用隐藏 file input 或 File API；保存使用 Blob + 临时 object URL，并保证在完成或失败后 `revokeObjectURL`。
- 剪贴板权限拒绝、非安全上下文和浏览器不支持时返回明确错误；不得静默丢失用户内容。
- localStorage 访问必须捕获 SecurityError/QuotaExceededError；`appid` 与 `pref_*` 的键由上层决定，本模块不解释业务含义。
- 资源 URL 必须相对当前应用根解析，兼容 `http://localhost` 与 Electron `file://`；不得把 Node 路径或 `node_modules` 暴露给 renderer。
- visibility/pagehide 只负责提供可取消订阅的宿主事件，不自行暂停编辑器；由 lifecycle 统一决策。
- Electron 特有窗口、菜单和主进程能力不进入本模块；需要新增桥接时必须通过显式端口，而不是开启 `nodeIntegration`。

**边界**：不设置 HTTP 安全头、不创建静态服务器、不加载 user 模块、不直接操作 Three.js 或编辑器状态。

**依赖**：platform-port、runtime-config。

