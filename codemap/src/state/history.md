# history.ts

**职责**：撤销、重做和检查点管理。
**接口**：record、undo、redo、canUndo、canRedo、checkpoint、clear。
**内部**：保存已提交条目的正向与反向 `ScenePatch`、场景版本和标签；undo/redo 只返回待应用补丁，不直接修改 `SceneDocument`；支持操作合并和内存上限。History 不保存动画文档、轨道/关键帧编辑、播放状态或运行时 override。
- 每个历史条目绑定连续的场景版本；对象结构、节点变换、对象可见性和对象局部体素变更都在同一 ScenePatch 历史中按提交顺序记录。
- Duration/Loop/Track/Keyframe 编辑不是 `ScenePatch`，V1 不把它们混入场景 undo/redo，也不因动画编辑创建、合并或失效任何 History 条目。需要回退动画编辑时必须显式删除/替换轨道或关键帧。
- 动画文档编辑不递增 `SceneDocument.version`，也不改变 History 的连续版本链；`ProjectService.projectVersion`/dirty 由项目聚合单独推进，避免动画文档与场景补丁共享伪事务。
- undo/redo 候选补丁若会删除 SceneNode，EditorSession 必须在应用前对当前动画文档做引用预检；被任一 animation track 引用时返回 `node-referenced-by-animation`，不应用补丁、不移动游标。History 本身不解释动画引用，也不自动级联修改动画。
- Undo/Redo 不得绕过 SceneDocument 的版本和场景不变量校验；版本冲突返回错误，不应用部分补丁。
- 切换项目、替换场景和 clear 必须建立显式 checkpoint，不能把旧项目的对象/体素补丁应用到新场景。

**依赖**：scene-patch、scene-types。
