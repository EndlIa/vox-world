# startup-loader.ts

**职责**：加载本地用户启动项目、用户扩展模块和随包示例清单，同时把文件解析完全委托给 project/import-export 用例。

**接口**：`loadStartupProject(context)`、`loadUserModule(context)`、`listExamples()`、`loadExample(id)`、`disposeUserModule()`。

**内部**：
- 仅当 runtime 为本地、非 hosted 且 `pref_user_startup` 为真时读取 `user/startup.json`；默认新建项目，读取/解析失败时保留默认项目并给出通知。
- `user/startup.json` 的字节交给 ProjectService/project-codec 做当前格式解码和严格校验，loader 不自行理解或改写场景结构、对象局部体素字符串、`AnimationDocument` 或渲染字段；未知版本、旧 `cameraAnimation` 字段和任何迁移/兼容输入都必须由 ProjectService 拒绝，不得由 loader 补字段或修复。
- `user/module.js` 只能在编辑器 ready 后动态导入；hosted 模式、语法错误、import 失败或 `activate` 抛错都必须隔离，主应用继续运行。
- 用户模块使用显式 `UserModuleContext`：只暴露 editor handle、actions、服务端口和 runtime config；禁止依赖全局 `scene`、直接改状态对象或绕过命令/端口。
- 模块可导出 `activate(context)` 与 `deactivate(context)`；dispose 必须按加载顺序逆序调用并等待可等待的清理。
- `src/examples/*.json` 是随包数据/回归样例，通过显式 manifest 列项，不能运行时扫描目录；加载同样走 ProjectService。
- Blender importer 是导出 JSON 的外部消费工具，不属于本项目加载器或 import 管线。

**边界**：不实现项目编解码、不实现 import/voxelization、不执行 TRELLIS2；不把 `user/module.js` 当配置覆盖机制。

**依赖**：runtime-config、preferences、project-service、platform-port。
