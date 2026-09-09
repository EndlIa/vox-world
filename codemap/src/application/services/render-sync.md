# render-sync.ts

**职责**：把领域变化同步到渲染器。
**接口**：syncInitial、applyPatch、syncSelection、syncPreview、invalidate。
**内部**：
- `syncInitial` 从 `SceneSnapshot` 建立场景节点、对象实例缓冲和世界变换；每个 `VoxObject` 的体素只在对象局部空间上传，世界变换由绑定 `SceneNode` 承担。
- `applyPatch` 消费 `ScenePatch`：节点增删/重挂载/变换、对象绑定、对象可见性和对象局部体素变化分别标脏对应渲染资源；不得把所有对象重建成一个全局体素缓冲。
- Edit 模式的预览壳、working pick 和选择高亮只作用于活动对象；其他对象按节点有效可见性正常渲染，但不接收编辑预览。
- 批量合并变更、按对象/块标脏、保证提交顺序；只读取 SceneDocument 快照，从不反向修改领域状态。
- Object 模式的对象选择/变换预览与 Edit 模式的体素选择预览必须使用不同的渲染层和生命周期，不能互相覆盖。

**依赖**：renderer-port、scene-types、scene-patch、scene-document、editor-state、voxel-patch、voxel-types。
