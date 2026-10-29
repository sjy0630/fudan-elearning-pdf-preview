# PPT / PPTX 本地预览

用户已确认新旧两种格式必须同时支持，并批准逐页阅读、50 MiB / 500 页、双版本同步、本地处理的方案，要求立即开始。本文件记录已批准方案，不重复要求确认，也不表示已经完成。

## 范围

- 精确接管 `.pptx` 与 PowerPoint 97–2003 二进制 `.ppt`，不是重命名后缀或仅提取文本。
- 保留文字、图片、常见形状和基本表格；显示静态幻灯片，提供前后翻页、页码跳转、缩放、适应窗口。
- 字体和复杂图形可能不同于 PowerPoint；不播放动画、音视频，不执行宏、外部链接或嵌入对象。加密、损坏、超限文件明确报错，保留学校原文件入口。
- 油猴和扩展共用解析、隔离渲染及阅读控制核心；油猴仍为单个可安装脚本。已有 PDF / DOCX / 图像 / 文本行为不变。
- 不扩大默认学校或文件服务器权限；无运行时 CDN，不上传课件，不要求安装 Office。版本计划为 1.4.0，本轮不推送 GitHub、不上架、不替换用户已安装的 1.3.0。

## 技术选择

采用 MIT 的 `@web-ppt/core` **0.4.5**，锁定发行包与完整性。该稳定版核心公开 `parse` 能处理两种格式，但自带 Worker 只支持 PPTX，因此使用项目自己的打包 Worker 调用双格式核心，不误用上游 Worker 入口。上游 master 的 beta 文档不能作为稳定版 API 的依据。

原文件由现有授权读取器获取。副本进入后台解析，识别真实 ZIP/CFB 和演示文稿。PPTX 在交给引擎前限制实际解压；PPT 校验 CFB 结构、流及大小。解析和每页渲染都可以超时终止。原字节仅在格式/结构检查通过后启用下载，后续显示失败不丢弃原字节。

Worker 保留演示模型，按请求渲染单页 SVG，不一次渲染 500 页。渲染图形和文字，不执行动画、宏、媒体和链接。内部图片由本次任务创建的资源映射解析，禁止外部请求。主线程清理输出后放入专用 `sandbox=""` iframe，CSP 禁止脚本、连接、导航和外部资源；工具栏位于可信宿主区域。

资源预算：原文件 50 MiB、500 页、展开内容 150 MiB、单部件 50 MiB、单 XML 8 MiB、ZIP 项数 10000、单页图形字符串 8 MiB、单图 4000 万像素、30 秒解析/单页任务超时。限制在相关分配或交付前执行，不只检查文件声明。首次构建按实际依赖许可完整打包。

## 模块与接口

- `shared/presentation-policy.mjs`：类型和预算、传输识别。
- `shared/presentation-package.mjs`：受限 ZIP / CFB 与格式检查。
- `shared/presentation-worker.mjs`：后台解析和按页渲染；禁止外部读取。
- `shared/presentation-runtime.mjs`：任务请求、取消、超时、过期结果与 Worker 清理。
- `shared/presentation-sanitize.mjs`：SVG、图片和隔离文档清理。
- `shared/presentation-reader.mjs`：两版通用的翻页/缩放/适应窗口控件。
- `scripts/bundle-presentation.mjs`：生成浏览器 ESM、独立 Worker 和油猴内嵌工厂，收集许可。
- `extension/presentation-viewer.*` 与油猴模板：读取文件、原文件/下载、取消/重试及生命周期适配。

对适配器提供：

```js
const reader = await createPresentationReader({
  host, bytes, format, mime, signal, makeWorker, onVerified,
});
reader.dispose();
```

`format` 为 `ppt` 或 `pptx`。`host` 是专用空容器，内部创建工具栏和隔离 iframe。`makeWorker()` 返回 `{worker, dispose}`。`onVerified()` 只在确认为可读取的演示文稿后调用。首次解析/渲染失败使 Promise 拒绝；翻页失败在阅读器内明确显示，不覆盖原文件操作。取消、关闭和切换文件清理 Worker、iframe、事件监听器和图片资源；旧异步结果不能写入新预览。

## 验证与发布边界

新增正常 PPTX 和真正 CFB/PPT 样例、后缀/MIME/路由断言、页序和图文内容检查、控件及取消检查；回归相邻格式与打包清单。仅使用本地原创/许可明确样例，不访问真实课程服务器做实验。测试、构建和真实管理器安装分别报告，不用单元测试冒充浏览器兼容认证。

本轮已知基线：`tests/formats.test.cjs` 仍断言 `.docx` 不支持，与现有 1.3.0 不符；同步更新支持矩阵，不改掉有效的错误检测。用户 Word 锁文件 `tests/fixtures/docx/~$normal.docx` 不读、不提交、不删除。
