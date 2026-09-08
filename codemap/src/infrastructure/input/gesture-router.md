# gesture-router.ts

**职责**：识别触摸、触控笔、鼠标导航和触控板多指手势，维护导航所有权，并把导航意图与画布编辑手势严格隔离。
**接口**：attach(options: GestureRouterOptions): GestureRouterHandle；detach()；beginPointer(sample)；updatePointer(sample)；endPointer(pointerId, reason)；cancelPointer(pointerId, reason)；owns(pointerId)；activeGesture()；cancelAll(reason)。
**内部**：维护多指指针表、距离/角度/中心点基准和唯一 gesture id；只向 `NavigationIntentSink` 发送 orbit/pan/zoom/rotate 语义，不直接调用相机、渲染器或工具状态。
**依赖**：DOM Pointer/Wheel Events、由 app 注入的 PointerGestureCoordination 端口、application/editor-session 导航输入端口、ui/actions 的纯意图类型、util/math、util/disposable。

## 导航状态机

```ts
type NavigationGesture =
  | { kind: 'none' }
  | { kind: 'pending'; pointerIds: number[] }
  | { kind: 'orbit' | 'pan' | 'zoom' | 'rotate'; pointerIds: number[]; gestureId: string };
```

- `idle` 时第一个 canvas 指针进入 `pending`，只记录样本，不产生导航或编辑意图。
- 第二个触摸/笔指针出现且仍在 canvas 内时，立即从 `pending` 升级为多指手势，并请求 pointer-router 取消已有编辑候选。
- 鼠标中/右键、显式导航按钮和触控板 wheel 由 pointer-router 或本路由直接进入导航，不经过单指 pending。
- 手势一旦拥有所有权，直到所有相关指针结束或取消前，pointer-router 不得创建新的编辑会话。
- 导航意图只包含纯数据：`kind`、`delta`、`scale`、`angle`、`center`、`modifiers`、`source`、`timestamp`、`gestureId`；相机如何应用由 application/navigation port 决定。

## 触摸、鼠标与触控板语义

- 单指触摸拖动在超过导航阈值后默认识别为 orbit；若当前工具已获得 pointer-router 的编辑候选，则优先保持编辑，不能中途偷换成导航。
- 双指距离变化识别为 pinch/zoom；双指角度变化识别为 rotate；双指中心平移识别为 pan。多个变化同时存在时按最大变化量选择主手势，避免一帧发送互相抵消的多个命令。
- 鼠标中键拖动为 pan；右键拖动为 orbit；左键拖动只有在 pointer-router 明确把事件交给导航时才允许，不能与编辑主按钮冲突。
- `Ctrl+wheel` 视为触控板 pinch 或缩放修饰，发送 zoom/pinch 意图；普通 wheel 在 canvas 上发送 wheel/zoom 意图，Shift+wheel 可发送水平 pan。
- wheel 的 `deltaMode` 必须归一化：像素直接使用，行/页乘稳定的行高/页高估算；单次 delta 设置上限，避免设备尖峰造成相机瞬移。
- 浏览器不能可靠区分触控板双指 pan 和鼠标 wheel 时，保留统一的 `wheel` 意图并由导航端口按 `deltaX/deltaY/modifiers` 解释；不要在 router 内硬编码相机距离。

## 手势隔离与 pointer-router 协调

- 所有编辑指针在 pointer-router 中先经过 `navigation.owns(pointerId)`；已被导航拥有的 pointer id 不得进入工具生命周期。
- 导航开始时通过 `PointerGestureCoordination.cancelEditing(pointerId, 'navigation')` 请求 pointer-router 取消；取消必须丢弃 Draft、清除预览和释放 capture，不能提交命令。两个 router 只依赖 app 注入的协调端口，不互相 import。
- 第二根手指到达时，先取得导航所有权，再取消第一根手指的编辑候选；这个顺序保证取消原因和 gestureId 可诊断。
- 手势结束或取消后先清除导航所有权，再让 pointer-router 处理最后一次 up；由于编辑会话已经取消，up 不得被解释为点击或提交。
- 导航期间禁止发送工具 hover、选中预览或命令；相机导航完成后只刷新必要的相机 view model，不重放被取消的编辑。
- 任何导航意图都不得绕过 application 的导航输入端口直接修改 Three.js camera、VoxelDocument、Selection 或 History。

## Capture 与浏览器默认行为

- 多指导航取得所有权后，对每个 canvas 指针调用一次 `setPointerCapture`；`pointerup`、`pointercancel`、`lostpointercapture`、blur、visibilitychange 和 detach 都要释放对应 capture。
- 单指 pending 阶段不 capture；超过导航阈值并正式成为导航后才 capture。若 capture 失败，取消该手势并清除所有权。
- `touch-action: none` 只设置在 canvas/导航面；面板、菜单、输入框和可滚动区域保持正常 `touch-action`，不能在全局禁用滚动。
- 只在事件确实由本路由拥有且目标是 canvas 时调用 `preventDefault()`；不得阻断面板滚动、输入框选择或浏览器页面操作。
- `wheel` 监听必须 `{ passive: false }`；在 canvas 上被接管后阻止页面滚动/缩放，在 canvas 外一律放行。
- 多指指针丢失、数量变化、窗口失焦、页面隐藏或 canvas resize 时立即 `cancelAll('lifecycle')`，避免遗留 capture 和“粘住”的相机。

## 阈值、采样与稳定性

- 使用逻辑 CSS 像素计算中心、距离和位移；设备像素比只用于命中/渲染，不参与手势阈值。
- 建议起始阈值：移动 4px 才进入 pan/orbit，距离比例变化 1.05 才进入 pinch，角度变化 4° 才进入 rotate；阈值应集中配置，不散落在事件回调。
- 使用 pointermove 的最新坐标更新距离/角度；有 `getCoalescedEvents()` 时只消费最后样本，避免同一帧发送重复导航。
- 对中心点和缩放使用短滑动平均或等价的噪声抑制；切换主手势时保留基准，不能每帧重置导致抖动。
- 多指数量变化时重建基准，不把抬起的指针继续计入中心或距离；单指残留时回到 pending 而不是继续发送旧 pinch。

## 生命周期与验证

- `detach()` 停止接收事件、取消所有手势、释放 capture、清除 pointer map 和计时器；重复调用幂等。
- `cancelAll(reason)` 必须对每个活动 pointer 只发送一次 cancel，再清空状态和所有权。
- 必须验证：编辑手势不会被中/右键或双指导航提交；双指 pinch/rotate/pan 不触发体素命令；wheel 在 canvas 外不阻断；capture 丢失后所有权清空；blur/visibilitychange 后无活动手势和相机漂移。
