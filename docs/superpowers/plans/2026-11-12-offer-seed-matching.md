# Offer ↔ 种子词匹配 — 实现计划

> 依据：`docs/superpowers/specs/2026-11-12-offer-seed-matching-design.md`  
> 目标：词库按品类落盘可提交；offer 多选 + 词多选/单选随机一对一分配；复用现有产文写回。

## 总览

| 步骤 | 内容 | 主要文件 |
|------|------|----------|
| 1 | 放宽 ops-center 路径，落种子词库/标签文件 | `opsCenterStore.ts` |
| 2 | 领域类型 + 分配纯函数 + 单测 | `src/domain/offerSeed*.ts` |
| 3 | 本地读写 API + 导入脚本 | `opsCenterLocal` / `opsCenterPlugin` / `tmp/import-seed-lexicon.mjs` |
| 4 | Offer 创编工作台 UI（选 offer/词/预览/打乱） | 新 Vue 面板 + App 入口 |
| 5 | 接通生成与写回（复用现链路） | 面板内调用现有 API/domain |
| 6 | 冒烟验收 | 手工 + 单测 |

---

## Step 1 — ops-center 允许词库/标签路径

**改** `src/server/opsCenterStore.ts`（及对应 test）：

- `assertOpsCenterRelativePath` 增加允许：
  - `seed-lexicon/meta.json`
  - `seed-lexicon/by-category.json`
  - `offer-tags/by-offer.json`
  - 或前缀 `seed-lexicon/`、`offer-tags/`
- 错误文案同步更新

**验收**：单测读写这两个相对路径不抛错；非法路径仍拒绝。

---

## Step 2 — 领域模型与分配算法

**新增** `src/domain/offerSeedLexicon.ts`：

- 类型：`SeedLexiconFile`、`SeedLexiconCategory`、`SeedLexiconItem`、`OfferTagsFile`
- `normalizeSeedLexicon(raw)`：去空、按 categoryKey 合并
- `listSeedsForCategories(lexicon, categoryKeys?)`

**新增** `src/domain/offerSeedAssign.ts`：

```ts
assignSeedsToOffers(offers: { offerId: string }[], seeds: T[], random = Math.random): { offerId: string; seed: T }[]
```

- 打乱 seeds 副本，再 `seeds[i % length]`
- `seeds.length === 0` 或 `offers.length === 0` 抛错/返回空（单测约定：抛错更清晰）

**新增** `src/domain/offerSeedAssign.test.ts`：

- 1 词 n offer → 全同词
- 2 词 5 offer → 仅出现这 2 词且循环
- 8 词 5 offer → 5 条且注入固定 RNG 可断言顺序
- 每 offer 恰好 1 词

**验收**：`npm test`（或项目现有 vitest 命令）相关用例通过。

---

## Step 3 — 落盘读写与导入

**改** `src/server/opsCenterPlugin.ts`：

- GET：`seed-lexicon`、`offer-tags`（读文件，无则返回空结构）
- PUT/POST：写入对应 JSON（body 整文件替换或 merge——第一版 **整文件替换** 更简单）

**改** `src/api/opsCenterLocal.ts`：

- `loadSeedLexicon()` / `saveSeedLexicon()`
- `loadOfferTags()` / `saveOfferTags()`

**新增** `tmp/import-seed-lexicon.mjs`：

- 从现有 xlsx 提取或 JSON 输入，按品类写出 `data/ops-center/seed-lexicon/by-category.json` + `meta.json`
- 用 `tmp/category-id-lookup.json` 填 `categoryId`
- **不写 localStorage**

**初始文件**：提交空壳或一次真实导入样例（至少空 `categories: []`），保证 pull 后路径存在。

**验收**：跑导入脚本后，仓库内出现可 diff 的 JSON；前端 API 能读到。

---

## Step 4 — Offer 创编工作台 UI

**新增** `src/components/OfferSeedWorkbenchPanel.vue`（名称可微调）：

布局（一屏一事，避免堆成仪表盘）：

1. Offer 列表：从本地 ops-center raw/catalog 聚合去重 offer（`offerId` 主键）；支持漏斗筛选、关键词、多选
2. 词库面板：按品类展开；多选种子；显示选中数
3. 分配预览表：`offer → keyword`；按钮「重新打乱」「开始创编」
4. 进度与结果：复用草稿状态展示（可挂到现有 drafts 文件）

**改** `App.vue`（或运营中心入口）：增加「Offer 创编」入口。

打标（轻量）：表格列可选品类写入 `offer-tags/by-offer.json`（批量设品类）。

**验收**：不跑生成也能完成选 offer、选词、预览分配、重新打乱；刷新后词库仍在（来自文件）。

---

## Step 5 — 接通产文与写回

在工作台「开始创编」中：

- 对每条分配调用与 `FunnelBrowsePanel` / `run-funnel-generate` 相同的：建 job → poll → publish → `buildOfferLandingUrl` / 写草稿
- 写回：`replaceLandpulseOfferResultUrl`（resultUrl 整链，url 仅 id+ref）
- 草稿仍写 `funnel-offer-drafts.json`，`funnelId` 作元数据可空或填来源漏斗

尽量抽取共享函数到 `src/domain/` 或小 module，避免复制一整份 Panel 逻辑（第一版允许在面板内编排，但拼链/写回必须复用 domain）。

**验收**：对 1～2 个真实 offer 跑通「分配 → 生成 → 预览链接 → 替换」。

---

## Step 6 — 收尾

- 更新 design spec 状态为「已批准 / 实现中→完成」
- 确认 `.gitignore` **未忽略** `data/ops-center/seed-lexicon/` 与 `offer-tags/`
- 手工过设计文档第 8 节验收项

---

## 不在本计划

- cron / 条件自动换文
- 埋点回写词包
- 按表现动态改品类

---

## 建议执行方式

按 Step 1→6 顺序改；每步可单独提交。  
你确认本计划后，从 **Step 1** 开始落地。

## 进度

- [x] Step 1 路径放行
- [x] Step 2 分配算法 + 单测
- [x] Step 3 API / 导入脚本 / 词库落盘（已导入 13 品类 / 63 词）；`.gitignore` 对 seed-lexicon、offer-tags 开白名单
- [x] Step 4 Offer 创编工作台 UI + 侧栏入口
- [x] Step 5 接通产文与写回（开始创编：create→poll→publish→可选写回）
- [ ] Step 6 总验收

