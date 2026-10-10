# 油猴脚本 1.2.0

日期：2026-10-10。

点击 eLearning 的支持文件名即可在页面弹窗阅读。PDF 可选择浏览器自带或内置 PDF.js，首次默认浏览器自带；选择通过脚本管理器存储。切换复用已读取的文件，下载保留原字节。

新增 PNG、JPEG、WebP 图片，以及文本与常见代码文件的纯文本预览。PDF.js 支持翻页、页码跳转、缩放、适合宽度、选中文字和密码重试。初始化、密码取消或渲染失败时提供明确提示与手动原生回退。

[安装脚本](https://raw.githubusercontent.com/sjy0630/fudan-elearning-pdf-preview/main/elearning-pdf-preview.user.js)。已安装用户可通过管理器检查更新；新增 `GM_getValue`、`GM_setValue` 仅用于阅读器偏好，网站匹配和原有连接范围保持不变。请避免重复启用同名脚本与独立扩展。

PDF.js 及其后台代码、字体、CMap 和解码资源随脚本打包，不使用运行时 CDN 或上传课件。脚本为 5,086,845 字节，SHA-256：

```text
f6c5515c7d083de0c362b587f7d3afc5210500c2092807072461c4aa3e93e313
```

63 项单元测试、Chromium 155 / Firefox 156 的阅读器和多格式整合测试通过；真实 Tampermonkey 5.5.0 / Chromium 155 的 15 项隔离验收通过。该管理器验证覆盖普通编辑器安装和页面刷新，使用合成课程与文件；真实课程、URL 安装、升级权限提示及浏览器重启仍需补充。完整结果见 [阅读器验证](../READER-VALIDATION.md)；格式和大小限制见 [README](../../README.md)。
