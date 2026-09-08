# command-bus.ts

**职责**：按命令类型路由 Handler，并协调一次原子命令执行。
**接口**：register、dispatch、subscribe。
**内部**：查找 Handler、执行结构校验和语义校验、收集补丁、通过 Transaction 提交到 VoxelDocument、记录 History 并发布结果；失败时回滚，不包含具体编辑规则。
**依赖**：command、command-handler、transaction、voxel-document、history。
