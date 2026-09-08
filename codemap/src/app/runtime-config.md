# runtime-config.ts

**职责**：在任何状态对象和渲染器创建前，把构建默认值、URL 查询参数、宿主环境变量和显式测试覆盖解析成一份只读、类型安全的 `RuntimeConfig`。

**接口**：`loadRuntimeConfig(overrides?)`、`applyAppIdentity(config, storage, history)`、`resolveServiceUrl(value, fallback)`、`isHostedRuntime(location)`。

**RuntimeConfig 必须包含**：
- `runtimeKind`: `browser`、`electron-renderer` 或 `test`；不得依赖直接判断 `window` 的散落代码。
- `appIdentity`: URL 查询参数 `id`、`localStorage.appid`、60 分钟刷新阈值和 `history.replaceState` 更新规则。
- `query`: `id`、`demo` 等受支持参数；未知参数必须保留。
- `services`: `trellisUrl` 默认 `http://127.0.0.1:8765`，`minecraftBridgeUrl` 默认 `http://127.0.0.1:32123`；只负责地址，不包含 TRELLIS2 或 import 流程。
- `debug`: `clearLocalStorage`、`forceMobile`、`gpuProbe`，默认均为 `false`。
- `assets`: `userStartupUrl`、`userModuleUrl`、`exampleCatalogUrl`；打包后仍使用相对 URL。
- `server`: 本地静态服务器端口范围固定为 `8011` 到 `8020`，默认 `8011`。
- `hosted`: 托管站点模式；该模式禁用 `user/startup.json` 和 `user/module.js`，但不影响本地构建和示例资源。

**内部**：
- 解析顺序固定为显式测试覆盖、宿主/环境配置、构建默认值；不得让 `user/module.js` 改写基础配置。
- 服务 URL 必须是 `http:` 或 `https:` 绝对 URL，去掉尾随 `/`；非法值记录警告并回退默认值，不能阻止编辑器启动。
- `appid` 是运行会话标识，与 Electron Builder 的 `build.appId` 无关；无 `id` 时生成并写入，有 `id` 且超过 60 分钟或不存在时更新，不得触发页面重载。
- `demo=1` 必须在 UI 首次绘制前暴露给根节点初始化。
- 配置对象冻结；调试开关只能在 composition root 消费，不能被领域层读取。

**边界**：本模块不创建编辑器、不访问 DOM 组件、不发起服务请求、不读取项目数据。Node/Python 静态服务器仅复用端口和路径常量；Electron 主进程仅消费窗口/安全头配置。

**依赖**：application types、util/result；storage/history 仅通过 bootstrap 注入的最小接口访问，不依赖具体平台实现。

