# object-transform-session.ts

**职责**：拥有 Object 模式下单个 `VoxObject` 所在 `SceneNode` 的未提交变换预览。

**接口**：
- `begin(objectId, nodeId, baseSceneVersion, originalTransform, mode)`、`setWorkingTransform`、`snapshot`、`previewSnapshot`、`markCommitting`、`commit(currentSceneVersion)`、`cancel`、`dispose`。
- `phase: "idle" | "preview" | "committing" | "cancelled"`、`objectId`、`nodeId`、`baseSceneVersion`。

**内部**：
- 会话只接受一个 `VoxObjectId`，并由 Handler 在 begin 前保证 Object 模式和 ObjectSelection 合法；不得直接变换体素键或修改对象局部网格。
- 保存 `originalTransform` 与 `workingTransform`，两者都是普通 `SceneTransform`。预览只返回普通数据，不泄漏 Three.js 对象。
- 提交时由调用方传入当前场景版本，会话只比较它是否仍等于 `baseSceneVersion`；不一致返回 `stale-version` 并保留预览。成功提交只返回一个 `setNodeTransform` 的 `ScenePatch`，由事务层写入文档。
- 取消不产生 Patch；对象删除、模式切换、场景替换或 context 重建必须取消会话并释放预览。
- 本会话不负责多对象选择、父子重挂载或持久化，也不读取 EditorState；这些由 Scene 命令、EditorSession 和 SceneDocument 规则处理。

**依赖**：scene-types、scene-patch、util/math、util/result。
