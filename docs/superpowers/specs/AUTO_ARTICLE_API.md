# 自动编排（文章批量自动化）API 使用文档

自动编排：调用方提交一个种子词和一组发布目标（站点 + 账号），后端异步完成「关键词研究 → 方向规划 → 文章创作 → 配图 → 发布」全流程，逐站产出文章并返回 `article_id`。

文章标题、概览、正文、关键词、SEO、图片等按需配置见 [`AUTO_ARTICLE_OPTIONS.md`](./AUTO_ARTICLE_OPTIONS.md)。

代码位置：`backend/api/article_jobs.py`、`backend/services/article_jobs.py`。

## 一、环境配置

在 `backend/.env` 中配置：

```env
AUTO_JOBS_API_KEY=replace-with-an-internal-secret   # 调用方鉴权用的 API Key
AUTO_JOBS_MAX_TARGETS=20                             # 单个任务最多目标数
AUTO_JOBS_CONCURRENCY=3                              # 批次内并发处理数
AUTO_JOBS_MAX_ATTEMPTS=3                             # 每个子任务最大执行次数
AUTO_JOBS_POLL_INTERVAL=2                            # Worker 轮询队列间隔（秒）

CREATOR_PLATFORM_TOKEN=<JWT>                         # 发布平台凭证（可选，调用时未传时兜底用）
```

> 未配置 `AUTO_JOBS_API_KEY` 时仅适合本地开发，接口不校验 API Key，生产环境务必配置。

## 二、认证方式

分两套，按接口区分：

| 接口 | 认证 | 凭证位置 |
|---|---|---|
| `/api/v1/article-jobs/*`（调用方接口） | `AUTO_JOBS_API_KEY` | `Authorization: Bearer <key>` 或 `X-Api-Key` |
| `/api/v1/admin/article-jobs/*`（前端接口） | 发布平台 JWT；`superAdmin` 或已由超管授权的用户名 | `X-Platform-Token: <JWT>` |

所有**创建/重试**接口还需要携带发布平台凭证：

```text
X-Platform-Token: <JWT>
```

- 服务端会校验 JWT 的 `exp`，过期会返回 `401`。
- 未传时回退到环境变量 `CREATOR_PLATFORM_TOKEN`。
- 该 token 只用于任务执行（发布文章），**不会**通过任务详情、列表或回调返回，请调用方自己保管。

## 三、接口总览

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/v1/article-jobs` | 创建自动编排任务（202） |
| GET | `/api/v1/article-jobs/{task_id}` | 查询任务详情与结果 |
| POST | `/api/v1/article-jobs/{task_id}/retry` | 重试失败项 |
| GET | `/api/v1/admin/article-jobs` | 后台任务列表（分页 + 筛选） |
| POST | `/api/v1/admin/article-jobs` | 后台创建任务（202） |
| GET | `/api/v1/admin/article-jobs/{task_id}` | 后台查询任务 |
| GET | `/api/v1/admin/article-jobs/{task_id}/items/{item_id}/article` | 查看已生成的文章草稿 |
| POST | `/api/v1/admin/article-jobs/{task_id}/items/{item_id}/publish` | 将确认后的草稿发布到文章中心 |
| POST | `/api/v1/admin/article-jobs/{task_id}/retry` | 后台重试失败项 |
| POST | `/api/v1/admin/article-jobs/{task_id}/items/{item_id}/retry` | 后台重试单个子任务 |

## 四、接口详解

### 1. 创建任务

`POST /api/v1/article-jobs`

请求头：

```text
Authorization: Bearer <AUTO_JOBS_API_KEY>
Idempotency-Key: <调用方生成的唯一业务键>
Content-Type: application/json
```

请求体：

```json
{
  "intent_keyword": "wireless earbuds",
  "category_id": 10,
  "language_id": 1,
  "region_id": "US",
  "user": {
    "user_id": "u_123",
    "user_name": "张三"
  },
  "targets": [
    {"domain": "test.com", "site_id": 101, "account_id": 20},
    {"domain": "example.com", "site_id": 102, "account_id": 20}
  ],
  "mode": "auto",
  "callback_url": null,
  "options": {"out_show": false, "generate_author": true, "publish": false}
}
```

字段说明：

| 字段 | 必填 | 说明 |
|---|---|---|
| `intent_keyword` | 是 | 种子词（1-300 字符） |
| `category_id` | 否 | 品类 ID；不填时编排器根据种子词自行推断 |
| `language_id` | 是 | 目标语言 ID（>0） |
| `region_id` | 是 | 目标地区，如 `US`（1-20 字符） |
| `user.user_id` | 是 | 归属用户 ID |
| `user.user_name` | 否 | 归属用户名 |
| `targets` | 是 | 发布目标数组，1~`AUTO_JOBS_MAX_TARGETS` 个；`domain` 为裸域名（自动去 `http(s)://`），不可重复 |
| `mode` | 否 | 固定 `"auto"` |
| `callback_url` | 否 | 预留；当前**不会**发送回调，请轮询查询接口 |
| `options.out_show` | 否 | 是否公开显示，默认 `false` |
| `options.generate_author` | 否 | 是否为每篇生成虚构署名作者，默认 `false` |
| `options.publish` | 否 | 是否发布到平台，默认 `true`；`false` 时只生成文章草稿不发布，`results[].article_id` 为 `null` |
| `options.thinking.enabled` | 否 | 是否启用深度思考，默认 `false`；复杂选题需要更深入分析时可开启 |
| `options.outline.enabled` | 否 | 是否先生成文章大纲，默认 `false`；关闭时根据选题和资料直接写作 |
| `options.topic_research` | 否 | 选题检索固定使用 Tavily；`query_count` 默认 `3`，范围 `2～3` |
| `options.articles_per_domain` | 否 | 每个域名生成多少篇独立文章，默认 `1`，范围 `1～10` |

`options` 中所有文章配置均可按需传入。后端默认值用于引导 AI 生成；只有请求中显式传入的长度、年份、正文元素等限制才作为最终硬校验。比如未传 `options.seo.description_max_length` 时，SEO 描述超过默认 160 字符不会导致整篇文章失败。完整配置和使用清单见 [`AUTO_ARTICLE_OPTIONS.md`](./AUTO_ARTICLE_OPTIONS.md)。

返回 `HTTP 202`：

```json
{
  "task_id": "job_3f2a...",
  "status": "queued",
  "mode": "auto",
  "intent_keyword": "wireless earbuds",
  "category_id": 10,
  "language_id": 1,
  "region_id": "US",
  "user": {"user_id": "u_123", "user_name": "张三"},
  "callback_url": null,
  "progress": {"total": 2, "completed": 0, "success": 0, "failed": 0, "running": 0},
  "usage": {"tavily_calls": 0, "planning_tavily_calls": 0},
  "results": [
    {"id": 1, "domain": "test.com", "site_id": 101, "account_id": 20, "status": "pending",
     "article_id": null, "conversation_id": null, "direction": null, "attempts": 0,
     "tavily_calls": 0, "author_name": null, "error_code": null, "error_message": null},
    {"id": 2, "domain": "example.com", "site_id": 102, "account_id": 20, "status": "pending",
     "article_id": null, "conversation_id": null, "direction": null, "attempts": 0,
     "tavily_calls": 0, "author_name": null, "error_code": null, "error_message": null}
  ],
  "error_message": null,
  "created_at": "2026-08-20T10:00:00+00:00",
  "started_at": null,
  "completed_at": null
}
```

相同 `Idempotency-Key` 会返回原任务（幂等），不会重复发布。

任务子项总数为 `targets.length × options.articles_per_domain`。多篇文章会分别规划差异化标题、搜索意图和内容结构，并在 `results[]` 中通过 `domain + article_number` 区分。单篇失败只重试对应子项，不会重复生成已经成功的文章。

### 2. 查询任务

`GET /api/v1/article-jobs/{task_id}`

返回结构同创建接口，含实时进度与结果。完成后从 `results[].article_id` 读取各站发布结果：

```json
[
  {"domain": "test.com", "status": "success", "article_id": 111},
  {"domain": "example.com", "status": "success", "article_id": 112}
]
```

### 3. 重试失败项

`POST /api/v1/article-jobs/{task_id}/retry`

请求体：

```json
{"failed_only": true}
```

- `failed_only=true`（默认）：仅重试失败项；`false`：重试所有未成功项。
- 成功发布的域名不会再次发布。
- 每个子任务最多执行 `AUTO_JOBS_MAX_ATTEMPTS` 次，超限不再重试。
- 仅 `failed` / `partial_success` 状态的任务可重试，否则返回 `409`。
- 返回 `HTTP 202` + 更新后的任务对象。

### 4. 前端自动编排接口

接口鉴权使用 `X-Platform-Token: <JWT>`。超级管理员可查看和操作全部任务；由超级管理员在前端“权限设置”中授权的普通用户只能查看和操作自己的任务。只有超级管理员可以读取和修改授权用户名单。

- **任务列表**：`GET /api/v1/admin/article-jobs?status=running&keyword=...&page=1&page_size=20`
  - `status` 支持 `running`（= queued/planning/running）、`success`、`failed`、`partial_success` 等。
  - 返回分页结构：`{ items, total, page, page_size, summary }`，其中 `summary` 为全局计数。
- **查看草稿**：`GET /api/v1/admin/article-jobs/{task_id}/items/{item_id}/article`
  - 返回已生成文章的内容字段：`title / firstP / text / terms / metaTitle / metaDescription / image / sources`。
  - 草稿未就绪时返回 `409`。
- **发布确认后的草稿**：`POST /api/v1/admin/article-jobs/{task_id}/items/{item_id}/publish`
  - 创建任务时设置 `options.publish=false`，文章完成后可使用此接口逐条发布。
  - 发布成功后对应结果会写入 `article_id`；重复调用已发布条目不会重复创建文章。
- **重试单个子任务**：`POST /api/v1/admin/article-jobs/{task_id}/items/{item_id}/retry`
  - 仅 `failed` 且未超重试上限的子任务可重试，否则 `409`。

## 五、任务状态机

批次状态：

```
queued → planning → running → success
                          ↘ partial_success（部分成功）
                          ↘ failed（全部失败）
```

子任务状态：

```
pending → researching → outlining → writing → imaging → publishing → success / failed
```

进程重启时，Worker 会恢复中断任务：`planning/running` 重置为 `queued`，进行中的子项重置为 `pending`，已成功的项保持不动。

## 六、幂等与去重

- 幂等键：`Idempotency-Key`，同一键再次创建返回原任务。

### 本地批量脚本（新站复用）

完整流程见 [`ARTICLE_OPS.md`](./ARTICLE_OPS.md)。  
脚本只有一份：`docs/scripts/setup-articles.mjs`（改顶部 `CONFIG`，再 `--categories` / `--jobs`）。
- 目标去重：同批 `targets` 内不允许 `(domain, site_id, account_id)` 重复。
- 标题去重：方向规划阶段会校验标题/搜索意图/论点/大纲结构之间的相似度，重复会被拒绝并自动重试规划。

## 七、常见错误

| 状态码 | 场景 |
|---|---|
| 401 | API Key 缺失/错误，或平台 token 缺失/过期 |
| 403 | 后台接口非 superAdmin |
| 404 | 任务或子任务不存在 |
| 409 | 状态不允许重试、无可重试项、草稿未就绪、超过重试上限 |
| 422 | 参数不合法（目标过多、domain 格式错误、目标重复、targets 为空、显式配置范围冲突等） |

子任务失败时，`results[].error_code` 常见值：`PLATFORM_TOKEN_INVALID`（发布 token 失效，需换新 token 重试）、`ITEM_EXECUTION_FAILED`（创作/发布链路异常）。

文章生成阶段只会对调用方显式传入的限制做硬校验。未传入的默认长度和元素配置只用于提示模型，不会单独造成任务失败。

## 八、正式服快速调用

正式服基础地址：`https://adesmobi.com/api`。以下接口供 Article Agent 前端用户调用，统一携带 `X-Platform-Token`。

### 创建多域名草稿

```bash
curl --request POST 'https://adesmobi.com/api/v1/admin/article-jobs' \
  --header 'Content-Type: application/json' \
  --header 'X-Platform-Token: <创作平台Token>' \
  --header 'Idempotency-Key: admin-multi-domain-<唯一值>' \
  --data-raw '{
    "intent_keyword": "dental",
    "language_id": 1,
    "region_id": "US",
    "user": {"user_id": "20", "user_name": "zhangxy@pixeljet.cn"},
    "targets": [
      {"domain": "feelwellus.com", "site_id": 2, "account_id": 7},
      {"domain": "counselsai.com", "site_id": 34, "account_id": 7}
    ],
    "mode": "auto",
    "callback_url": null,
    "options": {"out_show": false, "generate_author": true, "publish": false}
  }'
```

### 查询任务

```bash
curl 'https://adesmobi.com/api/v1/admin/article-jobs/<task_id>' \
  --header 'X-Platform-Token: <创作平台Token>'
```

### 确认后发布一篇草稿

从查询结果的 `results[]` 取得对应 `item_id`：

```bash
curl --request POST \
  'https://adesmobi.com/api/v1/admin/article-jobs/<task_id>/items/<item_id>/publish' \
  --header 'X-Platform-Token: <创作平台Token>'
```

## 九、局域网部署

可以。后端 uvicorn 绑定 `0.0.0.0`、CORS 全开，前端构建产物由 nginx 托管并通过同源 `/article-agent/api/` 反向代理到后端，局域网内直接用服务器 IP 访问即可。

### 方式一：Docker Compose（推荐）

项目根目录已有 `docker-compose.yml`：

- `backend`：端口 `8002`，只提供 Agent 和自动编排 API，不执行后台任务
- `automation-worker`：独立消费并执行自动编排任务，不暴露端口
- `frontend`：端口 `8080`，nginx 监听容器 `80`，映射到宿主机 `8080`

```bash
# 在项目根目录
docker-compose up -d --build
```

部署后：

- 前端后台：`http://<服务器IP>:8080/article-agent/`
- 直接调用自动编排 API：`http://<服务器IP>:8002/api/v1/article-jobs`

### 方式二：本地开发模式

```bash
# 后端
cd backend
uvicorn main:app --host 0.0.0.0 --port 8002

# 自动编排 Worker（另开终端）
cd backend
python automation_worker.py

# 前端（vite dev，已配置 /api 代理）
cd frontend
npm run dev
```

### 注意事项

1. **外网依赖**：服务器需能访问外网——DeepSeek LLM、Tavily 搜索、创作平台（`CREATOR_PLATFORM_BASE_URL`）、MIS 平台，均在后端侧调用，局域网客户端无需额外网络权限。
2. **防火墙**：放行宿主机 `8080`（Web）与 `8002`（API）端口。
3. **配置检查**：`backend/.env` 中 `AUTO_JOBS_API_KEY`、`CREATOR_PLATFORM_TOKEN` 按第二节配置；token 过期需替换。
4. **数据卷**：SQLite 落在 `article-data` volume，重部署不丢数据。
5. **单 Worker**：当前数据库队列只允许启动一个 `automation-worker`，避免同一任务被重复领取。

## 十、独立 Worker 部署

自动编排执行已从 Agent 进程拆分。`main.py` 不再启动 Worker，Agent 服务重启不会主动消费任务。

```text
Article Agent API ──写入任务──> 共享数据库 <──领取任务── Automation Worker
```

- API 与 Worker 必须使用同一个 `DATABASE_URL`。
- 使用 SQLite 时，API 与 Worker 必须位于同一服务器并挂载同一个 `article-data` 数据卷。
- 跨服务器部署时应改用 PostgreSQL，不能分别使用各自的 SQLite 文件。
- 当前只启动一个 Worker；如需多 Worker，必须先实现原子任务领取和租约机制。
