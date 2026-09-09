# actions.ts

**职责**：定义 UI 可以发出的类型化用户意图及其参数校验边界。
**接口**：editor.setMode、object.select、object.create、object.delete、object.rename、object.setVisibility、object.transform、tool.select、command.dispatch、history.undo/redo、selection.delete、project.*、file.*、panel.*、camera.*、animation.*、palette.*、colorPicker.*、confirm.respond、notification.dismiss、debug.toggleInspector。
**内部**：动作是纯数据描述，不包含 DOM、Three.js、持久化或命令执行实现；调用方只把 action 交给 editor-session/UI controller。
**依赖**：application/editor-session、ui/editor-view-model。

## 动作分组

### 工具与编辑

- `editor.setMode(mode)`：在 object/edit 之间切换；Edit 模式必须已有选中对象，切换前由应用层处理未完成的 XFORM，并在进入 Edit 前停止动画播放、清除运行时 override。
- `object.select(objectId)`、`object.create(options)`、`object.delete(objectId)`、`object.rename(nodeId, name)`、`object.setVisibility(objectId, visible)`、`object.transform(...)`：只作用于 Object 模式。
- `object.delete(objectId)` 会删除对象绑定的 `SceneNode`；应用层必须先停止动画并清除 override，再检查动画引用。若该节点仍被任一 track 引用，返回 `node-referenced-by-animation` 并提示先删除相关轨道，UI 不得自行级联删除动画数据。
- `tool.select(toolId, options?: { temporary?: boolean })`：切换工具；不可用工具不得激活。`temporary` 只用于 Space/Alt 等按住式相机模式，应用层负责记录和恢复原工具。
- `command.dispatch(command)`：发送不可变命令数据。
- `history.undo()` / `history.redo()`：只作用于场景 `ScenePatch`；应用前由应用层先停止动画并清除全部 Node/Camera 运行时 override。动画轨道/关键帧编辑不进入 V1 场景 History。若候选补丁会删除仍被动画引用的节点，应用层返回 `node-referenced-by-animation` 且不移动 History 游标。
- `transform.apply()` / `transform.cancel()` / `transform.deleteSelection()`。
- `selection.delete()`：Edit 模式删除活动对象的体素选择；Object 模式删除选中对象并遵循 `object.delete` 的停播与动画引用检查。由应用层按 EditorState 解析，UI/输入层不自行判断选择类型。
- `symmetry.nextAxis()`：按稳定顺序切换对称轴。

### 面板与布局

- `panel.toggle(key)`、`panel.open(key)`、`panel.close(key)`、`panel.minimize(key)`、`panel.restore(key)`。
- `panel.setMode(mode)`：切换 model/render/export 可见性集合；不直接修改 DOM class。
- `panel.reset(key)`：执行 Reset/Exit；重置当前面板并关闭同组的普通浮动面板。
- `panel.resetAll()`：窗口尺寸变化或用户显式重置时使用。
- `panel.bringToFront(key)`：只改变 UI z-order。

### 项目、文件与存储

- `project.new()`、`project.rename(name)`、`project.save()`。
- `file.request(kind)`：请求打开隐藏 file input；不携带 File 对象。
- `file.selected(kind, files)`：文件选择完成后发送；导入解释由 application 负责，不在 UI 内解析。
- `storage.quickSave()`、`storage.loadQuickSave()`、`storage.saveSnapshot(slot)`、`storage.loadSnapshot(slot)`、`storage.deleteSnapshot(slot)`、`storage.saveArchive()`、`storage.loadArchive(file)`。
- `export.request(kind, options)`、`screenshot.capture()`。

### 相机

- `camera.setProjection(mode)`、`camera.preset(side)`、`camera.frame(target)`。
- `camera.navigate(intent)`：接收输入层生成的 `{ kind: 'orbit' | 'pan' | 'zoom' | 'rotate' | 'wheel', delta, scale, angle, center, modifiers, source, gestureId }` 纯数据意图；应用层负责解释和限制相机变化。
- `camera.setSetting(field, value)`、`camera.setAutoRotate(enabled)`。

### 通用动画

- `animation.createTrack(target, channel, timeMs, value, easing?)`、`animation.deleteTrack(trackId)`、`animation.selectTrack(trackId | null)`：`target` 只能是 `{ kind: 'node', nodeId }` 或 `{ kind: 'camera' }`；node channel 为 `position | rotation | scale`，camera channel 为 `position | rotation | fov`。创建时必须携带首个关键帧，同一 target/channel 只能有一条 track；成功结果必须返回 domain 生成的新 `trackId`。
- `animation.setDuration(durationMs)`、`animation.setLoop(enabled)`。Duration/Loop/Track/Keyframe 编辑更新项目动画文档并推进 `ProjectService.projectVersion`/dirty，不修改 `SceneDocument.version`，也不进入场景 History。
- `animation.addKeyframe(trackId, timeMs, value, easing?)`、`animation.replaceKeyframe(trackId, keyframeId, timeMs, value, easing?)`、`animation.removeKeyframe(trackId, keyframeId)`、`animation.moveKeyframe(trackId, keyframeId, timeMs)`、`animation.selectKeyframe(trackId, keyframeId | null)`：身份只使用稳定 `trackId`/`keyframeId`，不使用列表索引或显示名称；`value` 必须匹配 target/channel。`addKeyframe` 成功结果必须返回 domain 生成的新 `keyframeId`；`replaceKeyframe`/`moveKeyframe` 保留原 `keyframeId`，`removeKeyframe` 只接受该稳定 ID。
- `animation.play()`、`animation.pause()`、`animation.stop()`、`animation.seek(timeMs)`：播放状态、当前时间和 Node/Camera 运行时 override 只属于运行时，不得写入项目、`SceneDocument`、相机作者态或 History。播放仅允许在 Object 模式且没有 Object/Voxel XFORM 时启动；启动前应用层先执行 `stopPlaybackAndClearOverride()`。播放推进由 `AnimationSessionPort.tick()` 驱动，端口实现每帧只求值一次并原子应用完整 `AnimationEvaluation`；UI/EditorSession 不得自行求值或应用 override。停止/取消/失败/非循环自然结束后清除全部 override。
- `animation.setFollowCamera(enabled)`、`animation.setPathVisible(trackId, enabled)`。
- `animation.cameraToView()`、`animation.viewToCamera()`。
- `animation.setControlTransform(field, value)`、`animation.render(options)`、`animation.cancelRender()`。
- 动画面板的 Add Keyframe 根据选中 track 的目标取值：camera track 从 Camera Control 捕获，SceneNode track 从节点当前作者态局部变换捕获；只要播放状态不是 stopped 或仍存在 Node/Camera override，就不得编辑动画文档，应用层必须先执行 `stopPlaybackAndClearOverride()`。

### 控件与反馈

- `palette.selectColor(hex)`、`palette.toggleVisibility(hex)`。
- `colorPicker.preview(hex)`、`colorPicker.commit(hex)`、`colorPicker.cancel()`。
- `confirm.respond(accepted)`。
- `notification.dismiss(id)`。
- `debug.toggleInspector()`：切换 Babylon/调试 Inspector 宿主；不属于普通浮动面板，不得走 `panel.toggle`。

## 约束

- 所有 action 必须是可序列化纯数据，并带稳定的 `type`/`payload` 或类型化 method 签名。
- 动画相关 action 的 `trackId`、`keyframeId`、`target` 和 `channel` 都是稳定数据；不得用节点名称、数组索引、Three.js 对象或运行时 override 代替。
- UI 不直接调用 CommandHandler、Repository、Renderer 或文件解析器。
- 动作名表达用户意图，不表达实现细节；例如使用 `panel.minimize`，不使用 `setDisplayNone`。
- 同一控件重复触发时要由动作层/控制器做幂等或去重，避免重复保存、重复导出或重复提交命令。
- 无效参数在 action 边界拒绝，并返回可展示的 `Result` 或发出错误通知。
