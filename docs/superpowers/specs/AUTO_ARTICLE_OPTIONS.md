# 自动编排文章配置使用清单

## 1. 使用规则

- `options` 整体可选。
- `options` 内所有配置均可按需传递。
- 未传的配置由后端使用默认值引导 AI 生成，但不会作为任务失败的硬性条件。
- 只有请求中显式传入的限制字段才参与最终硬校验。
- 嵌套配置只覆盖传入字段，不会清空同组的其他默认配置。

例如没有传 `seo.description_max_length` 时，后端仍会引导 AI 将 SEO 描述控制在默认的 160 字符内；即使生成结果超过 160 字符，也不会因此判定整篇文章失败。只有显式传入该字段时，超长才会触发重写或失败。

例如只限制概览为 70～150 字符：

```json
{
  "options": {
    "overview": {
      "min_length": 70,
      "max_length": 150
    }
  }
}
```

## 2. 最简完整请求

```bash
curl --request POST 'https://adesmobi.com/api/v1/admin/article-jobs' \
  --header 'Content-Type: application/json' \
  --header 'X-Platform-Token: <创作平台Token>' \
  --header 'Idempotency-Key: overview-test-<唯一值>' \
  --data-raw '{
    "intent_keyword": "dental",
    "language_id": 1,
    "region_id": "US",
    "user": {"user_id": "20", "user_name": "zhangxy@pixeljet.cn"},
    "targets": [
      {"domain": "feelwellus.com", "site_id": 2, "account_id": 7}
    ],
    "options": {
      "overview": {"min_length": 70, "max_length": 150}
    }
  }'
```

## 3. 可选配置清单

| 配置 | 引导默认值 | 显式传入后的作用 |
|---|---:|---|
| `title.max_length` | `70` | 硬性限制标题最大字符数 |
| `title.include_year` | `true` | 硬性要求标题是否包含当前年份 |
| `overview.min_length` | `0` | 硬性限制概览最小字符数 |
| `overview.max_length` | `150` | 硬性限制概览最大字符数 |
| `body.target_length` | `2000` | 正文目标长度 |
| `body.min_length` | `1500` | 硬性限制正文最低长度 |
| `body.include_cta` | `true` | 是否要求 CTA |
| `body.include_headings` | `true` | 硬性要求包含或排除小标题 |
| `body.include_tables` | `true` | 硬性要求包含或排除表格 |
| `body.include_lists` | `true` | 硬性要求包含或排除列表 |
| `keywords.mode` | `auto` | `auto` 自动选词；`manual` 使用指定关键词 |
| `keywords.values` | `[]` | 手动关键词列表 |
| `keywords.min_count` | `5` | 自动选词最少数量 |
| `keywords.max_count` | `10` | 自动选词最多数量 |
| `keywords.include_in_title` | `true` | 关键词是否用于标题 |
| `keywords.include_in_overview` | `true` | 关键词是否用于概览 |
| `keywords.include_in_headings` | `true` | 关键词是否用于小标题 |
| `keywords.include_in_body` | `true` | 关键词是否用于正文 |
| `keywords.include_in_seo` | `true` | 关键词是否用于 SEO 三元素 |
| `seo.enabled` | `true` | 是否生成 SEO 三元素 |X-Platform-Token
| `seo.title_max_length` | `60` | 硬性限制 SEO 标题最大字符数 |
| `seo.description_max_length` | `160` | 硬性限制 SEO 描述最大字符数 |
| `image.enabled` | `true` | 是否生成封面及正文图片 |
| `source.show_in_article` | `false` | 是否在正文展示来源和链接 |
| `thinking.enabled` | `false` | 是否启用深度思考；默认关闭以缩短生成耗时 |
| `outline.enabled` | `false` | 是否先生成文章大纲；默认根据选题和资料直接写作 |
| `topic_research.provider` | `tavily` | 自动编排选题检索提供方，固定为 Tavily |
| `topic_research.query_count` | `3` | 选题阶段的 Tavily 查询数，支持 `2～3` |
| `articles_per_domain` | `1` | 每个域名生成的独立文章数量，支持 `1～10` |
| `generate_author` | `false` | 是否生成本地化作者名称 |
| `publish` | `true` | 是否生成后直接发布到文章中心 |
| `out_show` | `false` | 发布后是否外显 |

## 4. 常用组合

### 只限制概览

```json
{
  "options": {
    "overview": {"min_length": 70, "max_length": 150}
  }
}
```

### 不生成任何图片，先保留草稿

```json
{
  "options": {
    "image": {"enabled": false},
    "publish": false
  }
}
```

关闭图片后不会调用图片生成接口，封面为空，正文也不会插入图片。

### 手动指定关键词

```json
{
  "options": {
    "keywords": {
      "mode": "manual",
      "values": ["dental implants", "dental implant cost"]
    }
  }
}
```

`mode=manual` 时 `values` 不能为空。

### 关闭 SEO 三元素

```json
{
  "options": {
    "seo": {"enabled": false}
  }
}
```

关闭后 `metaTitle`、`metaDescription` 和 `terms` 返回空字符串。

### 调整单个 SEO 参数

```json
{
  "options": {
    "seo": {"title_max_length": 55}
  }
}
```

这里只覆盖 SEO 标题长度，`seo.enabled` 和描述长度仍使用默认值。

### 开启大纲和深度思考

```json
{
  "options": {
    "outline": {"enabled": true},
    "thinking": {"enabled": true}
  }
}
```

两项默认都关闭；只在复杂选题确实需要更深入规划时开启。

### 为每个域名生成多篇文章

```json
{
  "options": {
    "articles_per_domain": 3
  }
}
```

例如请求包含 2 个域名时，会创建 6 个独立文章子任务。每篇文章拥有不同编排方向，可分别查看、发布和重试。

## 5. 参数校验

- 只有显式传入的长度和元素限制会作为文章成品的硬校验条件；未传字段的默认值只用于生成引导。
- `overview.min_length` 不能大于 `overview.max_length`。
- `body.min_length` 不能大于 `body.target_length`。
- `keywords.min_count` 不能大于 `keywords.max_count`。
- `keywords.mode=manual` 时必须传递非空 `keywords.values`。
- `articles_per_domain` 必须是 `1～10` 的整数。
- `topic_research.provider` 只接受 `tavily`，`query_count` 只接受 `2～3`。
- 域名使用裸域名，不包含协议或路径。
- 同一个 `Idempotency-Key` 重复提交会返回原任务，不会重复创建。

参数不合法时返回 HTTP `422`。

## 6. 查询有效配置

创建和查询任务的响应都包含任务实际保存的 `options`。调用方可以直接查看后端补齐后的完整配置：

```bash
curl 'https://adesmobi.com/api/v1/admin/article-jobs/<task_id>' \
  --header 'X-Platform-Token: <创作平台Token>'
```

## 7. 调用前使用清单

- 使用裸域名，例如 `feelwellus.com`，不要携带协议和路径。
- 每次新建测试使用新的 `Idempotency-Key`；重复使用会返回原任务。
- `options` 只传本次真正需要强制执行的配置，不要为了补全结构而传全部默认值。
- 手动关键词必须与 `intent_keyword` 主题一致，且 `keywords.mode=manual` 时 `values` 不能为空。
- `image.enabled=false` 会关闭封面图和正文图片。
- `publish=false` 表示只生成草稿，确认后再通过发布接口发布。
- `out_show` 默认 `false`，不需要外显时可以省略。
- 未传 SEO 长度、正文长度或表格/列表要求时，不会因为这些默认引导值未达标而判定任务失败。
- 创建成功后轮询任务详情；同一任务的多个域名分别查看 `results[]` 状态。
- 任务由独立 `automation-worker` 执行，部署时确保 Worker 已启动，并且与后端共享数据库。
