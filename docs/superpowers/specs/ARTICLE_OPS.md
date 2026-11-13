# 新站文章流程（一份说明 + 一个脚本）

脚本：`docs/scripts/setup-articles.mjs`  
打开文件改顶部 `CONFIG`，然后按步骤跑。接口细节见 [`AUTO_ARTICLE_API.md`](./AUTO_ARTICLE_API.md)、[`AUTO_ARTICLE_OPTIONS.md`](./AUTO_ARTICLE_OPTIONS.md)。

## 流程

1. **运营后台建站点** → 拿到 `domain` / `site_id`
2. **改 `CONFIG`**：`domain`、`siteId`、`categories`、`jobs`（种子词）
3. **建类目**
   ```powershell
   $env:ARTICLE_ADMIN_TOKEN = '<ADMIN_JWT>'
   node .\docs\scripts\setup-articles.mjs --categories
   ```
4. **把返回/后台里的类目 id 填进 `CONFIG.jobs[].cat`**
5. **建文章任务**（一词一任务，`n` = 每域篇数，1～10）
   ```powershell
   $env:ARTICLE_PLATFORM_TOKEN = '<PLATFORM_JWT>'
   node .\docs\scripts\setup-articles.mjs --jobs
   ```
6. **运营 tag**：每个前台 pill 绑对应 `categoryId`
7. **跑 `generate-static-data`**，首页/Blog 就能拉到文章

一次跑两类：`node .\docs\scripts\setup-articles.mjs --all`（仍需先有正确的 `jobs[].cat`）。

## 种子词原则

关键词要绑到站点主题/工具（例如四色人格要写 `red/yellow/green/blue`），泛词生成的内容会跑偏。

## 安全

JWT **不要提交进 git**。  
类目用 `Authorization: Bearer`（admin）；文章任务用 `X-Platform-Token`（platform）。
