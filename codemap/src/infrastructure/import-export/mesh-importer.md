# mesh-importer.ts

**职责**：OBJ、STL、GLTF 等网格导入。
**接口**：load、normalize、options。
**内部**：使用 Three loaders 读取网格，输出体素化所需的中性几何数据。
**依赖**：three loaders。
