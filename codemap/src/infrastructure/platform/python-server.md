# python-server.ts

**职责**：可选 Python 静态服务器的 TypeScript 进程适配器，负责发现 Python、定位并启动随包 Python 脚本、解析实际监听地址并转发终止信号；静态路由、MIME、安全头和优雅关闭由被启动脚本实现。

**接口**：`resolvePythonRuntime()`、`startPythonServer(options)`、`stopPythonServer(handle)`、`getServerStatus()`、`dispose()`。

**内部**：
- 使用显式运行时路径定位 vendored Python 脚本，开发目录与打包目录必须使用不同的白名单路径；禁止依赖当前工作目录或 shell 字符串拼接。
- `startPythonServer` 通过 `child_process.spawn` 启动脚本并传递 host/port-range 参数；等待 stdout 报告就绪或超时，返回包含实际 URL、fallback 状态、子进程句柄和可重复调用的 stop 函数。
- `stopPythonServer` 先发送 SIGTERM，在超时后升级为 SIGKILL；应用退出、启动失败和 dispose 都必须回收子进程，不能留下孤儿进程。
- 状态只暴露 `stopped|starting|running|stopping|failed` 和诊断信息，不向 UI/领域层暴露子进程对象。

被启动的 `python-server.py` 是随包外部资源，必须保持以下契约：
- 从项目根运行，检查 `src/` 和 `src/index.html` 存在；否则输出当前目录并退出非零。
- 绑定 `localhost`，在 8011–8020 中顺序寻找可用端口；范围耗尽时退出非零。
- `/` 返回 `src/index.html`，`/user/*` 返回 `user/*`，其他路径返回 `src/*`；路径必须规范化并限制在允许根目录内。
- MIME 与 Node 服务器一致，至少覆盖 JavaScript、JSON、CSS、HTML、PNG/JPEG/GIF/SVG、字体、HDR、WebManifest、GLB/GLTF。
- 每个响应设置 `Cross-Origin-Opener-Policy: same-origin`、`Cross-Origin-Embedder-Policy: require-corp`、`Cache-Control: no-cache`；跨源资源按 Node 服务器的 CORS/CORP 规则处理，不能为了省事关闭隔离。
- `SIGINT`/`SIGTERM` 处理函数不得直接调用 `HTTPServer.shutdown()`，必须在后台线程调用以避免与 `serve_forever()` 死锁；`finally` 中调用 `server_close()` 释放 socket。
- 忽略浏览器断开产生的 BrokenPipe/ConnectionAborted/ConnectionReset，不让正常关闭产生 traceback。
- 服务监听成功后再打开默认浏览器；打印实际 URL 和 fallback 提示。

**边界**：本模块只做进程适配，不用 TypeScript 重写静态服务器；Python 脚本不处理编辑器业务、import 或 TRELLIS2 算法。Blender 脚本只消费导出的 JSON，不进入本启动器。Node/Python 服务器都是开发辅助入口，不是 Electron 产物必需文件。

**依赖**：Node `child_process/process`、runtime-config、platform-port、随包 `python-server.py` 资源（Python 标准库 `http.server`、`socketserver`、`signal`、`socket`、`webbrowser`、`pathlib`）。
