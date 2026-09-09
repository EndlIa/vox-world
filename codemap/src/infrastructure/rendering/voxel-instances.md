# voxel-instances.ts

**职责**：按 `VoxObject` 高效渲染大量局部体素，并维护每个对象的分块实例缓冲、局部实例矩阵、可见性、颜色和连续预览壳；只消费对象局部快照和对象级补丁，不修改领域状态。
**接口**：
- `create`、`createObject`、`applyObjectPatch`、`setChunk`、`rebuildBounds`、`setVisibility`、`dispose`。
- `createTranslucentLayer(id, snapshot, material)`、`updateTranslucentLayer(id, patch)`、`removeTranslucentLayer(id)`。
- `setPreviewShell(snapshot, mask)`、`clearPreviewShell()`。
- `getRenderStats()`、`markAllDirty()`、`rebuildGpuResources()`。

**内部**：
- 每个 `VoxObjectId` 拥有独立的实例命名空间和局部包围盒；实例矩阵只由该对象的局部 `VoxelKey` 生成，父 `SceneNode` 负责世界变换。不同对象的相同局部键不得互相覆盖。
- 使用分块 `InstancedMesh` 或实例属性缓冲；对象级 patch 只更新目标对象的受影响块。
- 支持 6/18/26 邻域无关的渲染可见性更新；渲染层的内部面剔除必须基于当前预览/图层占用 mask，不改变体素数据，也不替代 `optimizeVoxels` 算法。
- **连续体素预览**：同一预览 mask 先生成外露表面，再对相邻单元共享的内部面做剔除，最后使用单层背面剔除的半透明壳材质渲染。禁止为每个体素绘制完整半透明立方体，否则相邻面会重复混色并产生暗缝。
- 持久半透明层与预览壳使用不同的 layer id 和材质生命周期；`removeTranslucentLayer`/`clearPreviewShell` 必须释放对应的克隆材质和 GPU 资源，但不得销毁共享默认材质。
- 所有实例数据保持 CPU 可重建副本或可从 `SceneDocument` 的对象视图重建的引用，以便 WebGL context lost 后 `rebuildGpuResources()` 不依赖失效句柄。
- 分块边界变化、可见性变化和材质更新必须标脏；渲染循环只在脏标记存在时重建，不得每次相机移动都重建实例。

**依赖**：three、voxel-material、domain/scene/scene-types、domain/voxel/voxel-types、domain/voxel/voxel-patch。
