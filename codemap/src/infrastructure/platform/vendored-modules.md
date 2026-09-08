# vendored-modules.ts

**职责**：维护浏览器运行时第三方模块的规范 specifier、vendored 文件路径和校验规则，确保 import map、源码导入与打包白名单一致。

**接口**：`IMPORT_MAP`、`VENDORED_MODULES`、`validateImportSpecifiers(sourceFiles)`、`assertMappedTargetsExist(root)`。

**内部**：
- `index.html` 的 import map 必须来自/镜像本模块的映射表；映射表至少覆盖 `three`、所需 `three/examples/jsm/*`、`three-mesh-bvh`、`three-gpu-pathtracer`、`mp4-muxer`、`reinvented-color-wheel`、`tweenjs` 等项目运行时依赖。
- 所有浏览器第三方 import 必须使用映射表中的 specifier；禁止在 renderer 代码中写 `node_modules/...` 或未经映射的深层路径。
- 每个映射目标必须是相对应用根的可打包路径，实际文件存在且与 specifier 一致；worker 中的 import 也必须能被打包后的路径解析。
- 经典脚本（例如全局注入的 Babylon/JSZip）与 ES module 分开记录，加载顺序和 import map 位置固定：import map 必须出现在任何 module script 之前。
- 新增依赖时同步更新映射表、`src/modules/**/*` 打包白名单和启动验证；不得依赖 CDN 作为主路径。
- 校验失败应阻止发布构建并列出缺失文件/未映射 specifier，而不是等到运行时白屏。

**边界**：不加载业务模块、不解析 package.json、不实现 bundler；只描述 vendored 模块的解析与验证契约。

**依赖**：runtime-config、packaging。

