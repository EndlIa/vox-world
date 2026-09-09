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
- `history`：undo/redo 可用性。
- `progress`：当前任务、已完成/总量、可取消性。
- `notifications`：当前可见通知或通知事件序列。
- `palette`：唯一颜色、隐藏颜色、列数和当前颜色。
- `camera`：透视/正交、FOV、F-Stop、焦距、自动旋转和 framing 状态。
- `animation`：关键帧摘要、时长、播放/暂停、当前时间、Follow Camera、路径可见性、Camera Control 状态。
- `export`：格式、选中/全部、纹理选项、可用格式和当前任务状态。
- `fileActions`：可由 UI 触发的打开/保存/导出 descriptor。

## 快照规则

- 快照必须深冻结或至少保证调用方无法修改其中的应用对象；嵌套对象按需复制。
- 相同版本重复 `sync` 必须无副作用；每个字段带单调递增的 `version` 或整体版本号。
- 不把 DOM 节点、Three.js 对象、Map/Set 的可变引用或命令处理器暴露给 UI。
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

## 依赖方向

`editor-view-model.ts` 可以依赖 application 的公开事件和只读类型，不能被 application 依赖。UI 控制器不得绕过它读取状态对象。
