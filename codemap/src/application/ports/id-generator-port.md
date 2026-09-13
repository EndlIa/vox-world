# id-generator-port.ts

**职责**：定义应用层对新身份的抽象，作为节点、对象、动画轨道和关键帧身份的唯一来源。它只回答“下一个身份是什么”，不参与结构、不做去重、不接触渲染。

**接口**：
- `newSceneNodeId(): SceneNodeId`。
- `newSceneObjectId(): SceneObjectId`。
- `newAnimationTrackId(): string`。
- `newAnimationKeyframeId(): string`。

**内部**：
- 端口只暴露这四个方法，不做参数化（前缀、类型、批量）扩展，也不返回 `Result`。
- 场景身份必须由实现经 `domain/scene/scene-types` 的 `sceneNodeId`/`sceneObjectId` 铸造取得 brand；实现不得就地断言，也不得声明同形身份类型。
- 动画轨道/关键帧身份在 `domain/animation` 是普通非空字符串（`AnimationKeyframe.id: string`，轨道 `id` 同样是非空唯一字符串），因此这两个方法直接返回 `string`；不得为它们引入 brand、同形别名或第二套 id 类型。
- 每次调用必须返回此前未返回过的值（同一实现实例的生命周期内）；身份不得从名称、数组索引、坐标或时间戳推导，也不得复用调用方传入的数据或已删除记录的身份。
- 端口不保证跨项目或跨进程唯一，也不负责去重：场景内唯一性由 `scene-types.sceneSnapshot` 的 `duplicate-node-id`/`duplicate-object-id` 判定，文档内唯一性由 `domain/animation` 的轨道/关键帧 ID 规则判定。
- 无状态、无副作用，不接触 DOM/Three.js/存储/命令上下文，也不得成为全局单例；由 composition root 创建并注入。
- 消费方是 application 层中需要新身份的用例（`create-scene-object`、生成器的新对象、新项目根节点）和 `AnimationSessionPort` 的实现（`createTrack`、`addKeyframe`、`addCameraKeyframeFromControl` 的隐式建轨）。domain 与 state 不得依赖本端口，渲染与拾取不得消费它。

**依赖**：domain/scene/scene-types。
