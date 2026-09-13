# animation.ts

**职责**：定义可序列化的统一动画文档、SceneNode/Camera 轨道、关键帧数据契约、时间轴规则和确定性求值；只包含纯数据与纯函数，不持有播放状态、DOM、Three.js、运行时 override 或平台对象。

**接口**：
- 类型：`AnimationDocument`、`AnimationTrack`、`AnimationKeyframe`、`AnimationTarget`、`AnimationChannelName`、`AnimationEvaluation`、`AnimationCameraPose`、`AnimationError`。
- 构造与校验：`createDefaultAnimation(): AnimationDocument`、`decodeAnimation(value): Result<AnimationDocument, AnimationError>`、`validateAnimation(document, scene): Result<void, AnimationError>`、`hasTracksForNode(document, nodeId): readonly string[]`。
- 编辑：`setDuration(document, durationMs): Result<AnimationDocument, AnimationError>`、`setLoop(document, enabled): AnimationDocument`。
- 轨道与关键帧编辑：`createTrack(document, trackId, target, channel, keyframe): Result<AnimationDocument, AnimationError>`、`addKeyframe(document, trackId, keyframe): Result<AnimationDocument, AnimationError>`、`replaceKeyframe(document, trackId, keyframe): Result<AnimationDocument, AnimationError>`、`removeKeyframe(document, trackId, keyframeId): Result<AnimationDocument, AnimationError>`、`moveKeyframe(document, trackId, keyframeId, timeMs): Result<AnimationDocument, AnimationError>`、`deleteTrack(document, trackId): Result<AnimationDocument, AnimationError>`。
- 求值：`evaluateAnimation(document, timeMs): AnimationEvaluation`。
- 持久化边界：`encodeAnimation(document): AnimationDocument`。

**类型形状**：

```json
{
  "animation": {
    "version": 1,
    "durationMs": 5000,
    "loop": false,
    "tracks": [
      {
        "id": "node-track-position-1",
        "target": { "kind": "node", "nodeId": "node-1" },
        "channel": "position",
        "keyframes": [
          {
            "id": "keyframe-1",
            "timeMs": 0,
            "value": { "x": 0, "y": 0, "z": 0 },
            "easing": "linear"
          }
        ]
      },
      {
        "id": "camera-track-fov-1",
        "target": { "kind": "camera" },
        "channel": "fov",
        "keyframes": [
          { "id": "keyframe-2", "timeMs": 0, "value": 0.8, "easing": "linear" }
        ]
      }
    ]
  }
}
```

```ts
type NodeTransformTarget = Readonly<{ kind: "node"; nodeId: SceneNodeId }>;
type CameraTarget = Readonly<{ kind: "camera" }>;

export type AnimationTarget = NodeTransformTarget | CameraTarget;

export type AnimationChannelName = "position" | "rotation" | "scale" | "fov";

export type AnimationKeyframe<T> = Readonly<{
  id: string;
  timeMs: number;
  value: T;
  easing: "linear" | "smooth";
}>;

// 模块内部辅助，不导出
type AnimationTrackOf<TTarget, TChannel, TValue> = Readonly<{
  id: string;
  target: TTarget;
  channel: TChannel;
  keyframes: readonly AnimationKeyframe<TValue>[];
}>;

export type NodePositionTrack = AnimationTrackOf<NodeTransformTarget, "position", Vec3>;
export type NodeRotationTrack = AnimationTrackOf<NodeTransformTarget, "rotation", Quat>;
export type NodeScaleTrack = AnimationTrackOf<NodeTransformTarget, "scale", Vec3>;
export type CameraPositionTrack = AnimationTrackOf<CameraTarget, "position", Vec3>;
export type CameraRotationTrack = AnimationTrackOf<CameraTarget, "rotation", Quat>;
export type CameraFovTrack = AnimationTrackOf<CameraTarget, "fov", number>;

export type AnimationTrack =
  | NodePositionTrack
  | NodeRotationTrack
  | NodeScaleTrack
  | CameraPositionTrack
  | CameraRotationTrack
  | CameraFovTrack;

export type AnimationCameraPose = Readonly<{
  position: Vec3;
  rotation: Quat;
  fov: number; // radians
}>;

export type AnimationEvaluation = Readonly<{
  timeMs: number;
  nodes: readonly Readonly<{
    nodeId: SceneNodeId;
    transform: Partial<SceneTransform>;
  }>[];
  camera?: Partial<AnimationCameraPose>;
}>;

export type AnimationDocument = Readonly<{
  version: 1;
  durationMs: number;
  loop: boolean;
  tracks: readonly AnimationTrack[];
}>;

export type AnimationError =
  | Readonly<{ code: "unsupported-animation-version"; version: number }>
  | Readonly<{ code: "invalid-animation-field"; field: string }>
  | Readonly<{ code: "duplicate-track-id"; trackId: string }>
  | Readonly<{ code: "invalid-track-target"; trackId: string }>
  | Readonly<{ code: "invalid-track-channel"; trackId: string; channel: string }>
  | Readonly<{
      code: "duplicate-track-target";
      trackId: string;
      target: AnimationTarget;
      channel: AnimationChannelName;
    }>
  | Readonly<{ code: "empty-track"; trackId: string }>
  | Readonly<{ code: "duplicate-keyframe-id"; trackId: string; keyframeId: string }>
  | Readonly<{ code: "invalid-keyframe-time"; trackId: string; keyframeId: string }>
  | Readonly<{ code: "invalid-keyframe-easing"; trackId: string; keyframeId: string }>
  | Readonly<{ code: "invalid-keyframe-value"; trackId: string; keyframeId: string }>
  | Readonly<{ code: "track-not-found"; trackId: string }>
  | Readonly<{ code: "keyframe-not-found"; trackId: string; keyframeId: string }>
  | Readonly<{ code: "keyframe-time-occupied"; trackId: string; timeMs: number }>
  | Readonly<{ code: "duration-too-short"; durationMs: number; lastKeyframeMs: number }>
  | Readonly<{ code: "node-target-not-found"; trackId: string; nodeId: string }>
  | Readonly<{ code: "node-target-is-root"; trackId: string; nodeId: string }>
  | Readonly<{
      code: "node-referenced-by-animation";
      nodeId: string;
      trackIds: readonly string[];
    }>
  | Readonly<{ code: "animation-playback-active" }>;
```

- 所有公开类型都是只读普通数据：对象用 `Readonly<{…}>`、数组用 `readonly T[]`，不使用 class、带方法的包装对象或可变集合；序列化边界只传普通数据。
- `AnimationTrack` 的判别字段是 `target.kind` 与 `channel`，`channel` 与关键帧值类型必须按上面的成员类型一一对应（node `position`/`scale` → `Vec3`、node `rotation` → `Quat`、camera `fov` → `number`）；不存在第七种组合，`value` 类型必须与 `target` + `channel` 匹配。
- `Quat`/`Vec3` 的唯一 owner 是 `util/math`，`SceneNodeId`/`SceneTransform` 的唯一 owner 是 `domain/scene/scene-types`；本模块只 `import type`，不得声明同形副本或就地构造带 brand 的值。
- `AnimationCameraPose` 是 `domain/animation` 自有的最小相机求值结构；渲染层只按 `position`、`rotation`、`fov` 三个普通字段消费，不得引入 Three.js 相机或第二套相机姿态 DTO。`fov` 的单位始终为弧度（默认 `0.8`），与 `camera-control`/`domain/render` 一致；Three.js 的角度制转换只能发生在渲染边界，不得写入动画文档或求值结果。
- `AnimationEvaluation.nodes` 按 `nodeId` 升序稳定排序；同一节点的多个 channel 合并进一个 `Partial<SceneTransform>`，缺失 channel 通过**键不出现**表达，不得写入 `undefined`（`exactOptionalPropertyTypes`）。`transform` 保证至少含一个 channel，`camera` 键出现时也保证至少含一个 channel：`Partial` 只用于表达"缺席的 channel"，不表达空对象。
- `AnimationEvaluation` 只表达本次求值覆盖到的节点与相机通道；`camera` 键缺席表示本次求值没有相机覆盖。

**内部**：

- 默认 `durationMs = 5000`、`loop = false`、空 `tracks`。新项目必须显式调用 `createDefaultAnimation()`，不能依赖加载器补字段。空 `tracks` 是合法、可持久化的项目状态，求值返回空 `AnimationEvaluation`；播放与离线渲染必须拒绝启动空文档，但该门禁由 `animation-controller`/`animation-renderer` 自行执行，不是 `validateAnimation` 的失败判据。
- 项目格式边界是顶层必填字段 `animation: AnimationDocument`；`encodeAnimation` 只生成该值，`decodeAnimation` 只接受完整且自洽的 V1 文档，节点引用合法性另由 `validateAnimation(document, scene)` 校验。
- `cameraAnimation` 不是当前格式字段；项目 codec、Snapshot 和归档遇到它必须拒绝，不得迁移或兼容。
- 文档、轨道、关键帧、求值结果均为普通可序列化数据；不得出现 Three.js、DOM、函数、Map/Set 可变引用或平台对象。
- 播放时钟、`currentTimeMs`、`status`、相机 Follow/Observe、节点 override 应用和编辑器状态恢复不属于本模块，由 `animation-controller` 持有。

**轨道规则**：

- 轨道 ID 在整个文档内非空且唯一；关键帧 ID 在所属轨道内非空且唯一。ID 由 application 层注入的 `IdGeneratorPort` 分配；本模块只校验非空与唯一，不生成 ID。
- Node 轨道只能绑定已存在、非根节点的 `SceneNodeId`。根节点变换固定为单位变换，不允许动画。
- Camera 轨道是单例目标，只允许 `position`、`rotation`、`fov` 三个 channel。
- 同一 `target + channel` 只能有一条轨道；重复轨道使整个文档校验失败。
- 每条轨道至少包含一个关键帧。空轨道应直接删除，不持久化。
- 关键帧必须按 `timeMs` 严格升序；时间重复是格式错误。编辑时把关键帧插入已占用时间必须显式替换该时间点上的旧关键帧：旧关键帧连同其 `keyframeId` 一并移除并作废，替换后文档中保留的是调用方传入的**新** `keyframeId`，本模块不复用旧 ID。
  - 【用户确认】已占用时间的插入采用「替换旧关键帧并分配新 `keyframeId`」，不采用「保留原 ID」。用户于 2026-09-13 在两者间显式裁定；覆盖的可见提示由 application/UI 负责，见下条与 `application/ports/animation-port`。修改本条必须先取得用户同意。
- `timeMs`、`durationMs`、Vec3、四元数和 FOV 必须是有限数；`durationMs > 0`，`timeMs` 位于 `0..durationMs`，FOV 必须是以弧度为单位的正有限数。
- Node rotation 必须是单位四元数（长度按 `util/math` 的 `EPSILON` 判定）；Node scale 三分量不得为零，零判定同样按 `EPSILON`，与 `scene-types` 的 `invalid-transform` 同一口径。非法值使整个项目校验失败，不静默丢弃关键帧。
- 节点身份只使用稳定 `SceneNodeId`，不得使用名称、数组索引或世界矩阵。节点重命名或重新排序不影响轨道。
- Node 轨道始终表示相对父节点的局部 `SceneTransform`。重新挂载父节点后轨道仍保持局部语义；父子轨道可同时存在，最终世界变换由层级组合决定。
- 第一版不支持世界空间轨道、节点可见性轨道、约束/IK、体素动画或节点层级拓扑动画。

**编辑操作**：

- `createTrack` 必须同时提供首个关键帧，避免产生不可持久化的空轨道；`addKeyframe` 只接受已存在的 trackId。
- 每个关键帧由调用方构造为完整 `AnimationKeyframe<T>`（含由 `IdGeneratorPort` 分配的 `id`）；文档中的 `easing` 必填，application 层省略该参数时在调用前补齐为 `"linear"`，本模块不接受缺失 `easing`。
- 编辑入口按 `AnimationKeyframe<Vec3 | Quat | number>` 接收关键帧，通道与值类型的匹配由本模块在运行时校验（`invalid-keyframe-value`）；类型层只能约束到「四种合法值之一」，不得据此省略校验。
- `addKeyframe` 命中已占用时间时按上面的替换规则执行：旧关键帧连同其 `keyframeId` 一并移除，保留调用方传入的新 `keyframeId`；本模块不产生用户提示，覆盖旧关键帧的可见反馈由 application/UI 负责（`application/ports/animation-port` 发出、`ui/editor-view-model` 投影）。
- `replaceKeyframe` 保留原 `keyframeId`，`moveKeyframe` 只改 `timeMs`。两者把关键帧放到已被**其它**关键帧占用的时间必须拒绝（`keyframe-time-occupied`），不得覆盖、不得交换时间，也不得静默丢弃任一关键帧；时间未变或仍指向自身时不属于冲突。
- `setDuration` 不得短于任一轨道最后关键帧的 `timeMs`；缩短越界时拒绝（`duration-too-short`）并保持原文档，不 clamp、不自动移动或删除关键帧，由调用方先移动/删除越界关键帧。
- 删除最后一个关键帧等同于删除该轨道。
- 所有编辑操作返回新文档或明确的新对象，不修改调用方输入；失败必须经 `Result` 报告（`AnimationError`）且不产生部分文档变更。`setLoop` 是总函数，直接返回新文档。

**求值规则**：

- `evaluateAnimation` 是唯一插值入口，运行时播放、截图和离线渲染必须共用它。
- `loop = true` 时先把时间折回 `0..durationMs)`（`durationMs` 折回 `0`，负值也按同一规则折回）；否则 clamp 到 `0..durationMs`。`AnimationEvaluation.timeMs` 报告**规范化或 clamp 之后的有效时间**，即采样值真正对应的时间。
- 每个相邻关键帧区间只由左端关键帧的 `easing` 控制，右端关键帧的 `easing` 只影响下一段，末关键帧的 `easing` 不参与任何插值。段内参数 `t = (timeMs - left.timeMs) / (right.timeMs - left.timeMs)`；`left.easing = "linear"` 时直接使用 `t`，`left.easing = "smooth"` 时必须使用仓库 `util/math.smoothstep(t) = clamp(t, 0, 1)^2 * (3 - 2 * clamp(t, 0, 1))`，不得另写缓动公式。
- Vec3 position/scale 使用逐分量 `linear` 或 `smooth` 插值；rotation 使用 `util/math.quatSlerp`，并对 slerp 参数应用同一个 easing 后结果；FOV 使用标量插值。预览与离线渲染必须得到相同结果。
- 只有一个关键帧或时间位于首尾之外时返回该关键帧值的深拷贝。
- `AnimationEvaluation` 只表达动画覆盖值，不包含 SceneDocument 基础变换，也不得修改 `SceneSnapshot`。
- 求值、播放、暂停、seek 和 override 应用都只属于运行时；不得修改 `SceneDocument`、推进 `SceneDocument.version` 或使项目 dirty。停止播放必须清除全部 override 并恢复 authored/base 状态。
- 相同文档与时间必须得到确定结果，供预览和离线逐帧渲染共用。

**序列化与校验**：

- `encodeAnimation` 输出规范字段并稳定排序轨道/关键帧，是项目保存侧取动画文档的唯一入口；项目 codec 嵌入其返回值，本模块不写文件、不做资产解析。
- `decodeAnimation` 只校验文档自身的版本、字段、唯一性、轨道/关键帧规则与值合法性，未知字段必须拒绝而不是忽略；它无法判断 `nodeId` 是否存在。反序列化边界必须先自行校验有限性与单位性，校验通过后经 `util/math.quatNormalize` 铸造 `Quat` brand；不得依赖 `quatNormalize` 把损坏数据静默修成单位四元数，也不得用类型断言绕过。
- 项目加载与 Snapshot 恢复必须再调用 `validateAnimation(document, scene)`，其中 `scene` 必须是由同一份持久化场景构造出的 `SceneSnapshot`（同一文档来自同一条目）；`validateAnimation` 校验所有 Node 目标存在且非根，返回 `Result<void, AnimationError>`，不返回文档、不做规范化。
- 节点删除或场景 undo/redo 的引用预检不能复用"校验当前场景"这一入口，必须由应用层通过只读 `hasTracksForNode(document, nodeId)` 查询：返回引用该节点的全部 node 轨道 `trackId`，未被引用时返回空数组，不修改文档、不修改播放状态。`node-referenced-by-animation`（携带 `nodeId` 与全部 `trackIds`）由应用层据此构造并返回；本模块不得自动级联删除轨道。
- `AnimationError` 的唯一 owner 是本模块。`validateAnimation`/`decodeAnimation` 与编辑操作产出文档结构、规则与引用类码值；`node-referenced-by-animation` 与 `animation-playback-active` 由 application 层产出（前者来自 `hasTracksForNode` 的查询结果，后者来自 `AnimationSessionPort` 的编辑门禁），但同属本类型，使 `Result<…, AnimationError>` 在各层保持同一个错误词表。
- 全部错误只含普通可序列化数据（码值与定位字段），不得携带 `Error` 实例、`NaN`/`Infinity` 或原始非法值。

**类型级测试**：

- 实现必须提供 `test/domain/animation/animation.test.ts`，用 `expectTypeOf` 钉住类型契约（同 `test/domain/voxel/uniform/types.test.ts`、`test/util/math.test.ts` 的做法）：`AnimationDocument`/`AnimationEvaluation` 的只读形状与可变形状的负断言；`Extract<AnimationTrack, { channel: "fov" }>` 等成员收窄到对应值类型；`channel` 与 `value` 错配不能通过编译；`Partial<SceneTransform>` 拒绝显式 `undefined` 键；裸 `{ x, y, z, w }` 不能赋给 `Quat`；`AnimationError` 的码值可判别。
- 这些断言是类型契约的可执行证据，不得因为实现改动而放宽或删除。

**依赖**：scene-types、util/math、util/result。
