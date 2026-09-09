# voxelizer.ts

**职责**：把网格采样为一个局部 `VoxObject` 的体素快照。
**接口**：voxelize(mesh, options, onProgress)。
**内部**：基于 BVH、射线或表面采样；控制分辨率、闭合和内部填充。
**依赖**：scene-types、three-mesh-bvh、worker-port。
