# bootstrap.ts

**职责**：应用的唯一 composition root，负责创建一次编辑器会话、按确定顺序装配依赖并在失败时回滚。

**接口**：`createEditor(options)`、`start(editor)`、`stop(editor)`、`dispose(editor)`。

**启动顺序（必须实现）**：
1. 在根节点存在后加载 `runtime-config` 并应用其中的 `appIdentity`；处理 `appid`、`demo` 查询参数，不重载页面。
2. 创建 `Preferences`，完成 localStorage 读取、类型校验和默认值初始化，再据此确定 minimal/mobile/渲染初值。
3. 创建 `SceneDocument`、`EditorState`、`ObjectSelection`、`VoxelSelection`、`ObjectTransformSession`、`VoxelTransformSession`、`History` 等状态对象，以及 repository、renderer、picker、worker、platform、input 等端口实现。
4. 创建 CommandHandler、CommandBus、ProjectService、ImportExportService、RenderSync、PickService 和 EditorSession；所有依赖显式注入 `EditorDependencies`。
5. 初始化 renderer、scene、camera、materials、overlays、worker client、input routers 和 UI view model；任何失败都停止后续阶段。
6. 创建 `lifecycle` 并注册 resize、visibility、pagehide、context-lost/context-restored 和 disposal 监听。
7. 加载项目：本地非 hosted 且 `pref_user_startup` 开启时优先通过 `startup-loader` 读取 `user/startup.json`，否则创建默认项目；失败时保留可用的默认项目并通知。
8. 仅在编辑器完全就绪后加载 `user/module.js`；hosted 模式、加载失败或模块抛错都不得破坏主应用。
9. 启动帧循环，把 ready 状态交给 UI，最后关闭 intro screen。

**内部**：
- 不包含建模、导入导出、渲染或持久化业务规则，只做构造、绑定、排序和回滚。
- `stop` 必须停止新帧、取消动画/worker/服务请求并按依赖逆序释放；`dispose` 幂等。
- 浏览器与 Electron renderer 使用同一 composition root；Electron 主进程只创建窗口，Node/Python 服务器只提供静态资源，均不得直接创建编辑器对象。
- 测试可通过 `options` 注入 runtime config、clock、storage 和端口假实现。
- TRELLIS2 与 import 功能不在本模块补齐范围内；这里只装配其既有服务端口。

**依赖**：app/runtime-config、app/preferences、app/editor-dependencies、app/lifecycle、infrastructure/platform/startup-loader、各层公开接口。
