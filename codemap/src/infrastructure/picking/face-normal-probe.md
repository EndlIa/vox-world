# face-normal-probe.ts

**职责**：确定拾取面、法线和相邻体素。
**接口**：probe(screenPoint, pickResult)。
**内部**：优先几何计算，失败时使用 raycast 或相机方向近似；返回稳定的面信息。
**依赖**：three、voxel-query。
