# vox-world 架构契约

`vox-world` 是 `shithill` 向严格 TypeScript + Three.js 重构后的新项目。本目录记录目标架构和各模块的工程契约，是理解、实现和维护该项目的入口。

开发代理的工作流程和非协商规则见仓库根目录的 `AGENTS.md`。本文件负责说明整体架构、契约关系和跨层边界；单个模块的详细职责与接口由对应契约负责。

## 文档定位

- `codemap/README.md` 是整体架构和依赖规则的入口。
- `codemap/src/**/*.md` 对应同路径的目标实现 `src/**/*.ts`，描述职责、公开接口、内部边界、依赖和不变量。
- `src/` 中已经落地的实现以实际代码和测试为准；尚未落地的契约描述目标状态，不表示对应 TypeScript 文件已经存在。
- `IMPORTANT` 记录全局例外和暂缓事项。
- 契约与实现不一致时，以契约为准，并在改动中显式解决冲突，不要静默削弱或绕过契约。
- 为新的实现文件添加代码前，应先添加或更新对应的 `codemap` 契约。

`shithill` 仅作为产品行为和功能语义的参考。不要复制旧项目的架构、运行时约束或实现方式，也不要使用 `shithill/spec/guides/` 指导这个从零开始的 TypeScript 项目。

## 目录骨架

```text
src/
  app/             composition root、依赖装配、生命周期
  application/     命令、处理器、工具、服务、端口和用例编排
  domain/          纯数据、领域规则、补丁和查询契约
  state/           可变的运行时状态及其所有者
  infrastructure/  Three.js、输入、持久化、Worker、平台和导入导出
  ui/              只读 view model、用户动作和 DOM 绑定
  util/            无业务语义的基础工具
```

## 分层职责

- `app`：唯一允许了解所有具体实现的 composition root，负责创建会话、装配依赖、管理启动与释放顺序，并处理生命周期。
- `application`：解释用户意图并编排用例，定义命令、处理器、工具、服务和抽象端口，不包含具体基础设施实现。
- `domain`：稳定的纯数据和纯规则，不依赖运行时状态、Three.js、DOM 或平台 API。
- `state`：运行时可变状态及其所有权，不包含编辑用例、渲染或持久化逻辑。
- `infrastructure`：Three.js、输入、持久化、Worker、平台、导入导出等具体实现，负责实现 application 定义的端口。
- `ui`：消费只读 view model 并产生用户动作，不直接访问 Three.js、可变状态对象或领域内部结构。
- `util`：不承载业务语义的通用基础工具。

## 依赖方向

```text
app ───────────────→ infrastructure / application / state / ui
ui ────────────────→ application
infrastructure ───→ application ports / domain / state / util
application ───────→ state / domain / util / ports
state ─────────────→ domain / util
domain ────────────→ domain / util
util ──────────────→ util
```

依赖必须单向流动。需要跨越边界时，通过命令、补丁、端口和只读快照传递数据，不通过共享可变引用或反向依赖绕过分层。

## 关键边界

- Three.js 只允许出现在 `src/infrastructure/rendering` 和 `src/infrastructure/picking`。
- 领域数据、运行时状态、渲染状态和 UI 状态必须各自拥有明确的所有者。
- 不引入全局可变单例或 service locator。
- 端口定义归属于 application，具体实现归属于 infrastructure。
- 可预期、可恢复的失败使用 `Result`；编程错误、内部不变量破坏和理论上不可能的状态使用 `throw Error`。
- Worker、持久化、IPC、项目文件和其他序列化边界只能传递普通可序列化数据，不得传递函数、类实例、DOM/Three.js 对象或原生 `Error`。
- 跨边界错误使用普通数据表示，通常为 `{ code, message, details? }`。
- 不削弱 `tsconfig.json` 中的严格 TypeScript 设置，不通过无约束的 `any` 或强制类型断言绕过类型检查。
- `Result` 的具体契约见 `codemap/src/util/result.md`；全局例外见 `IMPORTANT`。

## 契约维护

实现、测试和对应契约必须在同一次改动中保持同步。出现以下变化时，应更新相关契约：

- 公开接口、数据形状、命令、补丁或端口发生变化。
- 文件位置、层归属或依赖方向发生变化。
- Worker、持久化、IPC、项目文件或导入导出格式发生变化。
- 新增非显然的实现约束、验证命令或反复出现的故障模式。
- 架构决策、全局例外或暂缓事项发生变化。

契约应描述当前目标状态，而不是记录任务过程。示例和路径必须与实际仓库一致；新增、重命名或删除契约文件时，同步更新所有引用。

## 验证

完成实现前至少运行：

```bash
npm run typecheck
npm test
npm run check
git diff --check
```

开发过程中使用针对性的测试，完成前运行受影响范围的完整验证。无法执行的检查必须报告具体命令和限制，不能声称验证通过。
