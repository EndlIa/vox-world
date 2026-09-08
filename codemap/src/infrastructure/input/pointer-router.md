# pointer-router.ts

**职责**：把 DOM 指针事件转换为稳定的画布/UI 语义输入，管理单指针编辑会话与 pointer capture 生命周期，并在编辑、导航和 DOM 控件之间做互斥路由。
**接口**：attach(options: PointerRouterOptions): PointerRouterHandle；detach()；setActiveTool(toolId)；suspendEditing(reason)；resumeEditing()；capturePointer(pointerId)；releasePointer(pointerId, reason)；cancelPointer(pointerId, reason)；activePointers()；cancelAll(reason)。
**内部**：只监听 DOM Pointer/Wheel 事件，维护 `PointerSample` 和活动指针表；通过注入的 `ToolInputPort` 调用工具生命周期，通过 `InputIntentSink` 发出动作，不直接修改工具、相机、状态或领域对象。
**依赖**：DOM Pointer/Wheel Events、application/tools/tool、application/editor-session 的输入端口、ui/actions 的纯意图类型、由 app 注入的 InputCoordinationPort/NavigationOwnership 端口、util/disposable。

## 输入模型

```ts
type PointerPhase = 'hover' | 'down' | 'move' | 'drag-start' | 'up' | 'cancel';

type PointerSample = {
  pointerId: number;
  pointerType: 'mouse' | 'pen' | 'touch' | string;
  phase: PointerPhase;
  button: number;
  buttons: number;
  isPrimary: boolean;
  client: { x: number; y: number };
  screen: { x: number; y: number };
  canvasCss: { x: number; y: number };
  canvasDevice: { x: number; y: number };
  normalized: { x: number; y: number };
  pressure: number;
  modifiers: { alt: boolean; ctrl: boolean; meta: boolean; shift: boolean };
  timestamp: number;
  gestureId: string;
  insideCanvas: boolean;
};
```

- `canvasCss` 是相对 canvas 边界的逻辑像素坐标；`canvasDevice` 已乘当前 device pixel ratio；`normalized` 使用 `[0,1]` 表示 canvas 内坐标，但拖拽越界时保留带符号值，不强制 clamp。
- `clientX/clientY` 是命中测试和 DOM 定位的基准；`screenX/screenY` 只用于诊断，不能替代多显示器环境中的 client 坐标。
- `gestureId` 在一次 `pointerdown` 成功路由时生成，并在对应的 up/cancel 中保持不变。合成事件、`pointercancel` 和重复 up 不得生成第二个编辑手势。
- 路由到 `ToolPointerEvent` 时至少保留 pointer id、button、buttons、坐标、modifiers、phase 和 gestureId；额外的压力/时间信息只作为只读元数据，不能迫使工具依赖 DOM 类型。
- 每个事件在进入路由前调用一次 `normalize`；pointermove 若浏览器提供 `getCoalescedEvents()`，只使用最后一个有效样本更新状态，避免一次事件重复提交多次编辑。

## 命中优先级

命中顺序固定为，前一层拥有事件后不得继续向下路由：

1. modal/blocker：确认框、颜色选择器、aria-modal 对话框和其他 `[data-input-blocker]`。
2. DOM 控件：面板、菜单、toolbar、palette、hover 浮层以及 `button/input/select/textarea/[contenteditable]`。
3. gizmo/导航控件：旋转、平移、缩放句柄和相机控制。
4. canvas 编辑面：仅在事件目标是 canvas 或 canvas 的 `pointer-events` 子层时进入工具路由。

- 使用 `event.composedPath()` 或 `event.target.closest()` 做命中测试；不要用坐标反查 DOM 后再猜测所有权。
- 命中 DOM 控件时，pointer router 必须完全让出事件；控件自身的 pointer/keyboard 处理负责 action，不允许冒泡成画布编辑。
- `pointer-events: none` 的装饰层不能成为目标；装饰层应通过 CSS 明确声明。
- modal 打开时 canvas 不接受 hover、down、move、up 或 wheel；Escape/Enter 由 keyboard-router 交给 modal 所有者。
- gizmo 激活时指针优先给导航/gizmo 端口，工具只可收到 cancel 或保持未开始状态。
- `suspendEditing(reason)` 用于键盘临时相机、modal、窗口不可见等场景；挂起期间 pointerdown 只记录位置，不创建 Draft。

## 编辑按钮与指针类型

- 鼠标只有主按钮 `button === 0` 且 `buttons & 1` 可以开始编辑；中键、右键、后退/前进键和 `aux` 按钮不得触发任何建模、选择、变换或预览提交。
- 触控笔只允许主笔尖接触开始编辑；悬浮笔移动可作为 hover，橡皮擦或侧键不得被解释为主编辑。
- 触摸只允许 `isPrimary` 的单指接触进入编辑候选；第二根手指出现时由 gesture-router 抢占为导航，pointer router 立即取消候选/编辑会话。
- 右键在 canvas 上只产生导航或上下文菜单意图；如果当前工具需要右键语义，必须由显式 `ToolCapabilities.editButton` 声明，不得按工具名硬编码。
- 修饰键在 `pointerdown` 时冻结到当前手势；中途按下/释放 Shift、Ctrl、Alt 只影响下一次手势或已声明的导航语义，避免同一手势改变编辑模式。
- 主按钮的 `pointerdown` 在 DOM 控件上必须允许控件获得焦点和正常 click；router 不得为了画布编辑调用 `preventDefault`。

## Pointer capture 生命周期

每个活动指针只允许有一个 capture 所有者：

```ts
type ActivePointer = {
  pointerId: number;
  gestureId: string;
  captureTarget: HTMLElement;
  phase: 'pending' | 'editing' | 'cancelled';
  startedAt: number;
};
```

1. `pointerdown` 通过命中、按钮、导航所有权和编辑挂起检查后，创建 `ActivePointer` 并生成 `gestureId`。
2. 只有工具明确接受 down（或路由策略判定为编辑）后，才在 canvas 上调用一次 `setPointerCapture(pointerId)`；失败时立即调用 `pointerCancel` 并移除会话。
3. `pointermove` 只处理活动表中同一 pointer id；第一次超过拖拽阈值时标记 `drag-start`，随后为 `move`。未达到阈值不得发送重复命令，也不得触发 hover 选择。
4. `pointerup` 对活动指针发送一次 `pointerUp`，无论工具返回成功或失败，都先移出活动表，再调用 `releasePointer`，最后让 lostpointercapture 成为无操作。
5. `pointercancel`、`lostpointercapture`、窗口 blur、visibilitychange、路由 detach 或导航抢占必须调用一次 `pointerCancel(reason)`，丢弃 Draft、清除预览和未提交状态，不得产生命令。
6. `releasePointer` 前检查 `hasPointerCapture`；释放后从活动表删除。重复 release、重复 cancel 和重复 lostpointercapture 必须幂等。
7. capture 目标固定为 canvas；面板、hover、palette 和控件使用各自的局部拖拽 capture，不通过 pointer router 转发。
8. 异步工具提交期间 router 不接收第二个主编辑指针；直到当前手势结束或取消后才可开始新会话。

## 坐标与视口

- `getBoundingClientRect()` 每个 pointerdown 读取一次并缓存到手势；pointermove 只使用缓存的 rect，避免拖动中因布局变化反复触发布局读取。
- `canvasCss = client - rect.left/top`；`canvasDevice = canvasCss * devicePixelRatio`；`normalized = canvasCss / rect.width/height`。
- canvas 的 backing store、CSS 尺寸和 DPR 不一致时以 CSS rect 为输入基准，以 device 坐标供 GPU picker/像素读取使用，禁止把两种坐标混用。
- canvas 被 resize 时，活动编辑手势以 `resize`/`pointercancel` 结束并释放 capture；不得让旧 rect 继续驱动新尺寸下的拾取。
- 越界拖拽保留带符号坐标并继续通过 capture 更新预览；`insideCanvas` 为 false 时工具不得把坐标当作新的 canvas 命中点。

## Wheel 与导航隔离

- `wheel` 只有在目标是 canvas 时才 `preventDefault()`，监听器使用 `{ passive: false }`；面板、菜单和输入框内的滚动不得被拦截。
- wheel 是导航意图，不是编辑手势。router 把标准化后的 delta、deltaMode、修饰键和 canvas 坐标交给 InputCoordinationPort/navigation port，不调用工具 pointer 生命周期。
- 收到 wheel 后设置短暂的 `wheelSuppressedUntil = now + 300ms`；在此期间 hover 预览和依赖滚轮后悬停的工具不得开始新的编辑，连续 wheel 重置计时器。
- 若 wheel 到达时存在活动编辑 Draft，发送 `pointerCancel('navigation-wheel')`，释放 capture，清除预览；禁止先提交再导航。
- `Ctrl+wheel` 可能是触控板 pinch 或浏览器缩放；只在 canvas 且导航端口声明接管时阻止默认，其他情况不抢占页面/控件行为。
- 鼠标中/右键导航、触摸双指、轨道旋转和 pinch 开始时，先通过 `NavigationOwnership` 标记 owner；router 检查到 owner 后不创建编辑会话，并取消任何未完成编辑。

## 取消、生命周期与验证

- `detach()` 必须按顺序：停止新事件路由 -> 取消所有活动指针 -> 释放全部 capture -> 清除 wheel/hover 计时器和订阅 -> 移除监听器。重复 detach 无副作用。
- 页面 `visibilitychange` 进入 hidden、window blur 或 UI 卸载时调用 `cancelAll('lifecycle')`；不得让 Draft、preview 或 capture 跨越生命周期。
- 组件异常不得留下半初始化的全局监听器；attach 失败时回滚已注册监听器和临时状态。
- 必须验证：UI 控件点击不编辑 canvas、中/右键不编辑、触摸双指不提交、capture 丢失只取消一次、DPR 缩放命中正确、wheel 只在 canvas 拦截、卸载后没有残留监听或活动指针。
