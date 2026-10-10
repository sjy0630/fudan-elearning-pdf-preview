# 商店提交材料

状态（2026-09-30）：Edge 已上架 1.1.0，[实际安装页](https://microsoftedge.microsoft.com/addons/detail/ibgcgppobifaogaodeimafhpmoonioch)。1.1.1 源码已推送扩展分支，安装包已通过 Edge 后台包验证，Chinese (China) 与 English 条目均已保存为 Complete；尚未点击 Publish 或提交审核。Chrome Web Store 与 Firefox Add-ons 尚未上架；公开 GitHub Release 仍是 1.1.0。不要将候选 ZIP 称为商店签名包。详见[更新草稿记录](releases/extension-v1.1.1-draft.md)。

以下两套文案可分别粘贴到商店对应语言字段。包内 `_locales/zh_CN` 与 `_locales/en` 只提供扩展元数据；商店 zh-CN / en-US 页面须由所有者在后台单独添加和保存，不会自动随包设置，也不保证修复搜索结果。扩展阅读器和帮助界面仍为中文。

实际上传 1.1.1 后，后台根据包生成了 **Chinese (China)** 和 **English** 两个待填写条目；下方英文文案已用于 English 条目。线上 1.1.0 原有的 English (United States) 与新草稿的 English 标签需区分。包内语言会影响后台候选条目，但不会替代描述、图标等内容的填写和保存。

## zh-CN

名称：复旦 eLearning PDF 预览

简短介绍：点击复旦 eLearning 的 PDF 文件名即可阅读，免 Tampermonkey，自带阅读器，文件仅在浏览器中处理。

详细介绍：

在复旦（Fudan）eLearning 的作业页面点击 PDF 文件名，即可在新标签页打开内置阅读器。

- 无需安装 Tampermonkey 或复制用户脚本。
- 内置示例 PDF，无需学校账号或联网即可体验。
- 支持翻页、页码跳转、缩放、适合宽度、选择文字和主动下载。
- 保留页面原有下载按钮；预览不会主动保存文件到下载目录。
- PDF 直接从学校或学校指定的文件服务器读取，在浏览器内处理，不上传到第三方预览服务。
- 当前支持复旦 eLearning 的 PDF，不宣称支持其他学校或 Office 文件。阅读器界面为中文。

安装后请在当前浏览器登录 eLearning，刷新已打开的课程页面；停用重复的同名用户脚本或手动测试版。只使用你有权限访问的文件。上限为 100 MiB；扫描 PDF 没有文字层时不能直接选择文字。本项目与复旦大学或 eLearning 平台无官方关联。

权限说明：默认仅访问 `https://elearning.fudan.edu.cn/*`；`webRequest` 用于识别文件重定向，不修改请求。若学校使用其他 HTTPS 文件服务器，仅在显示目标域名并由用户主动授权后添加该域名权限。无需 tabs、history、cookies、downloads 或 nativeMessaging 权限。没有统计代码，不收集浏览记录、密码或文件内容；不运行远程托管代码。

搜索关键词（仅填入商店提供的关键词字段）：复旦、Fudan、eLearning、PDF。

## en-US

Name: Fudan eLearning PDF Preview

Short description: Preview Fudan eLearning PDFs in your browser with a bundled reader. No Tampermonkey or third-party document uploads.

Detailed description:

Click a PDF filename on a Fudan (复旦) eLearning assignment page to open it in a new tab with the bundled reader.

- No Tampermonkey installation or userscript copying required.
- Try the bundled sample PDF without a school account or an internet connection.
- Turn pages, jump to a page, zoom, fit width, select text, and download when you choose.
- Original download buttons remain available. Previewing does not automatically save the file to your downloads folder.
- PDFs are read directly from the school or its designated file servers and processed in your browser, without uploading documents to third-party preview services.
- Currently supports PDFs on Fudan eLearning. Other schools and Office documents are not supported. The reader and help interface are in Chinese.

After installation, sign in to eLearning in the same browser and refresh open course pages. Disable duplicate userscripts or manually loaded test versions. Use only files you are authorized to access. The file limit is 100 MiB; scanned PDFs without a text layer do not support text selection. This project is not affiliated with Fudan University or the eLearning platform.

Permissions: Default website access is limited to `https://elearning.fudan.edu.cn/*`. The `webRequest` permission identifies file redirects without modifying requests. If the school uses another HTTPS file server, the reader displays its domain and requests access only after the user chooses to authorize it. No tabs, history, cookies, downloads, or nativeMessaging permission is required. No analytics or collection of browsing history, passwords, or file contents. No remotely hosted executable code.

Search keywords (only where the store provides a keyword field): Fudan, 复旦, eLearning, PDF.

## 共用链接与提交材料

- 隐私页 / Privacy: https://github.com/sjy0630/fudan-elearning-pdf-preview/blob/feature/standalone-extension/docs/PRIVACY.md
- 支持 / Support: https://github.com/sjy0630/fudan-elearning-pdf-preview/issues
- 源码 / Source: https://github.com/sjy0630/fudan-elearning-pdf-preview/tree/feature/standalone-extension
- 截图：`docs/assets/edge-preview.png`（1280 × 800），仅含生成的示例 PDF。
- 当前本地候选：`dist/fudan-elearning-pdf-preview-chromium-1.1.1.zip`；Firefox 见 [提交清单](FIREFOX-SUBMISSION.md)。
- 审核员无需学校账号即可从欢迎页打开示例；详见 [审核员指南](REVIEWER-GUIDE.md)。不要共享学生账号或私人文件。

后续经所有者授权已上传安装包、填写并保存中英文描述、图标、演示截图及四个搜索词（复旦、Fudan、eLearning、PDF）。本轮没有接受新协议或正式提交审核；最终提交仍需所有者确认。

PDF.js 固定为 6.3.289，来源、许可证和构建说明见 Firefox 提交清单。历史 web-ext 静态检查曾无错误，但其警告及结果必须结合具体包和检查器版本阅读；这不是当前候选的自动通过声明，更不是 Mozilla 人工审核批准。
