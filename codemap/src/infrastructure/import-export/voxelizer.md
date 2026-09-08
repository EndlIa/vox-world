# voxelizer.ts

**职责**：把网格采样为体素。
**接口**：voxelize(mesh, options, onProgress)。
**内部**：基于 BVH、射线或表面采样；控制分辨率、闭合和内部填充。
**依赖**：three-mesh-bvh、worker-port。
