# scene-patch.ts

**职责**：描述场景结构、对象变换和对象局部体素的最小、可逆、原子变更。

**接口**：
- `ScenePatchOp`：`addNode`、`removeNode`、`reparentNode`、`renameNode`、`setNodeTransform`、`setNodeVisibility`、`attachObject`、`replaceObjectVoxels`、`applyObjectVoxelPatch`、`replaceScene`。
- `ScenePatch`：`ops`、`changedNodeIds`、`changedObjectIds`、`beforeSceneVersion`、`afterSceneVersion`、`isEmpty`。
- `addNode`、`removeNode`、`reparentNode`、`renameNode`、`setNodeTransform`、`setNodeVisibility`、`attachObject`、`replaceObjectVoxels`、`applyObjectVoxelPatch`、`replaceScene`、`invert`、`merge`。

**内部**：
- `applyObjectVoxelPatch` 内的 `VoxelPatch` 只作用于指定 `objectId` 的局部网格；补丁本身不携带对象 ID 之外的全局坐标语义。
- `replaceObjectVoxels` 保存完整旧/新对象快照，用于生成器、Worker 或模型算法的原子替换；其反向补丁必须恢复精确体素数据。
- `attachObject` 同时建立节点绑定和对象数据；绑定已有对象时必须在同一补丁内原子解除旧绑定。补丁提交后的场景必须满足“每个对象恰好绑定一个节点”，不得产生悬空引用或孤儿对象。
- `removeNode` 第一版只删除对象绑定的叶节点，并同时删除该对象；不得留下子节点或对象。组节点删除留待显式扩展。
- `reparentNode` 只改变父子关系，不隐式改写局部变换；需要保持世界姿态时必须在同一补丁内附带 `setNodeTransform`。根节点不能被删除、重挂载或改变变换。
- `replaceScene` 用于一次可撤销的编辑器内场景替换；与其他操作互斥，并保存完整旧场景。打开项目或新建项目必须清空 History/建立新 checkpoint，不得用该补丁形成跨项目 Undo。
- 同一补丁内按稳定顺序归一化；对象和节点 ID 去重；最终场景必须通过 `scene-query.validateScene`，且每个 `VoxObject` 恰好被一个节点绑定。
- 补丁只表达数据变化，不修改 `SceneDocument`、History、渲染器、Selection、EditorState 或 UI。
- `invert` 必须能从正向补丁恢复精确场景结构、变换、可见性和局部体素；`merge` 只在版本连续且语义可合并时允许。
- 空补丁合法，不递增场景版本。

**依赖**：scene-types、voxel-patch、voxel-types、util/result。
