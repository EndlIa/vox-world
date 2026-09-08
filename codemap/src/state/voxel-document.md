# voxel-document.ts

**职责**：当前可编辑体素文档的唯一事实来源。
**接口**：get、has、snapshot、applyPatch、bounds、version、subscribe、clear。
**内部**：使用稀疏 Map 和稳定体素键保存颜色与可见性；按需维护空间索引、包围盒和版本号；applyPatch 只接受已提交补丁，不解释命令、不记录历史、不触发渲染。
**依赖**：voxel-types、voxel-patch、util/packed-int、util/octree。
