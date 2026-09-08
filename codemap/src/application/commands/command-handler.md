# command-handler.ts

**职责**：解释一种 Command 并执行对应领域规则。
**接口**：canHandle(command)、validate(command, context)、execute(command, context) → CommandOutcome。
**内部**：context 只暴露显式注入的只读状态和纯能力；Handler 负责语义校验并返回正向补丁、事件和错误；反向补丁由 Transaction 生成；不直接修改状态、渲染器或历史。
**依赖**：command、voxel-document、selection、voxel-patch、util/result。
