# renderer-port.ts

**职责**：应用层对渲染器的抽象。
**接口**：mount、resize、render、applyPatch、setSelection、setPreview、dispose。
**内部**：禁止暴露 Three.js 类型；所有更新以领域补丁和只读快照表达。
**依赖**：voxel-types、voxel-patch。
