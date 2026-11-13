# 文章编排流程说明（可迁移实现）

本文描述 **运营工作台当前「编排」产品流程**：前端怎么拆任务、调哪些接口、如何轮询、如何写入运营配置。  
底层异步产文服务的完整 API 字段见 [`AUTO_ARTICLE_API.md`](./AUTO_ARTICLE_API.md)。

目标：另一个项目可按本文复刻同等闭环，不必依赖本仓库 UI。

---

## 1. 业务目标

一次编排要完成：

1. 按 **品类 × 国家/语言 × 种子词** 批量创建「自动产文任务」
2. 每个任务带上多个 **网站目标**（域名 + site_id + account_id）
3. 任务异步跑完后，每个目标站产出 `article_id`
4. （可选）把落地链接写入对应站的 **运营配置 `recentArticles`**
5. 落地链接必须带：**渠道 ID、文章 ID、ref**

关系模型（创建侧）：

```text
1 个品类
 └─ N 个「国家/语言」块
      └─ M 组「种子词 + ref」（渠道 ID 选填）
 └─ K 个网站（账户 + 域名）
 └─ 每域名篇数 P（1～10）

实际创建任务数 = N × M
（每个任务 = 1 个种子词 + 1 个语言/国家；K 个站都放进该任务的 targets）
期望文章数 ≈ (N×M) × K × P
```

列表展示侧（与创建粒度不同）：

```text
一级：类目 · 账户 · 网站
 └─ 二级：国家
      └─ 文章行：域名 / 账户 / 渠道 ID / 链接
写入按钮在「一级」：一次写入该组下全部待写文章
```

---

## 2. 依赖的三套后端

| 用途 | 基址（本仓库代理） | 鉴权 |
|------|-------------------|------|
| 创作平台：账户/站点/品类/语言/运营配置 | `/article-api` → `VITE_ARTICLE_API_TARGET` | `Authorization: Bearer <VITE_ARTICLE_TOKEN>`（或项目既有文章 token） |
| 自动编排 Agent | `/article-agent-api` → `VITE_ARTICLE_AGENT_TARGET`（默认 `https://adesmobi.com`） | `X-Platform-Token: <同一平台 JWT>` |
| MIS：新建广告渠道 | `/mis-api` → `VITE_MIS_API_TARGET` | `Authorization: Bearer <VITE_MIS_TOKEN>` + `ClientID` |

环境变量参考：

```env
VITE_ARTICLE_API_TARGET=...
VITE_ARTICLE_TOKEN=...
VITE_ARTICLE_AGENT_TARGET=https://adesmobi.com
VITE_MIS_API_TARGET=...
VITE_MIS_TOKEN=...
VITE_MIS_CLIENT_ID=...
```

---

## 3. 元数据接口（创建表单用）

全部走创作平台：

| 步骤 | 方法 | 路径 | 用途 |
|------|------|------|------|
| 账户列表 | GET | `/account/getAll` | 选账户 |
| 站点列表 | GET | `/site/getAll` | 按 `accountId` 筛域名；取 `id / siteName / siteUrl / accountId / isPass` |
| 语言列表 | GET | `/lang/getAll` | `id / langCode / langName` |
| 品类树 | GET | `/article/allCategoryNew` | `id / name / alias / parentId`，前端拼 cascader，**任意一级可选** |
| 运营配置详情 | GET | `/operationConfig/detail?site=<domain>` 或 `?id=` | 写入前读 `recentArticles`、`accountId` |
| 更新运营配置 | POST | `/operationConfig/update` | 追加推荐链接 |
| 文章详情 | POST | `/article/detail` | `{ id }`；补国家码（可选） |

国家/地区：本仓库前端本地枚举（如 US/JP/GB…），不是远程字典。

账户名 → AFS `source` 规则（写入 MIS / 拼渠道时用）：

- 账户名匹配 `A(\d+)` 或 `AFS(\d+)` → `source = 该数字`
- 例：`A3` / `AFS3` → `source=3`

---

## 4. 自动编排任务 API（核心）

### 4.1 创建

`POST {AGENT}/api/v1/admin/article-jobs`

Headers:

```http
Content-Type: application/json
X-Platform-Token: <PLATFORM_JWT>
Idempotency-Key: <调用方唯一键，建议每任务一个>
```

Body（本工作台实际发送）：

```json
{
  "intent_keyword": "种子词",
  "category_id": 123,
  "language_id": 1,
  "region_id": "US",
  "user": {
    "user_id": "从 JWT 解析的 userId",
    "user_name": "从 JWT 解析的 username/sub"
  },
  "targets": [
    { "domain": "example.com", "site_id": 10, "account_id": 3 }
  ],
  "mode": "auto",
  "callback_url": null,
  "options": {
    "out_show": false,
    "generate_author": true,
    "publish": true,
    "articles_per_domain": 1
  }
}
```

约束（前端校验）：

- `targets`：1～20
- `articles_per_domain`：1～10
- 单次创建任务数建议上限 60（= 国家块×每块种子词组）
- **ref ≠ 种子词**（大小写不敏感也禁止相同）；ref 写入落地链接，种子词只给产文
- 渠道 ID **选填**：只存在前端本地任务记录里，**创建 Agent 任务时不传渠道**；写入链接时才用

响应：任务详情（至少含 `task_id`、`status`；可能已有 `progress` / `results`）。

### 4.2 查询 / 轮询

`GET {AGENT}/api/v1/admin/article-jobs/{task_id}`

Header：`X-Platform-Token`

建议：仅对未终态任务轮询，间隔约 **7s**。

终态：`success` | `partial_success` | `failed`  
非终态：`queued` | `planning` | `running` | …

进度字段示例：

```json
{
  "total": 4,
  "completed": 2,
  "success": 2,
  "failed": 0,
  "running": 2
}
```

结果项（每个站/篇）：

```json
{
  "id": "...",
  "domain": "example.com",
  "site_id": 10,
  "account_id": 3,
  "article_number": 1,
  "status": "success",
  "article_id": 98765,
  "error_code": null,
  "error_message": null
}
```

可写入条件：`status === 'success'` 且 `article_id` 非空。

---

## 5. 前端创建流程（逐步）

```text
[用户打开「创建任务」抽屉]
  1. 选品类 category_id
  2. 添加 N 个国家/语言块；每块下添加 M 组：种子词 + ref + 可选渠道
  3. 选账户 → 多选域名 → 加入 targets（可多账户分批加）
  4. 选每域名篇数 P、是否 publish、是否「生成后自动写入」
  5. 点击创建
       → 展开 taskPlans = 每个（国家块 × 种子词组）一条
       → 对每个 plan 调 POST article-jobs（同一批 targets、同一 category）
       → 本地持久化任务：taskId、intentKeyword、refKeyword、channelId、
         categoryId、languageId、regionId、targets、status、results…
       → 成功后关抽屉；列表立即按 targets 占位展示（尚无 results 也显示）
```

本地任务建议字段（本仓库 `StoredArticleJob`）：

| 字段 | 说明 |
|------|------|
| taskId | Agent 返回 |
| intentKeyword | 种子词 |
| refKeyword | 落地 ref（可与种子词不同） |
| channelId | 选填；写入优先用 |
| categoryId / languageId / regionId | |
| targets[] | 创建时快照，供列表占位 |
| status / progress / results | 轮询更新 |
| publish / articlesPerDomain | |

本仓库用 `localStorage` 存最近 50 条；新项目可用 DB。

---

## 6. 任务列表展示规则

不要按「一个 Agent 任务一行」展示，而按业务树：

1. 遍历本地 jobs  
2. 若已有 `results`：用 results；否则用 `targets` 生成占位行（pending）  
3. 分组键：`categoryId + accountId + domain`  
4. 组内再按 `regionId`（国家）分子组  
5. 文章行展示：域名、账户名、渠道 ID、链接  
6. 一级操作：**写入**（组内所有可写且未写文章）、**移除**（删掉该组关联的全部 taskId）

链接来源：

- 已写入：记住落地 URL  
- 未写入但已知渠道 + article_id：可预览拼链  
- 仍在生成：显示「生成中」

---

## 7. 写入运营配置流程

对单个成功结果（文章）：

```text
1. domain = result.domain
2. GET /operationConfig/detail?site={domain}
3. 解析 recentArticles → 已有 URL 列表
4. 若已有相同 article_id → 标记已写入，跳过
5. 解析已有链接的 channel + 国家（国家优先来自配置项；缺则查文章详情）
6. 解析落地 URL（resolveLandingUrl）：
     a. 若任务上有 preferred channelId → 直接拼链
     b. 否则同国家已有链接可复用 channel → 拼链
     c. 否则 MIS POST /funnel/campaign/add 新建渠道 → 用返回 URL 取 channel 再拼标准落地链
7. 把新 URL append 进 recentArticles
8. POST /operationConfig/update
```

### 7.1 落地 URL 格式

直拼（已有渠道时）：

```text
https://{domain}/detail/{articleId}
  ?subid1={channel}
  &subid2={articleId}
  &channel={channel}
  &rType=2
  &ref={refKeyword}
```

`ref` 用任务的 **refKeyword**，不是种子词。

### 7.2 MIS 新建渠道

`POST /funnel/campaign/add`  
鉴权：MIS Bearer + ClientID  

Payload 要点（本仓库）：

```json
{
  "source": "<AFS source，来自账户名>",
  "articleId": "<articleId>",
  "siteName": "<domain>",
  "investTitle": "<ref>",
  "investChannel": "TikTok",
  "rType": 2,
  "singleChannelMode": false,
  "subid2": "<articleId>",
  "subid3": "{data-campaign}",
  "subid4": "{data-campaign_name}",
  "subid5": "{data-adgroup_id}",
  "subid6": "{data-creative_id}",
  "subid7": "{data-account_id}"
}
```

返回一条 http(s) URL，从中解析 `channel` 参数后再规范化落地链。

### 7.3 组级写入 / 自动写入

- **组级写入**：一级按钮，顺序写入该「类目·账户·网站」下所有 `writable && !written` 的结果  
- **自动写入**：创建时勾选；轮询发现可写结果后自动逐条写入；需本地记录已写 key，避免重复

可写 key 建议：`{taskId}:{result.id 或 domain-article_number}`

---

## 8. 端到端时序

```text
用户配置抽屉
    │
    ▼
对每个（国家×种子词） ──POST──► Agent article-jobs
    │                              │
    │◄──── task_id / status ───────┘
    │ 本地存 job + targets
    ▼
列表：类目·账户·网站 → 国家 → 占位/文章
    │
    │ 每 7s GET article-jobs/{id}（未终态）
    ▼
results 出现 article_id
    │
    ├─ 手动：点一级「写入」
    └─ 或自动写入
         │
         ▼
      拼/建渠道链接 → update 运营配置 recentArticles
```

---

## 9. 新项目最小实现清单

1. **配置**：三套 baseURL + token  
2. **表单**：品类、国家/语言块、种子词/ref/渠道、网站 targets、篇数、publish、autoWrite  
3. **创建循环**：笛卡尔积拆任务 + Idempotency-Key  
4. **本地/服务端任务表**：含 targets、ref、channel  
5. **轮询器**：终态停止  
6. **树形列表** + 组写入  
7. **resolveLandingUrl** 三分支 + MIS add + 运营配置 update  
8. **幂等**：同 article_id 不重复写入；已写 key 持久化  

可选：不实现 UI 抽屉，用脚本/API 批量创建亦可；写入逻辑仍建议独立成模块。

---

## 10. 本仓库代码索引

| 模块 | 路径 |
|------|------|
| 编排 UI / 创建 / 轮询 / 写入 | `src/components/AutoArticlePanel.vue` |
| Agent API | `src/api/articleJobs.ts` |
| 创作平台 API | `src/api/article.ts` |
| MIS 建渠道 | `src/api/mis.ts` |
| 落地链解析 | `src/domain/autoArticleWrite.ts` |
| URL 拼装 | `src/domain/campaignForm.ts` |
| 本地任务模型 | `src/domain/articleJobStore.ts` |
| 列表分组 | `src/domain/articleJobGroups.ts` |
| 品类树 | `src/domain/articleCategories.ts` |
| Agent 接口详解 | `docs/superpowers/specs/AUTO_ARTICLE_API.md` |
| 产文 options | `docs/superpowers/specs/AUTO_ARTICLE_OPTIONS.md` |

---

## 11. 与「配置 / 回收」的边界

- **编排**：批量产文 +（可选）写入多站；**不依赖**左侧当前选中站  
- **配置**：单站运营配置维护、日报  
- **回收**：选中站后，用站上渠道拉 `afsData` 看各国收入（另一条链路，不在本文）
