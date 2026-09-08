# editor-session.ts

**职责**：编辑器用例的总协调者。
**接口**：newProject、open、save、import、export、dispatch、undo、redo、tick。
**内部**：持有显式的状态对象，调用 CommandBus 执行纯数据命令，协调渲染同步、拾取和项目用例；undo/redo 只应用 History 返回的补丁；不包含具体编辑规则，不直接读写 DOM 或 Three.js。
**依赖**：state、commands、services、ports。
