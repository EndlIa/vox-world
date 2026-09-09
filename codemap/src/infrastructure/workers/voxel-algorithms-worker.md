# voxel-algorithms-worker.ts

**职责**：后台体素算法。
**接口**：findInnerVoxels、resampleVoxels、binaryClosingFillHoles。
**内部**：处理单个 `VoxObject` 的大数据集并报告进度；输入输出均为该对象的纯局部体素快照，不包含 SceneNode 世界变换或其他对象。
**依赖**：worker-protocol、scene-types、voxel-types。
