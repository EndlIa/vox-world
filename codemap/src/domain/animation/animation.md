# animation.ts

**职责**：定义可序列化的统一动画文档、SceneNode/Camera 轨道、关键帧数据契约、时间轴规则和确定性求值；只包含纯数据与纯函数，不持有播放状态、DOM、Three.js、运行时 override 或平台对象。

**接口**：
- `createDefaultAnimation()`、`normalizeAnimation(value)`、`validateAnimation(document, scene)`、`AnimationError`。
- `setDuration(document, durationMs)`、`setLoop(document, loop)`。
- `createTrack(document, trackId, target, channel, keyframe)`、`insertKeyframe(document, trackId, keyframe)`、`replaceKeyframe`、`removeKeyframe(document, trackId, keyframeId)`、`moveKeyframe`、`removeTrack(document, trackId)`。
- `evaluateAnimation(document, timeMs): AnimationEvaluation`。
- `serializeAnimation(document): AnimationDocumentV1`、`restoreAnimation(value): Result<AnimationDocumentV1, AnimationError>`。

**统一格式与默认值**：
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

```text
AnimationDocumentV1 {
  version: 1;
  durationMs: number;
  loop: boolean;
  tracks: AnimationTrackV1[];
}

AnimationTrackV1 =
  | NodePositionTrack
  | NodeRotationTrack
  | NodeScaleTrack
  | CameraPositionTrack
  | CameraRotationTrack
  | CameraFovTrack

NodeTransformTarget { kind: "node"; nodeId: SceneNodeId }
CameraTarget       { kind: "camera" }

Node channel       := "position" | "rotation" | "scale"
Camera channel     := "position" | "rotation" | "fov"

AnimationKeyframe<T> {
  id: string;
  timeMs: number;
  value: T;
  easing: "linear" | "smooth";
}

AnimationCameraPose {
  position: Vec3;
  rotation: Quat;
  fov: number; // radians
}

AnimationEvaluation {
  timeMs: number;
  nodes: Array<{
    nodeId: SceneNodeId;
    transform: Partial<SceneTransform>;
  }>;
  camera?: Partial<AnimationCameraPose>;
}
```

- `AnimationCameraPose` 是 `domain/animation` 自有的最小相机求值结构；渲染层只按 `position`、`rotation`、`fov` 三个普通字段消费，不得引入 Three.js 相机或第二套相机姿态 DTO。`fov` 的单位始终为弧度（默认 `0.8`），与 `camera-control`/`domain/render` 一致；Three.js 的角度制转换只能发生在渲染边界，不得写入动画文档或求值结果。

- 默认 `durationMs = 5000`、`loop = false`、空 `tracks`。新项目必须显式调用 `createDefaultAnimation()`，不能依赖加载器补字段。空 `tracks` 是合法、可持久化的项目状态，求值返回空 `AnimationEvaluation`；播放与离线渲染必须拒绝启动空文档，具体门禁由 `animation-controller`/`animation-renderer` 执行。
- 项目格式边界是顶层必填字段 `animation: AnimationDocumentV1`；`serializeAnimation` 只生成该值，`restoreAnimation` 只接受完整且自洽的 V1 文档，节点引用合法性另由 `validateAnimation(document, scene)` 校验。
- `cameraAnimation` 不是当前格式字段；项目 codec、Snapshot 和归档遇到它必须拒绝，不得迁移或兼容。

**轨道规则**：
- 轨道 ID 在整个文档内非空且唯一；关键帧 ID 在所属轨道内非空且唯一。
- Node 轨道只能绑定已存在、非根节点的 `SceneNodeId`。根节点变换固定为单位变换，不允许动画。
- Camera 轨道是单例目标，只允许 `position`、`rotation`、`fov` 三个 channel。
- 同一 `target + channel` 只能有一条轨道；重复轨道使整个文档校验失败。
- 每条轨道至少包含一个关键帧。空轨道应直接删除，不持久化。
- 关键帧必须按 `timeMs` 严格升序；时间重复是格式错误。编辑时插入已占用时间应显式替换该关键帧并保留原 ID。
- `timeMs`、`durationMs`、Vec3、四元数和 FOV 必须是有限数；`durationMs > 0`，`timeMs` 位于 `0..durationMs`，FOV 必须是以弧度为单位的正有限数。
- Node rotation 必须是单位四元数；Node scale 三分量不得为零。非法值使整个项目校验失败，不静默丢弃关键帧。
- 节点身份只使用稳定 `SceneNodeId`，不得使用名称、数组索引或世界矩阵。节点重命名或重新排序不影响轨道。
- Node 轨道始终表示相对父节点的局部 `SceneTransform`。重新挂载父节点后轨道仍保持局部语义；父子轨道可同时存在，最终世界变换由层级组合决定。
- 第一版不支持世界空间轨道、节点可见性轨道、约束/IK、体素动画或节点层级拓扑动画。

**编辑操作**：
- `createTrack` 必须同时提供首个关键帧，避免产生不可持久化的空轨道；`insertKeyframe` 只接受已存在的 trackId。
- `setDuration` 不得短于任一轨道最后关键帧的 `timeMs`；缩短时拒绝或要求调用方先移动/删除越界关键帧。
- 移动关键帧到已占用时间必须拒绝；删除最后一个关键帧等同于删除该轨道。
- 所有编辑操作返回新文档或明确的新对象，不修改调用方输入。

**求值规则**：
- `evaluateAnimation` 是唯一插值入口，运行时播放、截图和离线渲染必须共用它。
- `loop = true` 时先把时间规范到 `0..durationMs`；否则 clamp 到首尾。
- 每个相邻关键帧区间只由左端关键帧的 `easing` 控制，右端关键帧的 `easing` 只影响下一段，末关键帧的 `easing` 不参与任何插值。段内参数 `t = (timeMs - left.timeMs) / (right.timeMs - left.timeMs)`；`left.easing = "linear"` 时直接使用 `t`，`left.easing = "smooth"` 时必须使用仓库 `util/math.smoothstep(t) = clamp(t, 0, 1)^2 * (3 - 2 * clamp(t, 0, 1))`，不得另写缓动公式。
- Vec3 position/scale 使用逐分量 `linear` 或 `smooth` 插值；rotation 使用四元数 slerp，并对 slerp 参数应用同一个 easing 后结果；FOV 使用标量插值。预览与离线渲染必须得到相同结果。
- 只有一个关键帧或时间位于首尾之外时返回该关键帧值的深拷贝。
- 输出按 `nodeId` 和 track ID 稳定排序；同一节点不同 channel 合并为一个 `Partial<SceneTransform>`，缺失 channel 不出现。
- `AnimationEvaluation` 只表达动画覆盖值，不包含 SceneDocument 基础变换，也不得修改 `SceneSnapshot`。
- 求值、播放、暂停、seek 和 override 应用都只属于运行时；不得修改 `SceneDocument`、推进 `SceneDocument.version` 或使项目 dirty。停止播放必须清除全部 override 并恢复 authored/base 状态。
- 相同文档与时间必须得到确定结果，供预览和离线逐帧渲染复用。

**内部与依赖**：
- 文档、轨道、关键帧、求值结果均为普通可序列化数据；不得出现 Three.js、DOM、函数、Map/Set 可变引用或平台对象。
- `serializeAnimation` 输出规范字段并稳定排序轨道/关键帧；`restoreAnimation` 只校验文档自身的版本、字段、唯一性和关键帧规则，无法判断 `nodeId` 是否存在。项目加载与 Snapshot 恢复必须再调用 `validateAnimation(document, scene)`，其中 `scene` 必须与同一文档来自同一条目。
- `validateAnimation` 接收场景快照并校验所有 Node 目标存在且非根；节点删除或场景 undo/redo 的引用预检不能复用“校验当前场景”这一入口，必须由应用层通过只读 `hasTracksForNode(nodeId)` 查询。命中时返回 `node-referenced-by-animation` 和全部相关 `trackId`，不得自动级联删除轨道。
- 播放时钟、`currentTimeMs`、`status`、相机 Follow/Observe、节点 override 应用和编辑器状态恢复不属于本模块，由 `animation-controller` 持有。

**依赖**：scene-types、util/math、util/result。
