# transaction.ts

**职责**：把多个变更合并为一次原子操作。
**接口**：add、commit、rollback、resultingPatch。
**内部**：收集一次命令产生的补丁，生成单一正反向补丁，并保证一次提交只触发一次版本递增；不解释命令，也不直接修改文档。
**依赖**：voxel-patch。
