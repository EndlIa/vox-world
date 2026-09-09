# editor-session.ts

**职责**：编辑器用例的总协调者。
**接口**：newProject、open、save、import、export、dispatch、undo、redo、tick。
**内部**：
- 持有 `SceneDocument`、`EditorState`、ObjectSelection、VoxelSelection、ObjectTransformSession、VoxelTransformSession、History、CommandBus、`AnimationSessionPort` 和项目服务；这些状态都有明确所有者，不引入全局单例。动画文档是项目数据；播放状态与 Node/Camera 运行时 override 只属于 `application/ports/animation-port` 的实现，绝不写入 `SceneDocument`、相机作者态或项目 JSON。
- 提供唯一的 `stopPlaybackAndClearOverride()` 协调入口：调用 `AnimationSessionPort.stopAndClearOverride()` 停止时钟并清除全部 Node/Camera 运行时 override，再恢复编辑器基础相机/节点渲染状态。该操作只改变运行时，不生成 `ScenePatch`、不推进 `SceneDocument.version`、不写 History。
- 派发命令前按模式协调会话：Object 模式先处理 Object XFORM；Edit 模式先处理活动对象的 Voxel XFORM。模式切换、活动对象切换、删除对象和替换场景必须显式 Apply/Cancel 并清理选择。进入 Edit、开始 Object/Voxel XFORM、删除对象绑定节点或执行其他会修改作者态的场景编辑前，必须先成功执行 `stopPlaybackAndClearOverride()`；若调用失败或执行后仍报告 playing/paused/override 活动，则拒绝编辑/变换并返回 `animation-playback-active`。
- `animation.play` 只允许 Object 模式、没有 Object/Voxel XFORM 且没有待提交场景交互时启动；启动前先执行 `stopPlaybackAndClearOverride()` 清除残留 Node/Camera override，再委托 `AnimationSessionPort.play()`。`tick(nowMs)` 只委托 `AnimationSessionPort.tick(nowMs)`；播放时钟、一次 `evaluateAnimation` 和一次 `AnimationApplyPort.applyEvaluation()` 全部由端口实现负责。RenderSync 只读取已应用结果，EditorSession 不得自行求值、应用 override 或复制播放时钟。`SceneDocument` 中的基础局部变换和项目相机作者态保持不变；停止、取消、失败或非循环自然结束后清除全部运行时 override。
- Object 模式中拾取和 Selection 只处理 `VoxObjectId`；Edit 模式中只允许 `activeObjectId` 的局部体素进入拾取、选择和命令上下文。
- 删除对象/绑定节点前先停止播放并清除 override，再通过只读动画引用查询检查节点是否被任一 track 引用。若被引用，返回 `node-referenced-by-animation` 和相关 `trackId`，不派发 SceneCommand、不生成 Patch；V1 不自动级联删除轨道。引用检查通过后才派发 `delete-vox-object`。
- Duration/Loop/Track/Keyframe 编辑前先执行 `stopPlaybackAndClearOverride()`；它们不是 `ScenePatch`，V1 不调用 `History.record`，也不通过 `history.undo/redo` 撤销，而是直接更新动画文档并推进项目版本/dirty。UI 必须用显式删除/替换轨道或关键帧操作完成回退。
- undo/redo 只应用 History 返回的 `ScenePatch`。应用前先执行 `stopPlaybackAndClearOverride()`，再检查候选补丁中所有 `removeNode`/删除对象操作；若任一待删节点仍被动画 track 引用，返回 `node-referenced-by-animation`，不应用补丁也不移动 History 游标。应用后重新校验 ObjectSelection/activeObjectId：对象被恢复或删除时更新选择，活动对象消失或变为不可见时退出 Edit 并清空 VoxelSelection/XFORM。不得把已删除对象的局部键继续留在会话中，也不得留下悬空动画引用。
- 场景替换、打开项目和新建项目先 `stopPlaybackAndClearOverride()`，再建立新的 checkpoint 并清空跨项目 History；打开/新建不得提供“撤销回上一个项目”的语义，也不得保留旧项目的 override 或播放状态。
- 协调 RenderSync、PickService 和项目用例，但不包含具体编辑规则，不直接读写 DOM 或 Three.js。

**依赖**：application/ports/animation-port、state/scene-document、state/editor-state、state/object-selection、state/voxel-selection、state/object-transform-session、state/voxel-transform-session、state/history、commands、services、ports。
