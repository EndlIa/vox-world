# render-sync.ts

**职责**：把领域变化同步到渲染器。
**接口**：syncInitial、applyPatch、syncSelection、syncPreview、invalidate。
**内部**：批量合并变更、按块标脏、保证提交顺序；只读取 VoxelDocument 快照，从不反向修改文档。
**依赖**：renderer-port、voxel-document、voxel-patch。
