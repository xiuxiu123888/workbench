# 域名日报：数据如何拉取（给另一会话用）

本文描述运营工作台 **「配置 → 域名日报」**（`DailyReport.vue`）当前如何取数、缓存与汇总。  
实现索引：`src/components/DailyReport.vue`、`src/api/report.ts`、`src/domain/report.ts`、`src/domain/reportCache.ts`、`src/api/reportCache.ts`。

---

## 1. 日报看什么

对**左侧选中的一条运营配置**，在日期范围内按天展示：

| 块 | 内容 | 数据来源 |
|----|------|----------|
| 每日汇总 | 总收入、总曝光、词点、广点及环比 | 下面两路聚合 |
| 渠道收入 | 每渠道合计 + **按国家拆开的收入** | MIS `afsData/list` |
| 文章表 | 每篇文章曝光 / 关键词数 / 词点 / 广点 / 关键词明细 | 创作平台 `subid2DailyStat` |
| 洞察图 | 增长/该换/国家贡献等 | 完整自然日的文章指标（不含今天） |

输入 props（来自 Workbench 当前配置）：

- `urls`：推荐文章链接列表（从中解析 `articleId`、`channelId`）
- `countryCodes`：`articleId → 配置国家`
- `accountSource` / `accountName`：推 AFS `source`（如账户 `A3` → `source=3`）
- `configId`：本地缓存「某天挂过哪些文章」用

---

## 2. 两套后端

| 数据 | 客户端 | 鉴权 | 接口 |
|------|--------|------|------|
| 曝光 / 词点 / 广点 / 关键词 | `/article-api` | `VITE_ARTICLE_TOKEN` | `POST /forwardRecord/subid2DailyStat` |
| 渠道收入（含国家） | `/mis-api` | **`VITE_MIS_ADMIN_TOKEN`** + `ClientID` | `GET /report/afsData/list` |

环境变量：

```env
VITE_ARTICLE_API_TARGET=...
VITE_ARTICLE_TOKEN=...
VITE_MIS_API_TARGET=...
VITE_MIS_ADMIN_TOKEN=...   # 收入必须用 admin
VITE_MIS_CLIENT_ID=...
```

`source` 推导：账户名匹配 `A(\d+)` 或 `AFS(\d+)` → 数字字符串；导不出则日报拒绝查询。

---

## 3. 从链接得到「查什么」

对每条推荐 URL：

- `articleId`：路径 `/detail/{id}`
- `channelId`：query `channel`（或项目里 `channelFromUrl` 的等价解析）

当日要查的文章/渠道集合还受「换文记忆」影响：

1. 查本地 `lookupConfigArticles({ configId, start, end })` → 历史上某天挂过的文章  
2. `linksForReportDay(day, today, currentLinks, kept)`：  
   - **过去完整日**且有记忆 → 只用那天记住的文章（反映当时上架集合）  
   - **今天**或无记忆 → 当前配置链接 ∪ 记忆  

约束：日期跨度 ≤ 31 天。

---

## 4. 主查询流程（点「查询」）

```text
选日期范围
  → 展开每一天 dayList
  → 每天算出 links（文章+渠道）
  → lookupReportCache（本地 SQLite/插件缓存）
  → planReportFetch：哪些天已齐（仅「今天以前」可命中缓存）
       · 今天永远重拉
       · 历史日：文章指标齐 + 渠道收入齐（revenue != null）才算齐
  → 对未齐的渠道 span：listChannelRevenue（afsData）
  → 对未齐的文章：listSubid2DailyStat（可批量，失败再逐篇）
  → 历史日写入 cache；今天写入「今日配置文章成员」便于以后回看
  → 组装 days[] 渲染
```

### 4.1 缓存策略（重要）

| 日期 | 行为 |
|------|------|
| `day < today` | 查全且成功可落库；下次命中则不再打远程 |
| `day === today` | 每次重查；收入/曝光不作为「已齐」缓存命中 |
| 渠道拉取失败 | `revenue=null`，**不**当命中，下次重拉 |
| 渠道成功但该日无行 | 历史日记 **0**；今天记 **null（—）** |

本地收入缓存命名空间固定为 investor=`afs`（历史字段名，不再表示真人 investor）。

缓存 API（本机 Vite 插件 / SQLite）：

- `lookupReportCache` / `saveReportCache`
- `lookupConfigArticles` / `saveConfigArticles`

---

## 5. 收入：`GET /report/afsData/list`

实现：`listChannelRevenue`（`src/api/report.ts`）

请求要点：

```http
GET /report/afsData/list
  ?pageNum=1
  &pageSize=100
  &date={start}
  &date={end}          # 数组，serializer indexes:null → 两个 date=
  &filterOpera=true
  &domain=
  &customChannelId={渠道ID}
  &source={可选，日报会传}
Authorization: Bearer <MIS_ADMIN_TOKEN>
ClientID: <MIS_CLIENT_ID>
```

- 按 `total` 翻页，最多约 20 页  
- 丢掉 `date === "汇总"` 行  
- 日合计：`revenueByDay`（同一天多行/多国家相加 → 渠道日收入）  
- 国家明细：`revenueCountriesOnDay`（按 `countryCode` 拆开，UI「国家收入」列）

日报里每个渠道每天展示：

- `revenue`：当日合计  
- `countries[]`：`{ countryCode, revenue }[]`（仅当次拉取有行时有；纯缓存命中可能没有国家明细）

---

## 6. 曝光点击：`POST /forwardRecord/subid2DailyStat`

实现：`listSubid2DailyStat`

```json
{
  "subid2List": ["文章ID", "..."],
  "startDate": "YYYY-MM-DD",
  "endDate": "YYYY-MM-DD",
  "keywordLimit": 20
}
```

返回按天、按 `subid2`（文章 ID）的：

- `pageViewCount` → 曝光  
- `termClickCount` → 关键词点击  
- `adClicksCount` → 广告点击  
- `keywordCount` / `keywords[]` → 关键词明细（词点、广点）

解析：`articleDayStatMap` → key=`articleId\nday`。

拉取策略：

1. 先整批 `subid2List` 一次请求  
2. 失败则 **逐篇文章** 重试；单篇失败当 0，不阻断整表  

超时约 60s。

---

## 7. 「重新拉取」单日

`refreshDay(day)`：

- 不算整段缓存计划，强制对该日所有渠道 + 文章再打远程  
- 历史日仍写回 cache；今天写成员表  
- 更新内存中该日 `days[i]`

---

## 8. 展示层怎么用这些数

- **每日汇总**：当天所有渠道 `revenue` 求和；文章曝光/词点/广点求和；与相邻更旧一天比 delta/rate  
- **渠道表**：渠道 ID、国家收入 chips、合计  
- **文章表**：配置国家、渠道、曝光、关键词展开  
- **洞察**：只用 `day < today` 的完整日，避免今天未跑完扭曲

---

## 9. 时序（简图）

```text
Workbench 选中配置
    │ urls / source / countryCodes / configId
    ▼
DailyReport.load()
    ├─ linksForReportDay（当前链 + 历史成员）
    ├─ lookupReportCache
    ├─ planReportFetch（今天强制 pending）
    ├─ 每个 pending 渠道 ──► afsData/list (ADMIN)
    │                         └─ byDay + byCountry
    ├─ pending 文章 ────────► subid2DailyStat
    │                         └─ 失败则逐篇
    ├─ saveReportCache（仅 day < today）
    └─ render days[]
```

---

## 10. 和「回收」的差别（避免混）

| | 日报 | 回收 |
|--|------|------|
| 目的 | 单站日常曝光+收入+洞察 | 看本站文章各国收入 |
| 曝光 | 有（subid2DailyStat） | 无 |
| 收入 | afsData，按渠道日合计 + 国家拆分 | afsData，按国家汇总 |
| 缓存 | 历史日本地缓存 | 当前实现偏即时查 |

两边收入都走 **同一** `listChannelRevenue` → `afsData/list` + admin token。

---

## 11. 新会话最小复刻清单

1. 从运营配置 URL 解析 `articleId` + `channelId`  
2. 账户名 → `source`  
3. 实现 `listSubid2DailyStat` + `listChannelRevenue`（admin）  
4. （推荐）历史日缓存：今天重拉、失败不记齐、无行历史记 0  
5. （推荐）换文成员表：过去日按当时文章集合查  
6. UI：按天汇总 + 渠道（含国家）+ 文章关键词  

代码入口：`DailyReport` 的 `load` / `refreshDay` / `loadArticleStatsMap`。
