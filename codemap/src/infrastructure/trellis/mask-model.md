# mask-model.ts

**职责**：Trellis 遮罩的独立状态模型。
**接口**：get、set、clear、patch、bounds、serialize。
**内部**：复用体素坐标和补丁思想，但不进入 VoxelDocument。
**依赖**：voxel-types、voxel-patch。
