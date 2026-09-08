# pick-service.ts

**职责**：把屏幕输入转换为领域拾取结果。
**接口**：pick、pickMany、setLayer、setMode。
**内部**：选择 GPU、BVH 或 CPU 拾取实现；把内部实例 id 映射回体素键；处理面与邻接单元。
**依赖**：picker-port、voxel-query、voxel-types。
