# actions.ts

**职责**：定义 UI 可以发出的类型化用户意图及其参数校验边界。
**接口**：editor.setMode、object.select、object.create、object.delete、object.rename、object.setVisibility、object.transform、tool.select、command.dispatch、history.undo/redo、selection.delete、project.*、file.*、panel.*、camera.*、animation.*、palette.*、colorPicker.*、confirm.respond、notification.dismiss、debug.toggleInspector。
**内部**：动作是纯数据描述，不包含 DOM、Three.js、持久化或命令执行实现；调用方只把 action 交给 editor-session/UI controller。
**依赖**：application/editor-session、ui/editor-view-model。

## 动作分组

### 工具与编辑

- `editor.setMode(mode)`：在 object/edit 之间切换；Edit 模式必须已有选中对象，切换前由应用层处理未完成的 XFORM。
- `object.select(objectId)`、`object.create(options)`、`object.delete(objectId)`、`object.rename(nodeId, name)`、`object.setVisibility(objectId, visible)`、`object.transform(...)`：只作用于 Object 模式。
- `tool.select(toolId, options?: { temporary?: boolean })`：切换工具；不可用工具不得激活。`temporary` 只用于 Space/Alt 等按住式相机模式，应用层负责记录和恢复原工具。
- `command.dispatch(command)`：发送不可变命令数据。
- `history.undo()` / `history.redo()`。
- `transform.apply()` / `transform.cancel()` / `transform.deleteSelection()`。
- `selection.delete()`：Edit 模式删除活动对象的体素选择；Object 模式删除选中对象。由应用层按 EditorState 解析，UI/输入层不自行判断选择类型。
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

### 相机与动画

- `camera.setProjection(mode)`、`camera.preset(side)`、`camera.frame(target)`。
- `camera.navigate(intent)`：接收输入层生成的 `{ kind: 'orbit' | 'pan' | 'zoom' | 'rotate' | 'wheel', delta, scale, angle, center, modifiers, source, gestureId }` 纯数据意图；应用层负责解释和限制相机变化。
- `camera.setSetting(field, value)`、`camera.setAutoRotate(enabled)`。
- `animation.addKeyframe()`、`animation.play()`、`animation.pause()`、`animation.seek(ms)`。
- `animation.setFollowCamera(enabled)`、`animation.setPathVisible(enabled)`。
- `animation.cameraToView()`、`animation.viewToCamera()`。
- `animation.setControlTransform(field, value)`、`animation.render(options)`、`animation.cancelRender()`。

### 控件与反馈

- `palette.selectColor(hex)`、`palette.toggleVisibility(hex)`。
- `colorPicker.preview(hex)`、`colorPicker.commit(hex)`、`colorPicker.cancel()`。
- `confirm.respond(accepted)`。
- `notification.dismiss(id)`。
- `debug.toggleInspector()`：切换 Babylon/调试 Inspector 宿主；不属于普通浮动面板，不得走 `panel.toggle`。

## 约束

- 所有 action 必须是可序列化纯数据，并带稳定的 `type`/`payload` 或类型化 method 签名。
- UI 不直接调用 CommandHandler、Repository、Renderer 或文件解析器。
- 动作名表达用户意图，不表达实现细节；例如使用 `panel.minimize`，不使用 `setDisplayNone`。
- 同一控件重复触发时要由动作层/控制器做幂等或去重，避免重复保存、重复导出或重复提交命令。
- 无效参数在 action 边界拒绝，并返回可展示的 `Result` 或发出错误通知。
