# transaction.ts

**职责**：把多个场景变更合并为一次原子操作。
**接口**：add、commit、rollback、resultingPatch。
**内部**：收集一次命令产生的 `ScenePatch` 和状态效果，生成单一正反向 `ScenePatch`，并保证一次提交只触发一次场景版本递增；不解释命令，也不直接修改文档。
- 场景结构、节点变换、对象可见性和对象局部体素变更可以在同一事务内组合，但必须共享同一个 `baseSceneVersion`。
- 事务提交前重新校验场景不变量；对象不存在、父子关系非法、版本冲突或补丁合并失败时整体回滚。
- 只读命令（测量、查询、选择）可以返回报告/状态效果，但不能制造空场景版本递增。

**依赖**：scene-patch、scene-types、util/result。
