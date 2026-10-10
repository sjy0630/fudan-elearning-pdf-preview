# 独立扩展版

无需 Tampermonkey，在新标签页使用随扩展打包的阅读器。不要与同名油猴脚本同时启用。

## 普通 Edge 用户

1. 用 Edge 打开[微软商店安装页](https://microsoftedge.microsoft.com/addons/detail/ibgcgppobifaogaodeimafhpmoonioch)，点击“获取”。
2. 停用旧油猴脚本或手动安装的同名扩展。
3. 登录复旦 eLearning，刷新课程页面，点击支持的文件名。

已有同学反馈无需 VPN 即可安装，但不能保证所有网络环境。商店搜索可能暂时找不到，直接使用上述链接；详见[搜索观察](STORE-SEARCH.md)。安装后可打开扩展内置示例 PDF，无需学校账号或网络。

源码为 **1.2.0**：PDF、PNG/JPEG/WebP、文本及代码预览；格式和大小限制见[仓库首页](../README.md)。PDF 支持翻页、页码跳转、缩放、选择文字和原字节下载，扩展版目前不提供阅读器切换。文本不执行，文件不上传第三方。默认权限仅限复旦 eLearning，跨服务器时由用户确认单域授权，详见[隐私说明](PRIVACY.md)。

合并源码不会自动发布商店更新。1.1.1 曾提交 Edge 审核，本轮未查询其当前状态；源码多格式功能不代表商店版已有。已发布 Release 仍为[extension-v1.1.0](https://github.com/sjy0630/fudan-elearning-pdf-preview/releases/tag/extension-v1.1.0)。

## Chrome / Edge 开发安装

下载 Release 中明确标注 Chromium 的 ZIP，解压到长期保留的目录。在 `chrome://extensions` 或 `edge://extensions` 开启开发者模式，选择“加载已解压的扩展”，指向包含 manifest.json 的目录。手动安装不自动更新。GitHub 的 Source code 下载不是构建好的安装包；从源码得到 1.2.0 请按下方步骤构建。

## Firefox

正式长期安装需要 Mozilla 签名；本项目尚未提供签名商店安装入口。开发测试可从 Release 下载 Firefox 未签名 ZIP，解压后在 `about:debugging#/runtime/this-firefox` 临时载入 manifest.json；重启后需重新载入，最低 Firefox 142。不能把这个流程作为普通用户的一键安装。

## 构建与测试

Node.js 22.13.0 或以上，推荐 24：

```sh
npm ci --ignore-scripts
npm test
npm run check
npm run build:extension
npm run verify:packages
npx playwright install chromium
npm run test:browser
npm run test:files
npm run test:firefox
```

构建生成 dist/chromium、dist/firefox、对应 ZIP 和 SHA256SUMS.txt。`npm run build` 同时生成油猴脚本与扩展包。依赖锁定、PDF.js 及资源本地打包，无运行时 CDN。浏览器测试使用隔离配置和合成课程资料；Firefox 测试使用 Selenium 管理的官方浏览器。

GitHub 检查覆盖 Linux Chromium、Windows Edge、Firefox 和跨系统 ZIP 一致性。既有证据及未覆盖的真实课程/商店安装范围见[扩展验证记录](EXTENSION-VALIDATION.md)，不因源码合并而扩大兼容承诺。
