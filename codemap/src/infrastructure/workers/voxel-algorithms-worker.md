# voxel-algorithms-worker.ts

**职责**：后台体素算法。
**接口**：findInnerVoxels、resampleVoxels、binaryClosingFillHoles。
**内部**：处理大数据集并报告进度；输入输出均为纯体素快照。
**依赖**：worker-protocol、voxel-types。
