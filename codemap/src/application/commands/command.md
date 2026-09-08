# command.ts

**职责**：所有编辑命令的纯数据契约。
**接口**：Command 可辨识联合；每个命令只包含 type、payload 和 metadata（id、baseVersion、source）。
**内部**：不可变、可序列化的用户意图；不包含 validate、execute、函数引用、状态引用或渲染对象，也不描述最终补丁。
**依赖**：voxel-types、util/math。
