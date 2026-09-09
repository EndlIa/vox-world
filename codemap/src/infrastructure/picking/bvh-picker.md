# bvh-picker.ts

**职责**：CPU 精确对象/体素拾取和回退实现。
**接口**：build、pick、pickMany、invalidate。
**内部**：Object 模式从对象世界包围盒/表面构建对象级 BVH；Edit 模式只为活动对象的局部体素表面构建/查询 BVH，并把世界射线变换到对象局部空间。返回结果必须带 `objectId`，非活动对象在 Edit 模式被过滤。
**依赖**：three-mesh-bvh、pick-result、scene-types、editor-state。
