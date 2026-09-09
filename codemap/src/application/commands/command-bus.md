# command-bus.ts

**职责**：按命令类型路由 Handler，并协调一次原子命令执行。
**接口**：register、dispatch、subscribe。
**内部**：查找 Handler、执行结构校验和语义校验、收集 `ScenePatch`、通过 Transaction 提交到 `SceneDocument`、记录 History 并发布结果；状态效果先验证后提交，失败时回滚，不包含具体编辑规则。
- Object/Edit 模式、活动对象和对象存在性由对应 Handler 校验；CommandBus 不得把 Edit 模式命令路由到非活动对象。
- 场景版本冲突、对象不存在、对象已被删除和模式不匹配都必须在修改 SceneDocument 前失败。

**依赖**：command、command-handler、transaction、scene-document、scene-patch、history。
