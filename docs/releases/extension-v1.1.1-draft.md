# 独立扩展 1.1.1 更新草稿

记录日期：2026-09-30。这是更新进度记录，不是正式 Release 或审核通过公告。

## GitHub

- 源码及验证记录已推送 `feature/standalone-extension`，已核对远端提交 `992dd256c6300f3e09e89415c6df9c6404f98443`。
- 未合并 `main`，油猴脚本版继续独立维护。
- 未创建 1.1.1 Release，也未替换 1.1.0 标签或发布附件。

## Edge 后台实际操作与验证

- 原产品更新前显示 1.1.0、Live、Public；仍使用原产品和安装链接。
- 上传 `fudan-elearning-pdf-preview-chromium-1.1.1.zip` 后，后台显示版本 1.1.1、Complete、Your current package has been verified。
- 包语言：English、Chinese (China)。默认权限仍为 `webRequest` 和 `https://elearning.fudan.edu.cn/*`。
- 已分别保存 Chinese (China) 和 English 商店介绍，返回语言列表后两者均显示 Complete。
- 两个条目使用 `icon-128.png` 和仅含生成演示资料的 `edge-preview.png`。英文条目中已核对复制后的图标及截图存在。
- 两个条目分别添加四个搜索词：复旦、Fudan、eLearning、PDF。
- 介绍明确仅支持复旦 PDF、界面为中文、文件上限 100 MiB、需登录和停用重复脚本，并说明精确域名授权与非官方身份。
- 后台 Publish 按钮已可用，但未点击，尚未正式提交审核。

安装包 SHA-256：`92f711f8af41509446ded0e780f830fa1d3dfc94e2266166759b9f9a02112f0f`。本次上传前重新运行 18 项测试、语法检查和包验证，全部通过；浏览器回归和 Firefox 静态检查详见 [验证记录](../VALIDATION.md)。

## 尚待完成

所有者确认正式提交后，检查提交确认页及审核备注，再送审。不能把包验证成功或条目 Complete 当作商店审核通过。正式发布后再复查中文商店搜索；当前并未验证搜索问题已解决。

Firefox 仍仅完成包和审核材料准备，未登录账号、申请签名或提交。
