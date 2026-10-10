# Standalone Extension Implementation Plan

**Goal:** 提供无需 Tampermonkey 的可安装扩展及商店提交材料。

**Architecture:** 共用的 URL 识别、安全校验和阅读器，分别生成 Chromium 与 Firefox 清单。阅读器使用打包的 PDF.js，主机权限按需扩展。

**Tech Stack:** WebExtensions MV3、原生 JavaScript、PDF.js、Node 构建、浏览器隔离测试。

- [x] 添加 extension/core.js、content.js、background.js，覆盖下载路径构造、非本站拒绝、消息来源校验和下载按钮保留。
- [x] 添加 extension/viewer.html、viewer.mjs、viewer.css，提供 PDF 渲染、文本选择、翻页缩放、下载、错误和定向授权处理。
- [x] 添加帮助页、隐私说明、商店文案；scripts/build.mjs 打包所有资源、图标和两个安装 ZIP。
- [x] 运行 npm test、npm run check、npm run build 和扩展清单校验；用 Chromium 与真实 Edge 验证阅读器、内容脚本和异常流程。
- [x] 记录实测范围、检查权限与输出包，交付安装路径及需要开发者帐号的商店发布步骤。

商店提交需所有者本人登录开发者帐号；Firefox 运行和真实课程文件验证仍按 docs/VALIDATION.md 跟踪，不宣称已完成。

## 安装可靠性追加迭代

- [x] 用固定版本的纯 JavaScript ZIP 实现替代系统命令，测试根目录结构、字节内容及构建稳定性。
- [x] 添加包资源、权限、校验值及重复构建检查。
- [x] 将已有浏览器手测转为可重复的隔离测试，不访问真实课程或登录页面。
- [x] 在 GitHub Actions 实跑 Linux Chromium / Windows Edge，保留证据并比较跨系统安装包。
- [x] 根据实际结果更新验证记录，继续保留商店发布阻塞说明。

实跑证据：https://github.com/sjy0630/fudan-elearning-pdf-preview/actions/runs/36545334728 。三个任务全部成功；详细范围见 docs/VALIDATION.md。
