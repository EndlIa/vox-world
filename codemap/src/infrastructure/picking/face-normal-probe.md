# face-normal-probe.ts

**职责**：确定拾取面、法线和相邻体素。
**接口**：probe(screenPoint, pickResult)。
**内部**：优先在目标 `VoxObject` 的局部空间做几何计算，失败时使用 raycast 或相机方向近似；返回稳定的面信息并保留 `objectId`。
**依赖**：three、scene-types、voxel-query。
