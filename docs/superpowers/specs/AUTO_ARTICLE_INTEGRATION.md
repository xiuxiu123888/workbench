# 自动编排文章 API 接入文档

## 1. 功能说明

调用方提交一个意向关键词和一组发布目标，Article Agent 异步执行：

```text
关键词研究 → 差异化方向规划 → 大纲 → 正文 → 配图 → 发布
```

默认一个目标域名生成一篇文章，可通过 `options.articles_per_domain` 调整为每个域名 1～10 篇。任务创建成功只表示已进入队列，调用方需要通过查询接口获取最终结果。

## 2. 服务地址

局域网测试环境：

```text
Article Agent API：http://192.168.112.129:8002
创作平台 API：https://adesmobi.com/admin/back
```

正式环境部署后，只需替换 Article Agent API 地址，接口路径保持不变。

## 3. 完整接入流程

```text
创作平台账号密码
        ↓
调用创作平台登录接口
        ↓
获取用户自己的 Platform Token
        ↓
携带 API Key + Platform Token 创建编排任务
        ↓
保存 task_id
        ↓
轮询任务详情
        ↓
读取每个域名的 article_id / error_message
```

## 4. 鉴权凭证

| 凭证 | 请求头 | 用途 |
|---|---|---|
| Article Agent API Key | `X-API-Key` | 验证调用方有权使用自动编排 API |
| 创作平台 Token | `X-Platform-Token` | 确定文章发布使用的创作平台用户身份 |
| 幂等键 | `Idempotency-Key` | 防止重复创建和重复发布 |

注意：

- API Key 由 Article Agent 管理员通过安全渠道交付，不要写入浏览器公开代码。
- Platform Token 必须属于当前调用用户，不能使用固定管理员 Token。
- Token 过期后应重新登录获取，并在重试任务时提交新 Token。
- `Idempotency-Key` 在同一次业务请求重试时必须保持不变；新任务必须使用新值。

推荐调用结构：

```text
用户浏览器 ──登录──> 创作平台
     │                 │
     └── Platform Token┘
              ↓
        调用方自己的后端
              ↓ 携带服务端保存的 API Key
        Article Agent API
```

不要从公开网页 JavaScript 直接调用 Article Agent API，否则 `AUTO_JOBS_API_KEY` 会暴露给所有访问者。

## 5. 使用账号密码获取创作平台 Token

### 5.1 请求

```http
POST https://adesmobi.com/admin/back/auth/login
Content-Type: application/json
```

```json
{
  "username": "user@example.com",
  "password": "用户密码"
}
```

curl 示例：

```bash
curl --request POST 'https://adesmobi.com/admin/back/auth/login' \
  --header 'Content-Type: application/json' \
  --data-raw '{
    "username": "user@example.com",
    "password": "用户密码"
  }'
```

### 5.2 响应

不同版本的创作平台响应可能直接返回用户数据，也可能包装在 `data` 中。调用方应兼容以下两种结构。

结构一：

```json
{
  "token": "eyJ...",
  "username": "user@example.com",
  "roles": ["user"],
  "userId": 20
}
```

结构二：

```json
{
  "code": 200,
  "msg": "操作成功",
  "data": {
    "token": "eyJ...",
    "username": "user@example.com",
    "roles": ["user"],
    "userId": 20
  }
}
```

取值逻辑：

```javascript
const result = response.data ?? response
const platformToken = result.token
const userId = String(result.userId)
const userName = result.username
```

禁止记录密码和完整 Token。浏览器调用时，账号密码直接通过 HTTPS 发送到创作平台，不应经过 Article Agent 后端。

### 5.3 创建任务前获取可选数据

创建任务前，调用方应使用当前用户的 Platform Token 获取品类、语言、账号和站点。不要在代码中长期写死这些 ID，也不要让用户手工填写域名。

所有创作平台查询接口都使用：

```http
Authorization: Bearer <创作平台 Token>
```

#### 获取语言

```http
GET https://adesmobi.com/admin/back/lang/getAll
```

```bash
curl 'https://adesmobi.com/admin/back/lang/getAll' \
  --header 'Authorization: Bearer eyJ...'
```

响应中的 `data` 是语言数组，创建任务时使用所选语言的 `id` 作为 `language_id`：

```json
{
  "code": 200,
  "data": [
    {"id": 1, "langCode": "en", "langName": "English"}
  ]
}
```

语言列表以接口实时返回为准，不要根据语言名称猜测 ID。

#### 获取品类

```http
GET https://adesmobi.com/admin/back/article/allCategoryNew
```

```bash
curl 'https://adesmobi.com/admin/back/article/allCategoryNew' \
  --header 'Authorization: Bearer eyJ...'
```

常用字段：

```json
{
  "id": 10,
  "name": "厨房用品",
  "alias": "kitchenware",
  "parentId": 9
}
```

- 创建任务时使用所选品类的 `id` 作为 `category_id`。
- `parentId` 用于构建品类树。
- 品类可不选；不选时传 `0` 或省略 `category_id`，由编排器根据关键词推断。

#### 获取账号

```http
GET https://adesmobi.com/admin/back/account/getAll
```

```bash
curl 'https://adesmobi.com/admin/back/account/getAll' \
  --header 'Authorization: Bearer eyJ...'
```

创建任务时使用账号对象的：

| 返回字段 | 任务字段 |
|---|---|
| `id` | `targets[].account_id` |
| `name` | 仅用于界面展示，不提交也可以 |

账号列表受当前 Platform Token 权限约束。不同用户的可选账号可能不同，不能跨用户复用缓存结果。

#### 获取站点和域名

```http
GET https://adesmobi.com/admin/back/site/getAll
```

```bash
curl 'https://adesmobi.com/admin/back/site/getAll' \
  --header 'Authorization: Bearer eyJ...'
```

常用字段：

```json
{
  "id": 101,
  "siteName": "https://example.com/",
  "accountId": 11,
  "isPass": true
}
```

字段映射：

| 站点返回字段 | 任务字段 | 处理规则 |
|---|---|---|
| `id` | `targets[].site_id` | 必须使用真实站点 ID |
| `siteName` | `targets[].domain` | 去掉协议、路径和首尾 `/` 后提交 |
| `accountId` | `targets[].account_id` | 必须与所选账号匹配 |
| `isPass` | 是否允许选择 | 只选择审核通过的站点 |

正确选择流程：

```text
加载当前用户账号
        ↓
用户选择账号
        ↓
按 site.accountId 过滤该账号下的站点
        ↓
仅展示 isPass=true 的站点
        ↓
用户选择站点
        ↓
site.id → site_id
account.id → account_id
规范化后的 site.siteName → domain
```

域名规范化示例：

```text
https://Example.com/             → example.com
http://example.com/path/         → example.com
example.com/                     → example.com
```

注意：

- `domain` 必须是裸域名，不能包含协议、路径、查询参数或端口。
- 不允许用户输入一个不在站点列表中的域名。
- 同一任务可以选择多个站点；每个站点生成一篇文章。
- 同一任务中 `(domain, site_id, account_id)` 组合不能重复。
- 账号和站点候选应随当前登录用户重新加载，避免发布到其他用户的账号。

#### 地区选项

`region_id` 使用 Article Agent 约定的地区代码，不是数据库 ID。当前支持：

```text
US 美国        GB 英国          CN 中国          TW 中国台湾
HK 中国香港    MO 中国澳门      AU 澳大利亚      CA 加拿大
DE 德国        FR 法国          IT 意大利        ES 西班牙
JP 日本        KR 韩国          IN 印度          BR 巴西
MX 墨西哥      RU 俄罗斯        ID 印度尼西亚    SG 新加坡
NL 荷兰        SE 瑞典          CH 瑞士          AE 阿联酋
PL 波兰        BE 比利时        AT 奥地利        NO 挪威
DK 丹麦        FI 芬兰          IE 爱尔兰        NZ 新西兰
PT 葡萄牙      GR 希腊          HU 匈牙利        CZ 捷克
RO 罗马尼亚    IL 以色列        ZA 南非          TH 泰国
MY 马来西亚    PH 菲律宾        VI 越南          TR 土耳其
NG 尼日利亚    SA 沙特阿拉伯    AR 阿根廷        CL 智利
CO 哥伦比亚    PE 秘鲁          VE 委内瑞拉      EC 厄瓜多尔
BO 玻利维亚    PY 巴拉圭        UY 乌拉圭        GT 危地马拉
HN 洪都拉斯    SV 萨尔瓦多      NI 尼加拉瓜      CR 哥斯达黎加
PA 巴拿马      CU 古巴          DO 多米尼加      HT 海地
JM 牙买加      TT 特立尼达和多巴哥  BS 巴哈马    BB 巴巴多斯
GY 圭亚那      SR 苏里南        BZ 伯利兹        IR 伊朗
IQ 伊拉克      KW 科威特        QA 卡塔尔        BH 巴林
OM 阿曼        JO 约旦          LB 黎巴嫩        SY 叙利亚
YE 也门        EG 埃及          PS 巴勒斯坦
```

特别注意：当前系统使用 `VI` 表示越南，不是常见的 `VN`。调用方应严格使用上述代码。

地区和语言是两个独立字段。例如：

```text
地区 US + English
地区 CA + English
地区 CA + Français
地区 SG + English
```

调用方应让用户分别选择地区和语言，不要仅根据地区自动推断语言。

## 6. 创建自动编排任务

### 6.1 请求

```http
POST /api/v1/article-jobs
X-API-Key: <AUTO_JOBS_API_KEY>
X-Platform-Token: <创作平台 Token>
Idempotency-Key: <调用方唯一业务键>
Content-Type: application/json
```

完整示例：

```bash
curl --request POST \
  'http://192.168.112.129:8002/api/v1/article-jobs' \
  --header 'X-API-Key: your-auto-jobs-api-key' \
  --header 'X-Platform-Token: eyJ...' \
  --header 'Idempotency-Key: order-20260820-0001' \
  --header 'Content-Type: application/json' \
  --data-raw '{
    "intent_keyword": "dental implants",
    "category_id": 0,
    "language_id": 1,
    "region_id": "US",
    "user": {
      "user_id": "20",
      "user_name": "user@example.com"
    },
    "targets": [
      {
        "domain": "example.com",
        "site_id": 101,
        "account_id": 11
      },
      {
        "domain": "example-health.com",
        "site_id": 102,
        "account_id": 11
      }
    ],
    "mode": "auto",
    "callback_url": null,
    "options": {
      "publish": false,
      "out_show": false,
      "generate_author": true,
      "articles_per_domain": 1,
      "outline": { "enabled": false },
      "thinking": { "enabled": false },
      "tags": { "enabled": false }
    }
  }'
```

### 6.2 请求字段

| 字段 | 必填 | 类型 | 说明 |
|---|---:|---|---|
| `intent_keyword` | 是 | string | 意向关键词，1～300 个字符 |
| `category_id` | 否 | integer | 品类 ID；默认 `0`，由编排器推断 |
| `language_id` | 是 | integer | 语言 ID，必须大于 0 |
| `region_id` | 是 | string | 地区代码，例如 `US` |
| `user.user_id` | 是 | string | 创作平台用户 ID |
| `user.user_name` | 否 | string | 创作平台用户名 |
| `targets` | 是 | array | 发布目标，至少 1 个，默认最多 20 个 |
| `targets[].domain` | 是 | string | 裸域名，例如 `example.com`，不要带路径 |
| `targets[].site_id` | 是 | integer | 创作平台站点 ID，必须大于 0 |
| `targets[].account_id` | 是 | integer | 创作平台账号 ID，必须大于 0 |
| `mode` | 否 | string | 固定为 `auto` |
| `callback_url` | 否 | URL/null | 当前版本暂不发送回调，建议传 `null` |
| `options.publish` | 否 | boolean | 是否发布到文章中心；默认 `true`，测试建议先使用 `false` |
| `options.out_show` | 否 | boolean | 发布后是否外显，默认 `false` |
| `options.generate_author` | 否 | boolean | 是否生成本地化作者名，默认 `false` |
| `options.articles_per_domain` | 否 | integer | 每个域名生成几篇独立文章，默认 `1`，范围 `1～10` |
| `options.outline.enabled` | 否 | boolean | 是否先生成文章大纲，默认 `false`（关闭时直接写作，更快） |
| `options.thinking.enabled` | 否 | boolean | 是否启用深度思考，默认 `false`（复杂选题可开启） |
| `options.tags.enabled` | 否 | boolean | 发布成功后由 AI 自动添加 3～5 个标签，默认 `false`；必须与 `publish=true` 同时使用 |
| `options.topic_research.query_count` | 否 | integer | 选题阶段 Tavily 查询数，默认 `3`，范围 `2～3` |

同一个请求内不允许出现完全相同的 `domain + site_id + account_id`。

Article Agent 前端「生成设置」面板上的开关与上述字段一一对应：

| 界面名称 | 请求字段 |
|---|---|
| 每个域名生成文章数 | `options.articles_per_domain` |
| 生成文章大纲 | `options.outline.enabled` |
| 深度思考 | `options.thinking.enabled` |
| 生成作者名称 | `options.generate_author` |
| 自动添加标签 | `options.tags.enabled` |
| 发布到平台 | `options.publish` |
| 结果回调 / 回调地址 | `callback_url`（顶层字段，不在 `options` 内） |

除上述开关外，`options` 还支持按需配置文章内容：`title`、`overview`、`body`、`keywords`、`seo`、`image`、`source`。这些配置项完整清单、默认值和组合示例见 [`backend/AUTO_ARTICLE_OPTIONS.md`](../backend/AUTO_ARTICLE_OPTIONS.md)。

规则：`options` 整体可选，未传的字段使用后端默认值引导生成；只有显式传入的长度、年份、正文元素等限制才作为成品硬校验条件。例如未传 `options.seo.description_max_length` 时，SEO 描述超过默认 160 字符不会导致整篇文章失败。

### 6.3 创建响应

成功返回 `HTTP 202 Accepted`：

```json
{
  "task_id": "job_3f2a123456",
  "status": "queued",
  "mode": "auto",
  "intent_keyword": "dental implants",
  "category_id": 0,
  "language_id": 1,
  "region_id": "US",
  "user": {
    "user_id": "20",
    "user_name": "user@example.com"
  },
  "callback_url": null,
  "options": {
    "title": { "max_length": 70, "include_year": true },
    "overview": { "min_length": 0, "max_length": 150 },
    "body": { "target_length": 2000, "min_length": 1500, "include_cta": true, "include_headings": true, "include_tables": true, "include_lists": true },
    "keywords": { "mode": "auto", "values": [], "min_count": 5, "max_count": 10, "include_in_title": true, "include_in_overview": true, "include_in_headings": true, "include_in_body": true, "include_in_seo": true },
    "seo": { "enabled": true, "title_max_length": 60, "description_max_length": 160 },
    "image": { "enabled": true },
    "source": { "show_in_article": false },
    "thinking": { "enabled": false },
    "outline": { "enabled": false },
    "topic_research": { "provider": "tavily", "query_count": 3 },
    "tags": { "enabled": false },
    "articles_per_domain": 1,
    "out_show": false,
    "generate_author": true,
    "publish": false
  },
  "progress": {
    "total": 2,
    "completed": 0,
    "success": 0,
    "failed": 0,
    "running": 0
  },
  "usage": {
    "tavily_calls": 0,
    "planning_tavily_calls": 0
  },
  "results": [
    {
      "id": 1,
      "domain": "example.com",
      "article_number": 1,
      "site_id": 101,
      "account_id": 11,
      "status": "pending",
      "article_id": null,
      "conversation_id": null,
      "direction": null,
      "attempts": 0,
      "tavily_calls": 0,
      "author_name": null,
      "selected_tags": [],
      "tag_results": [],
      "error_code": null,
      "error_message": null
    }
  ],
  "error_message": null,
  "created_at": "2026-08-20T08:00:00+00:00",
  "started_at": null,
  "completed_at": null
}
```

调用方必须保存 `task_id`。

`results` 是子任务列表，长度等于 `targets.length × options.articles_per_domain`，`progress.total` 与之一致。同一域名生成多篇时用 `domain + article_number` 区分；`options` 是后端补齐默认值后的实际配置，可直接回读确认。

## 7. 查询任务

### 7.1 请求

```http
GET /api/v1/article-jobs/{task_id}
X-API-Key: <AUTO_JOBS_API_KEY>
```

```bash
curl \
  'http://192.168.112.129:8002/api/v1/article-jobs/job_3f2a123456' \
  --header 'X-API-Key: your-auto-jobs-api-key'
```

查询接口不需要重复传 Platform Token。

### 7.2 任务状态

```text
queued → planning → running → success
                          ├→ partial_success
                          └→ failed
```

| 状态 | 说明 |
|---|---|
| `queued` | 已进入队列，等待 Worker |
| `planning` | 正在研究关键词和规划差异化方向 |
| `running` | 正在生成、配图或发布文章 |
| `success` | 所有目标均成功 |
| `partial_success` | 部分目标成功，部分失败 |
| `failed` | 所有目标失败，或任务规划失败 |

子任务状态：

```text
pending → researching → outlining → writing → imaging → publishing → success / failed
```

建议每 5～10 秒查询一次。任务进入 `success`、`partial_success` 或 `failed` 后停止轮询。

### 7.3 读取结果

发布成功：

```json
{
  "domain": "example.com",
  "status": "success",
  "article_id": 123456,
  "conversation_id": 89,
  "error_code": null,
  "error_message": null
}
```

只生成草稿时，`status` 仍为 `success`，但 `article_id` 为 `null`，可通过 Article Agent 前端查看草稿。

失败结果：

```json
{
  "domain": "example.com",
  "status": "failed",
  "article_id": null,
  "error_code": "LLM_TIMEOUT",
  "error_message": "LLM content request exceeded 120 seconds"
}
```

## 8. 重试失败项

### 8.1 请求

```http
POST /api/v1/article-jobs/{task_id}/retry
X-API-Key: <AUTO_JOBS_API_KEY>
X-Platform-Token: <最新创作平台 Token>
Content-Type: application/json
```

```bash
curl --request POST \
  'http://192.168.112.129:8002/api/v1/article-jobs/job_3f2a123456/retry' \
  --header 'X-API-Key: your-auto-jobs-api-key' \
  --header 'X-Platform-Token: eyJ...' \
  --header 'Content-Type: application/json' \
  --data-raw '{"failed_only": true}'
```

- `failed_only=true`：只重试失败项，推荐使用。
- 已成功的目标不会重复发布。
- 只有 `failed` 或 `partial_success` 的任务可以重试。
- 超过最大尝试次数的子任务不能继续重试。

## 9. 幂等处理

调用方应使用自己的业务单号生成幂等键，例如：

```text
article-order-20260820-0001
```

网络超时但无法确定任务是否创建成功时，应使用相同的 `Idempotency-Key` 再次提交。服务端会返回原任务，不会创建第二份任务。

不要对不同业务任务复用相同的幂等键。

## 10. 错误码

### 10.1 HTTP 状态码

| HTTP 状态码 | 说明 |
|---:|---|
| `202` | 任务已创建或已重新加入队列 |
| `400` | 请求无法处理 |
| `401` | API Key 错误，或 Platform Token 缺失、无效、过期 |
| `404` | 任务不存在 |
| `409` | 当前状态不允许重试，或没有可重试项 |
| `422` | 请求字段、域名、目标数量或目标重复校验失败 |
| `503` | Article Agent 服务端未配置 `AUTO_JOBS_API_KEY`，接口已关闭 |

`503` 表示服务端配置问题，不是调用方参数问题，应联系 Article Agent 管理员。

### 10.2 子任务错误码

| `error_code` | 说明 | 建议处理 |
|---|---|---|
| `PLATFORM_TOKEN_INVALID` | Platform Token 无效或过期 | 重新登录获取 Token，然后调用重试接口 |
| `LLM_TIMEOUT` | 单次模型请求超时 | 稍后重试 |
| `LLM_OUTPUT_INVALID` | 模型多次未返回有效结构 | 检查模型服务，稍后重试或调整任务 |
| `JOB_TIMEOUT` | 整个任务超过最长执行时间 | 检查外部服务后重试 |
| `JOB_TERMINATED` | 父任务已结束，子任务停止 | 查询父任务错误信息 |
| `ITEM_EXECUTION_FAILED` | 搜索、写作、配图或发布链路异常 | 查看 `error_message` 后决定是否重试 |

## 11. JavaScript 接入示例

```javascript
const ARTICLE_AGENT_BASE = 'http://192.168.112.129:8002'
const ARTICLE_AGENT_API_KEY = '通过安全配置注入，不要写入前端公开代码'

async function platformLogin(username, password) {
  const response = await fetch('https://adesmobi.com/admin/back/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!response.ok) throw new Error(`登录失败 (${response.status})`)
  const payload = await response.json()
  const result = payload.data ?? payload
  if (!result.token) throw new Error('登录响应中没有 token')
  return result
}

async function createArticleJob(loginResult, idempotencyKey) {
  const response = await fetch(`${ARTICLE_AGENT_BASE}/api/v1/article-jobs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': ARTICLE_AGENT_API_KEY,
      'X-Platform-Token': loginResult.token,
      // 由调用方生成并持久化；同一次业务重试必须复用这个值。
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      intent_keyword: 'dental implants',
      language_id: 1,
      region_id: 'US',
      user: {
        user_id: String(loginResult.userId),
        user_name: loginResult.username,
      },
      targets: [{ domain: 'example.com', site_id: 101, account_id: 11 }],
      mode: 'auto',
      callback_url: null,
      options: {
        publish: false,
        out_show: false,
        generate_author: true,
        articles_per_domain: 1,
        outline: { enabled: false },
        thinking: { enabled: false },
        tags: { enabled: false },
      },
    }),
  })
  const body = await response.json()
  if (!response.ok) throw new Error(body.detail || `创建失败 (${response.status})`)
  return body
}

async function waitForArticleJob(taskId) {
  while (true) {
    const response = await fetch(`${ARTICLE_AGENT_BASE}/api/v1/article-jobs/${taskId}`, {
      headers: { 'X-API-Key': ARTICLE_AGENT_API_KEY },
    })
    const job = await response.json()
    if (!response.ok) throw new Error(job.detail || `查询失败 (${response.status})`)
    if (['success', 'partial_success', 'failed'].includes(job.status)) return job
    await new Promise(resolve => setTimeout(resolve, 5000))
  }
}
```

## 12. 当前接口边界

- `callback_url` 当前只保存，不会主动发送结果回调；调用方必须轮询任务查询接口。
- 调用方查询接口使用共享 API Key，不按用户隔离任务；调用方必须妥善保护 `task_id`。多人直接使用前端时，应使用 Article Agent 的授权用户名单入口，前端接口会按用户隔离任务。
- 授权用户可用 `GET /api/v1/article-jobs/access`（携带 `X-Platform-Token`）判断当前用户是否已获授权：

  ```json
  {
    "allowed": true,
    "super_admin": false,
    "user_id": "20",
    "username": "user@example.com"
  }
  ```
- 外部查询接口返回任务状态、方向、文章 ID 和错误信息，不返回完整文章正文；完整草稿目前通过授权后的 Article Agent 前端查看。
- 地区目前没有动态查询接口，应使用本文档列出的代码；语言、品类、账号和站点必须以创作平台接口实时返回为准。
- 任务创建成功是异步受理，不代表文章已经生成或发布。
- 当前没有面向调用方的主动取消任务接口。

## 13. 上线检查清单

- [ ] `AUTO_JOBS_API_KEY` 已配置为随机强密钥。
- [ ] API Key 只保存在调用方服务端或安全配置中。
- [ ] 每个用户使用自己的创作平台账号登录并获取 Token。
- [ ] 没有在代码、日志、URL 或前端构建产物中写入完整 Token。
- [ ] 首次联调使用 `options.publish=false`。
- [ ] 调用方保存了 `task_id` 和 `Idempotency-Key`。
- [ ] 轮询间隔不低于 5 秒。
- [ ] 已处理 `partial_success` 和单域名失败场景。
- [ ] 已处理 Platform Token 过期后的重新登录与重试。
- [ ] 正式环境使用 HTTPS，并限制 API 的网络访问范围。
