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

## 核心领域模型

项目采用“单场景、多体素对象”的数据模型。一个 `Project` 只包含一个 `SceneSnapshot`；场景中的对象身份、层级和变换与对象内部的体素数据分离：

```text
Project
  ├── SceneSnapshot
  │     ├── SceneNode（层级与变换）
  │     └── VoxObject（局部体素网格）
  ├── Camera / Render settings
  └── CameraAnimation

SceneNode
  ├── id / parentId / childIds
  ├── transform（局部 -> 父空间）
  ├── visible（子树渲染开关）
  └── objectId?（至多绑定一个 VoxObject）

VoxObject
  ├── id
  └── VoxelSnapshot（只使用该对象的局部 VoxelKey）
```

跨对象引用体素时必须使用 `ObjectVoxelRef = { objectId, key }`。`VoxelKey` 不再是整个场景的全局唯一键，只保证在单个 `VoxObject` 的局部网格内唯一。

每个 `VoxObject` 必须由恰好一个 `SceneNode` 绑定；不允许孤儿对象或重复绑定。绑定对象的节点第一版必须是叶节点，组节点只用于层级组织。场景 Patch 必须原子地保持这些不变量。

### 编辑器模式

- **Object 模式**：选择和变换 `VoxObject`；变换由对象绑定的 `SceneNode` 承担。对象模式不直接编辑体素。
- **Edit 模式**：必须恰好有一个 `activeObjectId`。体素查询、选择、绘制、XFORM 和模型算法只能作用于该活动对象。
- Edit 模式下其他对象可以按 `SceneNode.visible` 渲染，但不得进入体素拾取、选择、XFORM 或命令候选；渲染可见性与可编辑性是两个独立概念。
- 进入 Edit 模式、退出 Edit 模式、切换活动对象和删除活动对象时，必须显式清理或取消不适用的体素 Selection/XFORM 状态。

`ObjectSelection` 是对象选择的唯一可变所有者；`EditorState` 只保存模式和活动对象，不复制 `selectedObjectId`。进入 Edit 模式时由 Scene Command Handler 原子同步两者，退出 Edit 后保留对象选择。

### 坐标与可见性

- `VoxObject` 的局部整数坐标由 `VoxelKey` 表示；对象的局部到世界变换由它绑定的 `SceneNode` 及其祖先组合得到。
- `SceneNode.visible` 控制渲染子树；`VoxelValue.visible` 控制对象内部单个体素的渲染。有效可见性为两者及祖先可见性的逻辑与。
- “其他对象不可编辑”由 EditorState、PickService 和命令校验共同保证，不能通过把对象设为不可见来伪装。
- 对象级 Patch 与对象内体素 Patch 必须在同一场景版本下原子提交；Undo/Redo 保存场景感知的正反向补丁。
- `SceneDocument.version` 是场景命令的并发令牌；`ProjectService.projectVersion` 是项目聚合的持久化修订号，还覆盖动画、项目设置和 Bake Mesh。两者不得混用。

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
- 持久化格式从当前 `V1` 开始定义，只支持当前版本并拒绝其他版本；不设计迁移链、旧字段别名或宽松兼容解析。
- 不削弱 `tsconfig.json` 中的严格 TypeScript 设置，不通过无约束的 `any` 或强制类型断言绕过类型检查。
- `Result` 的具体契约见 `codemap/src/util/result.md`；全局例外见 `IMPORTANT`。

## 类型所有权

公共类型必须有唯一 owner；其他模块只能 `import type` 或显式 re-export，不得声明同形副本。当前已落地的稳定契约如下：

| 类型 | 唯一 owner | 边界 |
| --- | --- | --- |
| `Result` | `util/result` | 所有层的可恢复失败容器 |
| `ColorHex`、`Rgb`、`LinearRgb`、`ColorParseError`、`ColorChannelError`、`ColorScalarError`、`ColorError` | `util/color` | 无 alpha 的领域颜色及错误 |
| `VoxelKey`、`PackedIntError` | `util/packed-int` | 16-bit 体素坐标打包键及错误 |
| `Vec3`、`Mat4`、`Quat`、`Plane`、`Aabb`、`Ray` | `util/math` | 与渲染器无关的纯数学值 |
| `SceneNodeId`、`VoxObjectId`、`SceneTransform`、`SceneNodeSnapshot`、`VoxObjectSnapshot`、`SceneSnapshot`、`ObjectVoxelRef` | `domain/scene/scene-types` | 场景图、对象身份和对象局部体素引用 |
| `ScenePatch`、`ScenePatchOp` | `domain/scene/scene-patch` | 场景级可逆补丁 |

类型收敛规则：

- 只有出现在跨模块公共签名或稳定边界契约中的类型才导出；模块内部辅助类型保持私有。
- `Rgb` 与 `LinearRgb` 虽同形，但分别表示 sRGB 8-bit 和线性 sRGB，禁止合并。
- `Vec3` 与领域 `GridPosition`、`Aabb` 与领域 `Bounds3i` 语义不同，禁止互相别名或合并。
- `VoxelKey`、`ColorHex` 只能由 `util/packed-int`、`util/color` 定义；domain 只能 re-export，`VoxelColor` 只能作为 `ColorHex` 的领域别名。
- `SceneSnapshot` 是场景根快照；`VoxelSnapshot` 只表示单个 `VoxObject` 的局部数据。任何跨对象操作都不得退化为全局 `VoxelKey` 查找。
- 跨模块的公开数据使用只读普通对象/数组；本项目的 `readonly` 是编译期约束，不依赖 `Object.freeze`，但不得把所有权状态对象或其底层 `Map`/`Set` 暴露给其他模块。
- 序列化边界必须在输入侧接收 `unknown` 并做运行时校验；TypeScript brand 不提供运行时保证。

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
