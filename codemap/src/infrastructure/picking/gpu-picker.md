# gpu-picker.ts

**职责**：GPU 拾取实现。
**接口**：实现 picker-port。
**内部**：Object 模式编码对象 ID；Edit 模式只渲染活动对象的体素 ID pass，并编码 `objectId + local voxel id`。渲染 id pass 到 WebGLRenderTarget，读取像素并解码；缓存像素比例和最近拾取结果。
**依赖**：three、id-pass、pick-result、scene-types、editor-state。
