# history.ts

**职责**：撤销、重做和检查点管理。
**接口**：record、undo、redo、canUndo、canRedo、checkpoint、clear。
**内部**：保存已提交条目的正向与反向 `ScenePatch`、场景版本和标签；undo/redo 只返回待应用补丁，不直接修改 `SceneDocument`；支持操作合并和内存上限。
- 每个历史条目绑定连续的场景版本；对象结构、节点变换、对象可见性和对象局部体素变更都在同一 ScenePatch 历史中按提交顺序记录。
- Undo/Redo 不得绕过 SceneDocument 的版本和场景不变量校验；版本冲突返回错误，不应用部分补丁。
- 切换项目、替换场景和 clear 必须建立显式 checkpoint，不能把旧项目的对象/体素补丁应用到新场景。

**依赖**：scene-patch、scene-types。
