# builtin-tools.ts

**职责**：实现 Object 模式的对象选择/变换/可见性，以及 Edit 模式的建模、绘制、填充、颜色选择、体素选择、变换、可见性和测量工具状态机。

**接口**：`createBuiltinTools(context)` 返回按 id 索引的 Tool 工厂；每个工具实现 `tool.ts` 的完整生命周期。

**内部**：
- 通用规则：工具只在其声明模式与当前 EditorState 一致时激活；仅主编辑按钮起笔；同一手势按稳定身份去重；预览不提交；提交只产生一个原子命令；导航、取消、失焦或工具切换必须清理 Draft 和预览。开始任何 Object/Voxel XFORM 或进入 Edit 工具前，由 EditorSession 执行 `stopPlaybackAndClearOverride()`，停止动画播放并清除全部 Node/Camera 运行时 override；工具不得读取 evaluated override 作为作者态。
- Object Select/Object Transform：只拾取 `VoxObjectId`，先确保动画已停止且全部 Node/Camera override 已清除，再启动 ObjectTransformSession 并修改绑定 SceneNode 的基础局部变换；不返回或修改任何体素键，也不修改动画轨道。Object Visibility 只修改绑定节点的 `visible`。
- Palette 交互：`palette.selectColor(hex)` 只更新当前编辑颜色，作为下一次手势冻结的颜色，不生成 Patch；`palette.toggleVisibility(hex)` 在 Edit 模式下通过 `SetVisibilityCommand({ objectId: activeObjectId, kind: "color", color: hex, visible })` 原子切换活动对象中该颜色组全部体素的可见性，XFORM 活动时忽略该操作。Eyedropper 只同步当前颜色，不代替 Palette 的显隐命令。
- Freehand Add/Remove/Paint：按住拖动连续处理命中体素。Add 使用命中面法线偏移到相邻空格；Remove/Paint 只作用于已存在体素。Paint 对同一体素只上色一次。启用对称时，Add 展开镜像位置，Remove/Paint 只在镜像目标存在时加入。
- Bridge：从活动对象的命中体素沿六个轴向法线逐格延伸。未开启 `Bypass Bridge` 时遇到占用体素立即停止；开启后允许穿过已有体素，但仍不得越过活动对象局部 AABB。到达 AABB 边界即停止。整条桥在手势结束时作为一个 Add 命令提交，并按对称展开；不覆盖已有体素。
- Box Add/Remove/Paint：按下和当前位置形成整数闭区间。`Add Wall` 高度大于 1 时只对 Box Add 生效，将终点 Y 固定为起点 Y + height - 1，形成墙面。预览盒超过实现上限时隐藏盒预览并禁止提交，不能只提交部分范围。Remove/Paint 只处理区间内已存在体素。
- Rectangle Add/Remove/Paint：按下和当前位置形成屏幕矩形。ToolContext 提供屏幕内候选键和当前 render-target 可见表面键。Add 沿命中面法线投影候选；Remove/Paint 作用于候选。`Bypass Rect` 只控制 Add/Remove：关闭时过滤为表面可见键，开启时使用全部投影深度；Rect Paint 保持屏幕投影候选语义并去重。
- Bucket Group：拾取活动对象的规范化颜色即颜色组；把该对象中颜色完全相同的全部体素改成当前颜色，一次 Patch。不得跨对象传播。
- Bucket Island：以拾取体素为种子遍历连通分量并整体上色。`Add Connected` 关闭时使用 6 邻域；开启时使用 6 邻域加 20 个边/角方向（26 邻域）。默认只跨可见体素遍历，隐藏体素阻断连通。
- Eyedropper：从可见表面拾取规范化 `#RRGGBB` 并更新当前工具颜色和调色板当前色；不生成 Patch、不写历史。拾取失败保持原颜色。
- Coordinate Add：解析恰好三个十进制整数 `x,y,z`。提交前先 Apply 未完成 XFORM；坐标必须为安全整数；已占用坐标按 `skip-existing` 忽略；成功时发出一个 Add 命令并保持当前颜色。
- Paint All：确认后先 Apply XFORM，再把活动对象的全部体素设为当前颜色并把全部体素设为可见；一个事务、一个历史项。
- Hide Color / Isolate Color / Delete by Color：从活动对象的可见表面拾取颜色组后分别发送 Set Visibility(color, false)、Set Visibility(isolate-color)、Remove(color) 命令。三者都只作用于该对象中精确同色的全部体素，包括隐藏体素；Isolate 在同一个 Patch 内先把活动对象全部隐藏再显示目标色，Delete 是单个可撤销事务。拾取失败不产生命令。
- Group by Islands：确认后先 Apply XFORM，再按 6/26 连通性给每个岛屿分配唯一颜色并全部设为可见；这是模型整理动作，不通过拾取工具触发，必须保持稳定颜色顺序。
- Invert Visibility / Unhide All / Delete Hidden：Invert Visibility 原子翻转活动对象的全部 `visible`；Unhide All 把活动对象所有体素设为可见；Delete Hidden 删除活动对象的全部隐藏体素。三者都先 Apply XFORM，各自只写一个历史项。
- Box Select / Rectangle Select / Color Select / Island Select / Visible Select：只创建或扩展活动对象的 VoxelSelection，不修改体素。它们分别使用活动对象局部 Box 候选、屏幕矩形候选、颜色相等候选、种子连通分量和 `visible === true` 候选。XFORM 活动期间所有候选坐标必须用 `candidatePosition` 解析；Add 模式排除重复项和已选 source，Subtract 模式只允许移除当前 session 条目。
- XFORM 工具族：Box Shape、Rectangle、Color Group、Island Voxels、Visible Voxels 分别启动或扩展活动对象的 VoxelTransformSession。开始会话前必须已停止动画并清除全部 Node/Camera override，避免体素选择/变换建立在 evaluated 节点姿态上。Clone 设置或 Shift 进入 `clone` source kind；普通选择进入 `builder`；生成器插入活动对象使用 `new` source kind。创建新对象由 Object 模式的生成器/SceneCommand 处理。
- Measure Volume：拖拽 Box 选择范围，`pointerUp` 只计算并显示 `VolumeReport`（体素数、包围盒尺寸、盒体积、占用率、颜色计数）；单个体素额外显示 `x,y,z,color`。不创建 Selection、不生成 Patch、不写 History，也不改变相机。
- Slice Y / MultiPlane：Slice Y 控件发送可见性命令，`0` 恢复全部可见，正数显示 `y = value - 1`，负数显示 `y = value`。Get MultiPlane 读取当前 MultiPlane 的 Y 位置并转换成 Slice Y；Set MultiPlane 把 Slice Y 转回 MultiPlane 的 Y 位置。MultiPlane 只在 `workplane-only` 或显式激活时作为 Add/Box Add/Remove/Paint 的工作平面，旋转/重置不修改体素或 Selection。
- 工具预览与导航保护：plane 预览用于 Add/Bridge/Box Add；cube 预览用于 Remove/Paint/Eyedropper/Bucket/Visibility/Transform/Measure/Frame 类工具；矩形工具显示 marquee；XFORM working 高亮必须使用独立 working pick 层。导航按钮或动画播放开始时立即取消当前编辑手势；动画播放不得在活动 XFORM/Edit 会话中启动。

**依赖**：tool、tool-context、scene-commands、voxel-commands、voxel-transform-command、model-commands、generator-commands、editor-state、voxel-query、symmetry、util/color、util/result。
