# id-pass.ts

**职责**：将对象、活动对象体素、选择和遮罩 id 编码进颜色通道。
**接口**：render、encodeId、decodeId、setLayer。
**内部**：Object pass 编码 `VoxObjectId`；Voxel pass 编码活动对象的局部体素实例 id，并由 Picker 映射回 `{ objectId, VoxelKey }`。处理 RGB24 或更高位编码、边缘留白、透明和深度策略。
**依赖**：three、shader material、scene-types。
