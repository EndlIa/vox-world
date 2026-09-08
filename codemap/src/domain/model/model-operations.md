# model-operations.ts

**职责**：提供 Optimize、Resample、Fill Holes、Normalize、Centralize、Measure Volume、Group by Islands 和可见性批处理的纯模型规则。

**接口**：
- `optimize(snapshot, neighborhood: 6 | 18 | 26) -> VoxelSnapshot`。
- `resample(snapshot, { factor?, targetResolution?, samplesPerAxis: 1 | 2 | 3 }) -> VoxelSnapshot`。
- `fillHoles(snapshot, { fallbackColor, closing: true }) -> VoxelSnapshot`。
- `normalize(snapshot) -> TransformPlan`、`centralize(snapshot) -> TransformPlan`。
- `measureVolume(snapshotOrScope) -> VolumeReport`。
- `groupByIslands(snapshot, { connectivity: 6 | 26; seed: number; unhideAll: true }) -> VoxelSnapshot`。
- `invertVisibility(snapshot) -> VoxelSnapshot`、`setVisibilityBySlice(snapshot, sliceY) -> VoxelSnapshot`、`deleteHidden(snapshot) -> VoxelSnapshot`。
- `TransformPlan`：`delta: GridPosition`、`sourceBounds`、`resultBounds`、`residual?: GridPosition`；不直接修改文档。
- `VolumeReport`：`voxelCount`、`occupiedBounds`、`dimensions`、`boundingVolume`、`occupancyRatio`、`byColorCounts`。

**内部**：
- 所有函数只处理纯快照并返回新快照/纯报告；不依赖 Three.js、DOM、Worker、Selection、History 或全局随机数。输出按 `VoxelKey` 稳定排序，输入不被修改。
- Optimize：对每个体素检查指定邻域的所有偏移；所有邻居都存在时删除该内部体素，否则保留。隐藏体素仍算占用，不能被当作空气。6/18/26 分别对应轴、轴+边、轴+边+角。输出保留原颜色并统一 `visible = true`，与 shithill 的 Optimize 结果一致。
- Resample：输入非空且 `factor > 0`，`samplesPerAxis` 只能是 1/2/3。以当前占用最小坐标 `min` 为锚点，对每个体素使用偏移 `(i + 1) / (samplesPerAxis + 1)`，输出桶为 `min + floor((position + offset - min) * factor)`。每个桶统计颜色票数，票数最高者获胜；平票按规范化颜色字典序最小者获胜，保证确定性。`targetResolution` 与 `factor` 互斥，前者由 `targetResolution / maxOccupiedSide` 转换；结果坐标保持安全整数，输出统一可见。
- Fill Holes / Binary Closing Fill Holes：先按紧包围盒向外扩 1 格建立 `Uint8Array` 占用掩码。执行 6 邻域 dilation 后再执行 6 邻域 erosion，形成 Binary Closing；随后从边界空单元做外部 flood-fill，所有未被外部访问到的封闭空单元填充为占用。已有体素保留原颜色，新体素使用 `fallbackColor` 且 `visible = true`。实现必须补上封闭空洞 flood-fill；不能只做 dilation/erosion 后把“闭合小缝隙”误称为 Fill Holes。
- Normalize：把占用包围盒最小角平移到世界原点 `(-0.5, -0.5, -0.5)`；对整数体素中心等价于 `delta = -min`。返回平移计划，不改变颜色/可见性。
- Centralize：把占用包围盒中心移到世界中心 `(-0.5, -0.5, -0.5)`。精确平移可能为半整数，而 `GridPosition` 只能是安全整数，因此每轴取最接近的整数平移（平票向负方向），并在 `residual` 报告剩余偏差；颜色/可见性不变。若调用方要求精确连续坐标，应拒绝而不是产生非整数体素键。
- Measure Volume：空范围返回全零报告，不抛异常。`voxelCount` 是范围内实际体素数；`dimensions = max - min + 1`；`boundingVolume` 是三边乘积；`occupancyRatio = count / boundingVolume`；`byColorCounts` 按规范化颜色分组。报告不写 Patch、不写 History。
- Group by Islands：先忽略隐藏状态，使用 6/26 连通分量；分量按最小 `VoxelKey` 排序。为每个分量分配唯一颜色，排除 `#000000`/`#FFFFFF`，颜色由 `seed + islandIndex` 确定性生成并解决碰撞。所有体素位置不变、`visible = true`，颜色替换为对应岛屿颜色。
- Invert/Unhide/Delete Hidden：Invert 翻转所有体素的 `visible`；Slice 规则为 `0 => 全部可见`、`sliceY > 0 => y = sliceY - 1`、`sliceY < 0 => y = sliceY`；Unhide All 等价于全部 `visible = true`；Delete Hidden 只移除隐藏体素，不改变其余颜色/可见性。

**依赖**：voxel-types、voxel-query、util/color、util/math、util/packed-int、util/result。
