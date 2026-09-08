# voxel-material.ts

**职责**：创建和管理体素渲染材质，承接 PBR 参数、颜色空间、透明材质和选中/悬停高亮；不持有 `VoxelDocument`，也不负责设置持久化。
**接口**：
- `createMaterial(kind, parameters)`、`updateMaterial(kind, parameters)`、`setColorSpace`、`setHighlightMode`、`dispose`。
- `kind` 至少包含 `opaque`、`emissive`、`shade`、`translucent-layer`、`preview-shell`。
- `applyDefaultPbr(settings)`、`getDefaultPbr()`、`setVertexColorSpace`、`setMap`、`needsUpdate`。

**内部**：
- 默认 PBR 参数固定为：`roughness = 0.8`、`metalness = 0`、`transmission = 0`、`emissive = #5EC3C5`、`emissiveIntensity = 2`。这些值必须由 `render-settings-service` 统一验证和序列化，材质模块只负责应用。
- 使用 `MeshPhysicalMaterial` 的 vertex colors 渲染体素颜色，默认背面渲染以满足从内部观察几何的稳定性；`clearcoat = 0`，避免不必要的 GPU 开销。黑色体素在 Sandbox 中走 emissive 材质，其他体素走 PBR 材质。
- 颜色空间规则：顶点颜色和 sRGB 纹理按渲染器输出配置转换；不得在每次材质更新时重复转换同一颜色，避免颜色漂移。
- **半透明 thin-instance 材质是必需功能**：持久半透明层必须拥有独立的 `transparent = true`、`opacity < 1` 的 alpha-blended 材质实例，并与工具 ghost 材质分离。不得通过 Babylon 风格的 `overlayAlpha`/overlay pass 模拟，也不得让多个相邻体素共享同一深度写入造成重复混色。
- `preview-shell` 用于连续体素预览：由 `voxel-instances` 提供已经剔除内部面的壳几何，材质使用背面剔除和单层 alpha；同一预览 mask 中的相邻单元只显示外露表面。
- 选中、悬停、工作平面和变换预览的高亮由 overlay 材质处理，不修改已提交体素材质的 PBR 参数；材质切换或 context restore 后必须重新绑定实例颜色和纹理。

**依赖**：three、shader chunks、domain/render 材质设置类型。
