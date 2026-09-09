# animation.ts

**职责**：定义可序列化的相机动画 clip、关键帧数据契约、时间轴规则和确定性插值；只包含纯数据与纯函数，不持有播放状态、DOM、Three.js 或平台对象。

**接口**：
- `createDefaultCameraAnimation()`、`normalizeCameraAnimation(value)`、`validateCameraAnimation(value)`、`CameraAnimationError`。
- `setDuration(clip, durationMs)`、`insertKeyframe(clip, timeMs, state, easing)`、`replaceKeyframe`、`removeKeyframe(clip, id)`、`moveKeyframe(clip, id, timeMs)`。
- `evaluateCameraAnimation(clip, timeMs): CameraKeyframeState | null`、`samplePosition`、`sampleRotation`、`sampleFov`。
- `serializeCameraAnimation(clip): CameraAnimationDocument`、`restoreCameraAnimation(value): Result<CameraAnimationClip, CameraAnimationError>`。

**项目格式与默认值**：
```json
{
  "cameraAnimation": {
    "version": 1,
    "durationMs": 5000,
    "loop": false,
    "keyframes": [
      {
        "id": "camera-keyframe-1",
        "timeMs": 0,
        "position": { "x": 0, "y": 0, "z": 0 },
        "rotation": { "x": 0, "y": 0, "z": 0, "w": 1 },
        "fov": 0.8,
        "easing": "linear"
      }
    ]
  }
}
```
- 默认 `durationMs = 5000`、`loop = false`、空 `keyframes`。新项目必须显式调用 `createDefaultCameraAnimation()`，不能依赖加载器为缺字段补默认值。
- 项目格式边界是顶层必填字段 `cameraAnimation: CameraAnimationV1`；`serializeCameraAnimation` 只生成该值，`restoreCameraAnimation` 只接受完整、合法的 V1。project codec 负责顶层字段的读写和版本校验，不得把 clip 展开到 `camera`、`render` 或 keyframe 数组等其他位置。
- 缺失、`null`、非对象、未知版本、缺字段或非法关键帧都返回错误并使整个项目校验失败；不推断相机姿态，不静默丢弃关键帧。恢复动作本身不启动播放，运行时 `currentTimeMs = 0`、`status = stopped`，且这些播放字段不进入项目 JSON。
- keyframe state 只允许 position、单位四元数 rotation、弧度 FOV 和 easing。禁止持久化 ArcRotate/OrbitControls 的 target、alpha、beta、radius 或 Three.js 对象。
- `version` 当前为 `1`；其他版本返回 `UNSUPPORTED_CAMERA_ANIMATION_VERSION`。当前格式要求所有字段存在且合法，非有限数值或非法 FOV 使整个 clip 失败。
- `timeMs` 必须是有限数；写入时四舍五入并 clamp 到 `0..durationMs`。同一时间插入新 keyframe 时替换状态但保留原 `id`；移动到已占用的时间必须拒绝，不得静默覆盖。
- `durationMs` 不得小于最后一个 keyframe 的 `timeMs`。缩短时长时必须显式拒绝或先移动/删除越界关键帧，不能把多个关键帧折叠后丢失。
- `easing` 只允许 `linear` 或 `smooth`；`smooth` 对段内比例执行 `smoothstep`。位置和 FOV 线性插值，rotation 使用四元数 slerp，并在插值前后处理最短弧和归一化。
- 零关键帧返回 `null`；只有一个关键帧或时间在首尾之外时返回首/尾 keyframe 的深拷贝。相同 clip 和相同 `timeMs` 必须得到确定结果，供播放和离线逐帧渲染共用。

**内部**：
- clip、keyframe 和 state 均使用普通 JSON 值；所有编辑操作返回新 clip 或明确的新对象，不修改调用方持有的输入，便于历史、UI 快照和离线渲染快照隔离。
- `serializeCameraAnimation` 只输出上述字段，并确保 rotation 归一化、time 排序和 duration 合法；`restoreCameraAnimation` 先严格校验再 normalize，字符串 ID 必须非空且唯一，不自动修补缺失或重复 ID。
- 播放时钟、`currentTimeMs`、`status`、Follow/Observe 和编辑器状态恢复不属于本模块，由 `camera-animation-controller` 持有。

**依赖**：util/math。
