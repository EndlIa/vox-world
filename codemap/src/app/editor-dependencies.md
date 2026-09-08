# editor-dependencies.ts

**职责**：显式保存一次编辑器实例所需的依赖对象集合，作为 composition root 与所有运行时模块之间的稳定装配契约。

**接口**：`runtimeConfig`、`preferences`、`document`、`selection`、`transformSession`、`history`、`commandBus`、`editorSession`、`services`、`ports`、`viewModel`、`renderer`、`lifecycle`、`dispose`。

**内部**：
- 使用普通类型化对象保存已组装对象引用，不使用全局 service locator，不在模块顶层创建可变的全局状态。
- 状态对象、服务、端口和具体基础设施都明确列出；生命周期句柄必须在创建后写入，避免循环依赖。
- `runtimeConfig` 与 `preferences` 在渲染器、服务和 UI 创建前注入；`lifecycle` 只消费公开接口，不反查全局变量。
- 所有可释放资源必须可通过该对象或其子句柄释放。

**依赖**：各层公开接口。

