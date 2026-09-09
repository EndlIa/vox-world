# editor-view-model.ts

**职责**：把应用事件和状态投影为 UI 可安全消费的只读、稳定快照。
**接口**：snapshot(): EditorViewState；subscribe(listener): Unsubscribe；select(selector)；getVersion()。
**内部**：订阅 editor-session 的公开事件，按字段做浅层不可变更新；UI 只读取快照，不反向持有可变领域对象。
**依赖**：application/editor-session、application events、domain 只读类型。

## 快照边界

`EditorViewState` 至少覆盖：

- `editorMode`：object、edit；Object 模式显示对象选择和对象变换，Edit 模式显示活动对象和体素编辑工具。
- `workspaceMode`：model、render、export；与 `editorMode` 正交，只控制工作区面板可见性。
- `scene`：节点摘要、对象摘要、根节点、对象数量和当前可见对象数量。
- `objectSelection`：当前选中的 `VoxObjectId` 和对象摘要。
- `activeObject`：Edit 模式下活动对象的只读摘要；Object 模式为 `null`。
- `voxelSelection`：活动对象的局部选择数量、锚点和版本；不得把完整键集合复制到 UI。
- `activeTool`、`toolSettings`、`toolAvailability`。
- `voxelSelection`、`objectTransformSession`、`voxelTransformSession` 的只读摘要和版本号。
- `project`：名称、dirty 状态、最近保存时间。
- `history`：场景 `ScenePatch` 的 undo/redo 可用性；动画轨道/关键帧编辑不进入 V1 场景 History，不能通过该状态暗示动画可撤销。
- `progress`：当前任务、已完成/总量、可取消性。
- `notifications`：当前可见通知或通知事件序列。
- `palette`：唯一颜色、隐藏颜色、列数和当前颜色。
- `camera`：透视/正交、FOV、F-Stop、焦距、自动旋转和 framing 状态。
- `animation`：时长、循环、播放状态、当前时间、是否存在 Node/Camera 运行时 override、选中 `trackId`/`keyframeId`、track 摘要和离线渲染状态。每条 track 摘要至少包含稳定 `trackId`、`target`、`channel`、关键帧数量及排序后的时间摘要；`target` 为 `{ kind: 'node', nodeId }` 或 `{ kind: 'camera' }`，channel 按目标限制为 node `position | rotation | scale`、camera `position | rotation | fov`。
- `animation.cameraControls`：仅 camera target 可用的 Follow Camera、Camera Path、Camera Control 和 Camera/View 同步状态；SceneNode target 不得依赖这些相机专用字段。
- `export`：格式、选中/全部、纹理选项、可用格式和当前任务状态。
- `fileActions`：可由 UI 触发的打开/保存/导出 descriptor。

## 快照规则

- 快照必须深冻结或至少保证调用方无法修改其中的应用对象；嵌套对象按需复制。
- 相同版本重复 `sync` 必须无副作用；每个字段带单调递增的 `version` 或整体版本号。
- 不把 DOM 节点、Three.js 对象、Map/Set 的可变引用或命令处理器暴露给 UI。
- 动画快照只暴露稳定身份和只读摘要；SceneNode track 的 `nodeId` 可以关联场景摘要中的名称，但 UI 不得持有节点实例或直接把运行时 override 当作作者态变换。
- 大量数据如体素列表不进入 UI 快照；面板只接收计数、颜色集合摘要或分页数据。
- UI 局部状态不属于该 view model，包括面板位置、焦点、拖拽、hover 展开状态和颜色选择器的临时颜色。

## 事件与订阅

- 应用事件先转换为稳定快照，再通知 UI；通知不得依赖调用栈中的临时状态。
- 订阅回调只收到只读快照或字段级变更描述，不得获得 editor-session 实例。
- 单个订阅者抛错不能阻断其他订阅者；错误应上报给 UI 错误边界。
- `subscribe` 返回幂等 unsubscribe；卸载后不得再收到通知。

## 通知投影

应用错误/警告/成功事件投影为 `NotificationEvent`，至少包含：

```ts
type NotificationEvent = {
  id: string;
  level: 'info' | 'warning' | 'error';
  message: string;
  timeoutMs?: number;
  replaceKey?: string;
};
```

通知显示、替换和计时由 `ui/controls.ts` 拥有；view model 只描述事件，不直接操作 DOM。

节点删除或场景 undo/redo 因动画引用被拒绝时，应用层发出 `node-referenced-by-animation` 错误通知，并在 payload/消息中列出相关 `trackId`；view model 不自动删除轨道，也不把错误降级成静默失败。

## 依赖方向

`editor-view-model.ts` 可以依赖 application 的公开事件和只读类型，不能被 application 依赖。UI 控制器不得绕过它读取状态对象。
