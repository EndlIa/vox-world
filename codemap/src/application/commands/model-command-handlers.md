# model-command-handlers.ts

**职责**：校验模型整理/体素算法命令，调度 Worker，并把结果物化为单个可逆 Patch 或只读报告。

**接口**：
- `OptimizeVoxelsHandler`、`ResampleVoxelsHandler`、`FillHolesHandler`、`NormalizeVoxelsHandler`、`CentralizeVoxelsHandler`、`MeasureVolumeHandler`、`SymmetrizeModelHandler`、`MirrorModelHandler`、`RotateModelHandler`、`DeleteHalfModelHandler`。
- 每个 Handler 实现 `canHandle`、`validate(command, context)`、`execute(command, context) -> Promise<CommandOutcome>`；context 提供只读快照、领域操作、WorkerPort 和 operation 注册表。

**内部**：
- 通用门禁：EditorSession 先 Apply 活动 XFORM；Handler 再校验 `baseVersion`。版本冲突返回 `stale-version`，原 session/文档/History 不变。
- Optimize：从只读快照调用 `optimize`，支持 6/18/26。结果若超过 `inlineAlgorithmLimit` 则通过 WorkerPort 执行 `findInnerVoxels` 等价任务；完成后把输出快照转成 `replaceAll` Patch。隐藏体素参与占用判断，输出统一可见；空结果或全删除也生成可撤销 Patch。
- Resample：校验 `factor > 0` 或 `targetResolution > 0`，且 `samplesPerAxis ∈ {1,2,3}`；由领域函数解析目标 factor、最小占用锚点和颜色投票。Worker 输入/输出都是纯快照；平票规则必须与领域函数一致，不能依赖 Map 插入顺序。
- Fill Holes：调用 `fillHoles` 的完整契约：外扩 1 格、6 邻域 dilation + erosion、边界 flood-fill、封闭空腔填充。已有颜色保留，新体素使用 `fallbackColor` 且可见；输出通过一个 `replaceAll` Patch 提交。若只实现 dilation/erosion，Handler 必须返回 `algorithm-incomplete`，不能静默假装完成。
- Normalize/Centralize：根据领域 `TransformPlan` 平移所有体素，颜色/可见性保持不变；空模型返回空结果。Centralize 的整数舍入残差由 Handler 作为 warning 返回，但不得生成非整数键。
- Measure Volume：只调用 `measureVolume`，返回 `VolumeReport`、无 Patch、无 History、无文档版本变化；范围为空返回零值报告。
- Symmetrize：先解除全部隐藏；`side = +1` 保留负侧和中线、镜像到正侧，`side = -1` 保留正侧和中线、镜像到负侧。先删除被替换半区，再按 `round(2 * pivot - position)` 加入镜像体素，颜色/可见性取保留侧，最终按键去重并生成单个 Patch。
- Mirror：对全部模型体素原地镜像，使用同一 pivot 公式；目标冲突后写入者覆盖，颜色/可见性取源体素，输出不得有重复键。XFORM 活动时此 Handler 必须拒绝并要求走 `MirrorSelectionCommand`。
- Rotate：只支持绕当前轴 90 度 CW/CCW。Bounds pivot 用模型占用包围盒旋转并保持最小角锚定；World pivot 用 `(-0.5, -0.5, -0.5)` 计算后四舍五入到整数。XFORM 活动时此 Handler 必须拒绝并要求走 `RotateSelectionCommand`。
- Delete Half：只删除指定半区，中线体素保留；先解除全部隐藏，不改变 pivot/axis，生成可逆 Remove/relocate Patch。XFORM 活动时此 Handler 必须拒绝。
- Worker 边界：所有长任务必须通过 `WorkerPort.run`，输入是只读快照和纯参数，输出是快照/报告；Handler 不接受 Worker 原始消息，不直接把结果提交给 `VoxelDocument`。进度、错误和取消以 `operationId` 关联。
- 取消/失败：取消、Worker 异常、算法超限或非法参数都不生成 Patch、不递增版本、不写 History；成功后由 CommandBus/Transaction 原子提交，再由 RenderSync 消费最终 Patch。

**依赖**：model-commands、model-operations、symmetry、voxel-document、voxel-patch、worker-port、util/result。
