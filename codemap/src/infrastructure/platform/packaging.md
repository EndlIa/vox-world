# packaging.ts

**职责**：定义 Electron Builder 的身份、目标平台、产物名称和运行时文件白名单，保证开发目录能加载的文件在打包后仍然存在。

**接口**：`PACKAGE_IDENTITY`、`BUILD_TARGETS`、`RUNTIME_FILE_GLOBS`、`validatePackagedRuntime()`。

**内部**：把 package identity、平台目标和运行时白名单集中在单一配置源，并在构建前运行资源完整性校验。

**必须保持的打包契约**：
- `name`: `voxel-world`，`main`: Electron 主进程入口，`appId`: `crd233.voxel-world`，`productName`: `Voxel World`，版本与 renderer 的 `VERSION` 一致。
- Windows 目标为 `portable`，Linux 为 `AppImage`，macOS 为 `dmg`；artifact 名称包含产品名和版本。
- 运行时白名单至少包含 `src/**/*`（或编译后的等价 renderer 输出）、`user/**/*`、Electron 入口和 `package.json`。`src/modules/**/*`、`src/assets/**/*`、`src/examples/**/*`、worker bundle、HTML、CSS 和 shader 不得被裁剪。
- `user/startup.json` 与 `user/module.js` 是运行时资源，不能仅存在于开发目录。
- 浏览器运行时依赖必须 vendored 到打包白名单内；不得依赖未声明的 `node_modules` 路径、CDN 或开发服务器。
- 图标使用 `src/assets/appicon.png`；Windows portable 的签名设置与现有构建保持一致，不擅自添加需要外部凭据的步骤。
- 当前没有原生 Node 模块；若未来引入，必须单独设计多平台 rebuild/asar unpack，不能把 `.node` 文件直接塞入现有白名单。
- `validatePackagedRuntime()` 至少检查入口、index.html、import map 目标、user 文件和示例 manifest 均存在。

**边界**：打包模块不运行应用、不复制项目数据、不改变 import map 语义；Node/Python 服务器是开发辅助入口，不是 Electron 产物必需文件。

**依赖**：vendored-modules、electron-main、package/build 配置。

