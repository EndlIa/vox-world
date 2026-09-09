# renderer-port.ts

**职责**：应用层对渲染器的抽象。
**接口**：mount、resize、render、applyPatch、setSelection、setPreview、dispose。
**内部**：禁止暴露 Three.js 类型；所有更新以 `ScenePatch`、`SceneSnapshot`、普通只读 DTO 和活动对象局部快照表达。`setSelection`/`setPreview` 接收可辨识的 `SelectionView`/`PreviewView`，至少区分 object/voxel、目标对象和节点身份；Object Selection、Object XFORM 预览和 Voxel Selection 预览使用不同通道。
**依赖**：scene-types、scene-patch、voxel-types、voxel-patch。
