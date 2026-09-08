# history.ts

**职责**：撤销、重做和检查点管理。
**接口**：record、undo、redo、canUndo、canRedo、checkpoint、clear。
**内部**：保存已提交条目的正向与反向补丁、文档版本和标签；undo/redo 只返回待应用补丁，不直接修改 VoxelDocument；支持操作合并和内存上限。
**依赖**：voxel-patch。
