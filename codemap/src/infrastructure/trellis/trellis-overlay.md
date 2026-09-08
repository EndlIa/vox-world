# trellis-overlay.ts

**职责**：Trellis 遮罩与生成预览渲染。
**接口**：setMask、setPreview、setHover、clear。
**内部**：使用独立拾取层和覆盖材质，避免与编辑器选择层冲突。
**依赖**：three、id-pass。
