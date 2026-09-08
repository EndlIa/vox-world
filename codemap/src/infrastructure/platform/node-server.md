# node-server.ts

**职责**：Node.js 本地静态服务器，用于浏览器开发/使用场景；只提供应用文件、`/user` 文件和正确响应头，不进入编辑器 composition root。

**接口**：`createStaticServer(options)`、`findAvailablePort(start=8011, end=8020)`、`start()`、`stop()`、`resolveRequestPath(url)`、`getMimeType(path)`。

**内部**：服务器只读文件，启动时解析根目录，请求时完成 URL 解码、路径规范化和端口状态管理；关闭流程与监听流程共享同一个可重复调用的状态机。

**路由与文件契约**：
- `/` 映射到 `src/index.html`。
- `/user/*` 映射到仓库/打包目录下的 `user/*`。
- 其他路径映射到 `src/<path>`；必须规范化并验证解析后的绝对路径仍位于允许根目录，拒绝 `..`、编码绕过和目录逃逸。
- 目录请求不自动列目录；未知文件返回 404，非法路径返回 400，方法不支持返回 405。
- MIME 至少覆盖 `.html`、`.js`、`.mjs`、`.css`、`.json`、`.webmanifest`、`.png`、`.jpg/.jpeg`、`.gif`、`.svg`、`.ttf`、`.woff`、`.woff2`、`.hdr`、`.glb`、`.gltf`；未知类型回退 `application/octet-stream`。

**安全头与跨源**：
- 所有静态响应必须包含 `Cross-Origin-Opener-Policy: same-origin`、`Cross-Origin-Embedder-Policy: require-corp`、`Cross-Origin-Resource-Policy: same-origin` 和 `Cache-Control: no-cache`。
- 同源静态资源不需要 `Access-Control-Allow-Origin`；需要被 Electron/file renderer 或外部工具读取的 `/user/*` 资源，可显式使用 `Cross-Origin-Resource-Policy: cross-origin`，不得给所有 HTML/JS 默认开放通配 CORS。
- TRELLIS2 与 Minecraft bridge 是独立服务：其 endpoint 必须自行处理 `OPTIONS`、允许配置中的 renderer origin、声明 `Access-Control-Allow-Methods/Headers`，并在需要跨源读取时返回 `Cross-Origin-Resource-Policy: cross-origin`。静态服务器不代理这些服务。
- 远程 HDRI/CDN 资源若与 `require-corp` 不兼容，必须改用 CORS/CORP 合规来源或 vendored 本地资源。

**端口与关闭**：
- 绑定 `127.0.0.1`，从 8011 顺序尝试到 8020；全部占用时打印明确错误并以非零码退出，不静默换到范围外端口。
- SIGINT/SIGTERM 停止接受新连接、关闭 keep-alive 连接并等待在途请求完成；关闭流程必须可重复调用。
- 启动完成后输出实际 URL，并说明是否使用 fallback 端口。

**边界**：不做项目保存、不做 import/TRELLIS2 处理、不加载 user 模块、不修改文件内容。

**依赖**：runtime-config、Node http/fs/path/net/url。

