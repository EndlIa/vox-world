# project-service.ts

**职责**：新建、打开、保存、另存为、自动保存项目，并协调 Quick Save 与命名 Snapshot。
**接口**：newProject、load、save、saveAs、autosave、saveQuick、restoreQuick、listSnapshots、saveSnapshot、restoreSnapshot、deleteSnapshot、cancel、state。
**内部**：通过注入的 repository-port、应用层 `ProjectDocumentPort`（基础设施适配器组合 project-codec 和 baked-mesh-codec）、`SnapshotPort`（基础设施适配器包装 snapshot-service）与 render-settings-service 处理当前格式文档、项目设置、资产和原子写入；只更新项目会话的 dirty 状态。
**依赖**：repository-port、application/ports/animation-port、domain/animation、project、scene-document、render-settings-service、本文件定义的 `ProjectDocumentPort`/`SnapshotPort` 应用契约；具体 codec 和 snapshot-service 只由 app composition root 注入，application 不直接 import infrastructure。

## 本重构必须补齐

现有占位只写“保存和自动保存”。必须明确：

- shithill 只有手动项目下载、Quick Save 和命名 Snapshot，没有自动保存定时器；autosave 是目标架构新增能力，不能伪装成原行为。
- 项目保存必须包含统一的 `animation: AnimationDocument`、当前 `camera`/`render` 设置和自持久化的 Bake Mesh manifest/资产。
- `AnimationDocument` 的类型与校验规则由 `domain/animation` 唯一拥有；ProjectService 只捕获/替换该文档，不声明并行轨道 DTO，也不把求值结果当成项目数据。
- localStorage 配额失败不能清除 dirty、不能报告成功、不能破坏原快照。
- 加载、保存、另存为和 Snapshot 恢复都必须以不可变快照和原子提交为基础。

## 会话状态

```text
ProjectServiceState {
  projectId?: string;
  name: string;
  projectVersion: number;
  savedProjectVersion?: number;
  dirty: boolean;
  saveStatus: "idle" | "saving" | "saving-as" | "autosaving" | "error";
  activeJobId?: string;
  lastSavedAt?: string;
  lastAutosaveAt?: string;
}
```

`projectVersion` 是项目聚合的持久化修订号，覆盖场景、动画、camera/render 和 Bake Mesh manifest；`savedProjectVersion` 是最近一次成功保存捕获的修订号，`dirty` 由两者不等推导。`SceneDocument.version` 仍是场景命令的并发令牌 `baseSceneVersion`，二者不得混用：场景 Patch 成功会同时推进场景版本和项目版本，动画/项目设置变化只推进项目版本。

任何持久化编辑提交后增加 `projectVersion`；保存只能把开始保存时捕获的版本标记为已保存，保存过程中产生的新编辑必须继续 dirty。

## 项目保存

```text
SaveRequest {
  destination?: RepositoryRecordKey;
  suggestedName?: string;
  includeBakedMeshes: boolean;      // 默认 true
  signal?: AbortSignal;
}
```

1. 捕获项目元数据、完整 authored/base `SceneSnapshot`、`AnimationDocument`、`render-settings-service.toProjectSettings()` 返回的 camera/render 普通数据，以及 Bake Mesh manifest 的不可变快照；不得捕获播放状态、当前时间、`AnimationEvaluation` 或运行时 override。
2. 调用注入的 `ProjectDocumentPort.encode()` 编码并校验；若包含 Bake Mesh，先由该端口的资产 codec 适配器编码几何/材质/纹理资产，再通过 repository-port 写入。
3. repository 执行原子替换。文件系统写临时文件后 rename；IndexedDB 使用单事务；失败保留原项目。
4. 成功后才更新 `savedProjectVersion`、`lastSavedAt` 和 dirty 状态；失败返回 typed error，dirty 保持。
5. 保存期间的新编辑不被静默覆盖。保存任务串行化；若已有保存进行中，新请求按 `latest-wins` 排队或返回 `SAVE_IN_PROGRESS`，由 UI 明确选择。

`saveAs` 必须先生成完整新文档和新资产，再在目标位置原子提交；不能先删除旧目标或把当前项目切到半写状态。取消发生在提交前时目标文件不变。

## 打开与新项目

- `load` 先读取字节/文档，再由 `ProjectDocumentPort.decode()` 校验当前格式、SceneSnapshot、`AnimationDocument` 与 Bake Mesh 资产，并通过 `render-settings-service` 校验完整的 camera/render 设置；动画必须使用同一解码文档的 `data.scene` 调用 `validateAnimation`，拒绝悬空或根节点目标、重复轨道/关键帧 ID、重复 `target` + `channel`、空轨道、`durationMs` 非有限或 `<= 0` 和非法关键帧。全部成功后才一次性替换 SceneDocument、EditorState、选择、动画和项目设置。
- 未知项目版本、缺失必填字段、旧 `cameraAnimation` 字段、非法关键帧或非法 camera/render 值必须拒绝整个文档；不得在加载时补齐字段、迁移旧字段或过滤坏数据。
- 加载失败必须保留当前项目、当前渲染设置和当前会话，不得部分提交；恢复后 Camera Control 和播放状态重置。
- 缺资产、场景不变量失败或对象引用错误返回对应 typed error，保留当前项目和当前会话，不自动清理项目 manifest。
- `newProject` 原子重置为一个含根节点、零对象的空 `SceneSnapshot`、默认动画、camera/render 项目设置、Bake 池、EditorState、选择、History 和 `projectVersion`；项目设置通过 `render-settings-service` 生成默认值，但不重置工作区偏好。当前项目 dirty 时由调用方先确认保存/丢弃。
- 项目替换成功后清理原项目独占的临时资源和零引用资产，但不删除仍被其他项目引用的共享资产。
- ProjectService 订阅 SceneDocument、动画文档、Bake Mesh manifest 和 render-settings-service 中项目作用域的持久化变更并增加 `projectVersion`；播放、暂停、seek、Follow/Observe、纯运行时相机移动或 override 变化只存在于运行时，不得推进 `SceneDocument.version`、`projectVersion` 或把项目标为 dirty。打开、新建和 Snapshot 恢复成功后重置 `projectVersion`/`savedProjectVersion` 并建立新的 History checkpoint。

## Autosave（本重构新增）

- autosave 默认关闭，由用户设置启用；启用后建议间隔 60 秒，并只在 `dirty` 时运行。
- autosave 写入 repository 的内部 `autosave` 项目记录，包含完整 ProjectDocument（含 camera/render）和 Bake Mesh 资产，不覆盖命名 Snapshot、Quick Save、项目文件或用户选择的另存为目标。
- 若后端不支持二进制资产，只能经用户显式同意退化为仅 SceneSnapshot/`AnimationDocument` 的 Quick Save，并在 UI 说明 Bake Mesh 不会自动保存；不得静默降级。
- 每次持久化提交更新 `projectVersion`；autosave 启动时捕获该版本，只有保存成功且版本未变化时才清除 dirty。保存期间发生编辑则继续 dirty，并在下一个节流窗口重试。
- 同一时刻最多一个 autosave。失败返回 `QUOTA_EXCEEDED`/repository error 并保留 dirty，UI 必须可见；禁止静默重试覆盖错误。
- 启动时发现 autosave 比最近手动保存更新时，只提示恢复，不自动覆盖用户项目。
- 页面隐藏或卸载可触发一次 best-effort autosave，但不得阻塞卸载；失败不能声称已保存。

## Quick Save 与命名 Snapshot

- `saveQuick`/`restoreQuick` 委托注入的 `SnapshotPort`（由 snapshot-service 适配）；Quick Save 持久化 `SceneSnapshot` 和完整 `AnimationDocument`，不持久化 Bake Mesh 资产、运行时 Camera Control 或播放状态。
- 命名 Snapshot 支持名称、时间戳和缩略图；保存、恢复、删除的配额与回滚规则由 `SnapshotPort` 实现保证。
- Snapshot 恢复先严格解码并校验当前格式，再一次性替换场景和动画；Snapshot 不保存 camera/render，因此恢复时保留当前项目的 camera/render 设置。失败时当前项目与槽位均不变。
- Snapshot 归档写出是本地备份能力。外部 ZIP 导入明确属于 import 边界，本服务不提供任意归档导入入口。

## 失败、取消与生命周期

- `cancel(jobId)` 只能取消尚未提交的保存。提交后取消返回 `CANCELLED_TOO_LATE`。
- 进度阶段为 `snapshot`、`encode`、`assets`、`writing`、`committing`、`finalizing`。
- 所有临时 Blob、reader/writer、资产写入句柄在成功、失败、取消后释放。
- 服务只发布只读状态和进度，不向 UI 暴露 repository、Three.js mesh 或可变项目对象。
