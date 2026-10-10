# 独立插件版 v1.1.0

本次发布属于 `feature/standalone-extension` 插件分支，不合并到 `main`；油猴脚本版继续独立保留。

## 选择安装方式

- **普通 Edge 用户（推荐）**：[从 Microsoft Edge Add-ons 安装](https://microsoftedge.microsoft.com/addons/detail/ibgcgppobifaogaodeimafhpmoonioch)，无需 Tampermonkey、开发者模式或解压。
- **Chrome / Edge 手动安装**：下载下方 Assets 中的 `fudan-elearning-pdf-preview-chromium-1.1.0.zip`，解压后在 `chrome://extensions` 或 `edge://extensions` 开启开发者模式，选择“加载已解压的扩展”。手动安装版不会通过商店自动更新。
- **Firefox 开发测试**：下载 `fudan-elearning-pdf-preview-firefox-1.1.0.zip`。此包未获得 Mozilla 签名，只能在 `about:debugging#/runtime/this-firefox` 临时加载解压后的 `manifest.json`，重启浏览器后需重新加载。最低 Firefox 版本为 142，不是面向普通用户的正式安装包。
- `SHA256SUMS.txt` 包含上述两个 ZIP 的 SHA-256 校验值。GitHub 自动附带的 Source code ZIP / tar.gz 是源码，不是构建好的扩展安装包。

## 功能

- 点击复旦 eLearning 的 PDF 文件名，在新标签页使用自带阅读器预览。
- 支持翻页、页码跳转、缩放、文字选择和主动下载。
- 内置两页演示 PDF，无需学校账号或网络即可体验阅读器。
- PDF.js、worker、字体及相关资源随包分发，不依赖远程阅读器或 CDN 执行代码。
- 文件在浏览器内处理；默认仅访问复旦 eLearning，遇到其他文件服务器时按需申请具体域名权限。

## 使用提醒与验证范围

安装后请停用同名旧油猴脚本或测试版扩展，登录同一浏览器中的 eLearning，并刷新课程页面。扩展不会绕过学校登录或课程访问权限。

仅支持复旦 eLearning 的 PDF，不代表已支持其他学校或文件格式。Edge 商店上架不代表所有真实课程文件、用户设备或国内网络环境都已验证。

本次发布前已通过 16 项单元测试、语法检查、ZIP 完整性与 SHA-256 校验，并确认包内扩展代码与发布源码一致。既有自动浏览器测试使用模拟课程和生成的演示文件；详见源码中的 `docs/VALIDATION.md`。

非官方开源项目，与复旦大学及 eLearning 平台无官方关联。扩展采用 MIT 许可，PDF.js 许可证随包附带。
