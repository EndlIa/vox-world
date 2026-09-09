# panels.ts

**职责**：注册并管理场景 Outliner、对象属性、工具箱、调色板、项目/File/Storage、相机、渲染、建模、PBR、导出和动画面板的显示、拖拽、层级、最小化和恢复。
**接口**：mount(root, viewModel, actions): PanelManager；register(descriptor)；open/close/toggle(key)；minimize/restore(key)；reset(key)；resetAll()；bringToFront(key)；update(snapshot)；dispose()。
**内部**：每个面板只消费 view model 并发出 actions；面板控制器之间不互相调用，不直接访问应用状态、Three.js 或领域对象。
**依赖**：ui/editor-view-model、ui/actions、ui/dom-contract、ui/palette-panel、DOM。

## 面板注册契约

每个面板使用稳定的 `PanelDescriptor`：

```ts
type PanelDescriptor = {
  key: string;
  element: HTMLElement;
  toolbarButton?: HTMLButtonElement;
  mode: 'model' | 'render' | 'export' | 'all';
  exclusiveGroup?: string;
  homeRect?: { left: number; top: number };
  canDetach: boolean;
};
```

- `key` 是稳定语义键，不随显示文案改变。
- `toolbar_btn_<key>` 是恢复入口；`menu-<key>` 是对应面板。动画面板例外，使用 `#camera-animation-panel` 和 `#toolbar_btn_animation`。
- 所有面板节点必须带 `.panel`，菜单面板同时带 `.menu`；结构、标题和控件仍以 HTML 契约为准。
- 面板注册时不得自行添加第二套 drag listener、全局 z-index 或独立最小化状态。
- Trellis 面板及其 mask 控件不在本模块设计范围内。

## 浮动面板行为

### 拖拽

- 只有标题/工具栏区域 `.row_panel` 或 `[data-panel-drag-handle]` 可以启动拖拽；按钮、输入框、canvas 和列表项的 pointer 事件不得冒泡成拖拽。
- pointerdown 时记录指针 id、初始 client 坐标和面板初始 transform，调用 `setPointerCapture` 并 `bringToFront`。
- pointermove 只更新当前拖拽面板的 transform；pointerup 提交最终位置。
- pointercancel、lostpointercapture、窗口 blur 或 visibilitychange 必须取消拖拽，释放 capture，并保留最后一次有效位置。
- 拖拽不能修改应用状态，也不能触发画布编辑或相机导航。

### z-order

- 普通面板初始层级为 `1000`，每次激活提升到 `1001..2000`，超过上限后重新归一化。
- 点击面板任意非控件区域只提升 z-order，不切换选中工具。
- 颜色选择器、确认层和通知属于更高层的 overlay，不得被普通面板覆盖。
- 关闭/最小化不会改变 z-order 历史；恢复时重新置于最前。

### 最小化、关闭与恢复

- `minimize` 隐藏面板但保留位置、展开状态和内部滚动；toolbar 按钮取消激活态。
- `close` 隐藏面板并恢复为未激活态；toolbar 按钮再次点击必须重新打开同一面板，不能新建 DOM。
- 恢复面板时先执行互斥规则，再显示并聚焦面板标题或第一个可交互控件。
- `Reset/Exit` 对当前面板执行：关闭同组未 detach 的普通面板，把当前面板恢复到 home 位置和初始 z-order，并取消 detach 状态。
- 面板按钮必须提供 `aria-expanded`/`aria-controls`，图标按钮提供 `aria-label` 和 `title`。

### 离屏恢复

- `resize`、窗口恢复和 `visibilitychange` 时检查每个可见面板的矩形。
- 当面板中心或保留边缘离开视口超过阈值时，调用 `reset(key)`；hover 浮层单独调用 `HoverOverlay.reset()`。
- 离屏恢复不得改变面板打开/关闭语义，也不得把隐藏面板重新显示。
- 拖拽位置只在 UI 局部状态中保存；如需持久化，必须通过独立的 UI layout preference 动作，不得写进项目数据。

### 互斥显示

- 同一 `exclusiveGroup` 内，打开一个普通浮动面板时关闭其他面板。
- model/render/export 模式只显示属于该模式的面板；切换模式前先取消未完成的拖拽和 modal 交互。
- detach 面板不参与普通互斥，但仍受模式可见性和离屏恢复约束。
- 工具栏自身不是浮动面板；它只负责打开/关闭/恢复，不直接控制 z-index。

## 面板内容职责

### 工具箱与模式栏

- 左侧工具箱按稳定顺序提供 File、Storage、Camera、Render、Create、Voxelize、Symmetry、Draw、Paint、XForm、Groups、Bakery、PBR、Export、Animation。
- 模式栏提供 object/edit 切换；`workspaceMode` 的 model/render/export 是另一组面板可见性，不得与编辑器模式混用。
- 每个工具按钮通过 `data-tool-id` 发出 `tool.select`，不直接调用工具状态机。
- 顶部快捷栏和悬浮层只发出 view model 中允许的动作。

### 调色板面板

- 调色板由 `palette-panel.ts` 实现，`panels.ts` 只负责注册、显示和互斥。
- 面板显示当前颜色、唯一颜色网格、隐藏颜色状态和列数偏好。
- 点击颜色选择当前颜色；右键或双击切换该颜色可见性；这些行为通过 `palette.selectColor` / `palette.toggleVisibility` 动作完成。

### 场景 Outliner 与对象属性

- Outliner 按 `SceneSnapshot` 的节点树显示稳定节点/对象 ID、名称和有效可见性；点击对象只发 `object.select`，双击或显式 Enter Edit 发 `editor.setMode("edit")`。
- 对象属性面板显示选中对象的节点变换、局部包围盒、体素数量和渲染可见性；修改只发 `object.transform`/`object.setVisibility` 等 Object 模式动作。
- Outliner 可以选中隐藏对象，但 Edit 模式必须通过显式模式切换进入；第一版进入 Edit 要求对象有效可见，隐藏对象需先显式显示，不会因渲染过滤而从 Outliner 消失。

### 项目、File 与 Storage 面板

- 项目面板包含名称输入、New、Load、Save、raw export、screenshot 等控件；导入文件选择器只负责触发/读取 DOM 文件，不解释文件内容。
- Storage 面板包含 quicksave/autosave 状态、命名 snapshot 槽位、缩略图、保存/加载/删除和 archive 操作。
- 命名 snapshot 的缩略图加载失败时显示占位状态，不阻断其他槽位。
- 面板必须区分“尚未保存”“正在保存”“保存失败”和“已保存”状态，并通过 view model 更新。
- 导入相关的格式解析、体素化和业务分支不在本面板模块内。

### 相机与动画面板

- 相机面板提供投影切换、六面预设、Frame All/Color/Voxels/Island、FOV/F-Stop/Focal、Auto Rotate 等控件。
- 动画面板提供 Duration、时间轴、Add Keyframe、Play/Pause、Loop、Follow Camera、Show Camera Path、Camera Control 参数和 Camera/View 双向同步控件。
- 渲染区提供 Width、Height、FPS、Format、Start/End Frame、Transparent、Prefix、Render Animation 和 Cancel；UI 只负责收集选项和展示状态，离线渲染由 application/renderer 执行。
- 所有时间、帧范围和数值输入在 action 边界校验；非法值显示字段错误或通知，不直接修改动画数据。
- 面板布局需保证参数 label 和数值输入可见；动画面板的 z-index 默认高于普通面板、hover 和普通菜单。

## 更新与销毁

- `update(snapshot)` 只更新面板可见性、控件值、禁用状态和状态文本；不重建面板根节点。
- 面板内容按 key 增量更新；列表项使用稳定 id。
- `dispose` 依次关闭 overlay、取消拖拽、释放 pointer capture、移除监听和 observer，再移除面板实例。
- 重复 dispose 必须无副作用。
