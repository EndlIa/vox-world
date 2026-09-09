# magica-voxel-importer.ts

**职责**：MagicaVoxel 导入适配器，将文件模型映射为一个或多个局部 `VoxObject` 快照。
**接口**：import、toDomainPatch、paletteMapping。
**内部**：映射坐标、颜色和可见性；多模型输入为每个模型生成独立局部快照和候选节点变换，不把它们压平到同一个全局 `VoxelKey`。导入提交由 Scene 命令/ProjectService 完成。
**依赖**：scene-types、voxel-types、voxel-patch、util/color。
