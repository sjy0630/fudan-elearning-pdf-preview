# 商店提交材料

状态：安装包已准备；尚未在 Chrome Web Store、Microsoft Edge Add-ons 或 Firefox Add-ons 上架。不要把 ZIP 链接宣传为商店安装链接。

## 名称
复旦 eLearning PDF 预览

## 简短介绍
点击 eLearning 的 PDF 文件名即可阅读，免 Tampermonkey，自带阅读器，文件仅在浏览器中处理。

## 详细介绍
在复旦 eLearning 的作业页面点击 PDF 文件名，即可在新标签页预览。

- 无需安装 Tampermonkey，也无需复制用户脚本。
- 安装后可直接体验内置示例 PDF，无需学校账号或联网。
- 自带 PDF 阅读器，支持翻页、页码跳转、缩放和选择文字。
- 页面原有下载按钮保留；需要保存时点击阅读器里的“下载 PDF”。
- 文件直接从学校的文件服务器读取，仅在你的浏览器内处理。
- 只在复旦 eLearning 工作，不收集浏览记录、密码或文件内容。

安装后请刷新已经打开的 eLearning 页面。请在当前浏览器登录并使用你有权限访问的课程文件。若曾安装旧版同名用户脚本，请先停用它。本工具与复旦大学或 eLearning 平台无官方关联。

## 权限说明
- 网站访问：仅对复旦 eLearning 注入 PDF 链接处理逻辑，并读取用户点击的文件。
- webRequest：识别文件下载请求中的服务器重定向。无需 webRequestBlocking，不修改请求。
- 可选 HTTPS 网站访问：学校可能使用其他文件服务器，仅在遇到此类服务器且用户主动授权后增加相应域名权限。
- 不需要 tabs、history、cookies、downloads 或 nativeMessaging 权限；不运行远程托管代码。

## 提交步骤
1. 优先使用仓库所有者帐号登录 [Edge Partner Center](https://partner.microsoft.com/dashboard/microsoftedge/public/login)。[微软官方说明](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/create-dev-account)确认 Edge 扩展开发者注册免费；身份信息与帐号验证由所有者本人完成。Chrome 可能要求一次性开发者注册费。
2. Chrome 和 Edge 上传 `dist/fudan-elearning-pdf-preview-chromium-1.1.0.zip`；Firefox 上传 `dist/fudan-elearning-pdf-preview-firefox-1.1.0.zip`，由 Mozilla 签名后才能在正式版持续安装。
3. 填写以上介绍、类别和支持链接，提供隐私声明页面。将 docs/PRIVACY.md 发布到仓库后可用其公开链接作为隐私页。
4. 已准备 `docs/assets/edge-preview.png`（1280 × 800），截图只使用生成的演示 PDF。不要上传真实课程文件、姓名、学号或登录页面。
5. 审核员可从欢迎页点击“先体验示例 PDF”，直接验证阅读器，无需学校帐号。完整操作见 docs/REVIEWER-GUIDE.md，不要共享学生帐号或私人文件。
6. 商店审核通过后，在 README 顶部添加实际商店安装链接，再面向普通用户宣传一键安装。

## 构建可复现性与依赖
运行 `npm ci --ignore-scripts --omit=optional` 后运行 `npm run build`。PDF.js 固定版本与完整性由 package-lock.json 锁定，许可证随包提供。其 worker、字体、CMaps 和 WASM 均随扩展分发，不从远程 CDN 获取执行代码。

## Firefox 自动检查说明

Mozilla 的 web-ext 检查未报告错误。PDF.js 的官方 legacy 构建包含兼容性 polyfill 和本地 worker 导入，检查器会对其中 Function、document.write 和动态 import 产生静态警告。扩展不允许 unsafe-eval，传入 isEvalSupported: false，不启用 PDF JavaScript 脚本执行；worker 指向打包的本地文件，未使用的 QuickJS 资源不分发。提交审核时应提供固定版本的 PDF.js 来源、许可证、锁文件和构建命令。静态警告不等于已经通过 Mozilla 人工审核。
