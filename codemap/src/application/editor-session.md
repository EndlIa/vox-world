# editor-session.ts

**职责**：编辑器用例的总协调者。
**接口**：newProject、open、save、import、export、dispatch、undo、redo、tick。
**内部**：
- 持有 `SceneDocument`、`EditorState`、ObjectSelection、VoxelSelection、ObjectTransformSession、VoxelTransformSession、History、CommandBus 和项目服务；这些状态都有明确所有者，不引入全局单例。
- 派发命令前按模式协调会话：Object 模式先处理 Object XFORM；Edit 模式先处理活动对象的 Voxel XFORM。模式切换、活动对象切换、删除对象和替换场景必须显式 Apply/Cancel 并清理选择。
- Object 模式中拾取和 Selection 只处理 `VoxObjectId`；Edit 模式中只允许 `activeObjectId` 的局部体素进入拾取、选择和命令上下文。
- undo/redo 只应用 History 返回的 `ScenePatch`；应用后必须重新校验 ObjectSelection/activeObjectId：对象被恢复或删除时更新选择，活动对象消失或变为不可见时退出 Edit 并清空 VoxelSelection/XFORM。不得把已删除对象的局部键继续留在会话中。
- 场景替换、打开项目和新建项目建立新的 checkpoint 并清空跨项目 History；打开/新建不得提供“撤销回上一个项目”的语义。
- 协调 RenderSync、PickService 和项目用例，但不包含具体编辑规则，不直接读写 DOM 或 Three.js。

**依赖**：state/scene-document、state/editor-state、state/object-selection、state/voxel-selection、state/object-transform-session、state/voxel-transform-session、state/history、commands、services、ports。
