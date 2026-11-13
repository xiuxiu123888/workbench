# Offer ↔ 种子词匹配与创编设计

日期：2026-11-12  
状态：已批准  
实现计划：`docs/superpowers/plans/2026-11-12-offer-seed-matching.md`

## 1. 目标

把「文章创编并写回 offer」从 **漏斗级批量** 改为 **offer 级匹配**：

- 词库按 **品类** 挂载多种子词（由运营导入）
- 在工作台多选 offer、多选/单选词，**随机打乱一对一分配** 后创编文章并写回 offer
- 执行内核复用现有产文发布与 landpulse 写回规则
- **数据落在仓库文件中**（可提交、拉取后别处直接跑），**不写浏览器 localStorage 作为源数据**

二期（本文只预留，不纳入第一版实现）：

- 按 offer 表现 / 建议品类动态匹配种子
- 从埋点取关键词写回词包

## 2. 问题与原则

### 现状问题

当前脚本与漏斗浏览偏 **漏斗级**：进漏斗后对 offer 批量产文，种子池在漏斗任务内打乱共用。  
但业务上 **文章与 offer 是匹配关系**；同一漏斗下的 offer 才是执行单元，漏斗只是容器/筛选入口。

### 原则

1. **主键是 `offerId`**，不是 `funnelId`
2. **词库归属品类**：`品类 → 种子列表`；不另造与品类平行的「词包」实体
3. **每个 offer 一次任务只绑定 1 个词**
4. **源数据进 git**（`data/` 下 JSON 等），运行时可读；浏览器缓存若有，仅作加速，不能当唯一真相

## 3. 数据模型（仓库内）

建议目录（实现时可微调，但必须可提交）：

```text
data/ops-center/
  seed-lexicon/
    meta.json                 # 导入时间、来源说明
    by-category.json          # 品类 → 种子列表
  offer-tags/
    by-offer.json             # offerId → 人工品类标签等（第一版可选）
```

### 3.1 词库 `by-category.json`（第一版必做）

由你按现有品类导入；平台只负责挂在品类下。

```json
{
  "updatedAt": "ISO-8601",
  "categories": [
    {
      "categoryKey": "医疗·皮肤",
      "categoryId": 6453,
      "seeds": [
        {
          "keyword": "Eczema Treatment Cost",
          "regionId": "US",
          "ref": "Eczema Treatment Cost",
          "intentKeyword": "Eczema Treatment Cost"
        }
      ]
    }
  ]
}
```

- `categoryKey`：与现有种子表 `domainCategory` / 品类名对齐
- `categoryId`：对文章侧品类 ID（可由现有 `category-id-lookup` 解析写入）
- **国家维度**：每个种子带 `regionId`（如 `US` / `VI`）；**同一品类下不同国家可以有不同词**，去重键为 `品类 + regionId + keyword`
- 导入方式：脚本或运营中心「导入」接口，**写入上述文件**，不是 localStorage；导入表需带国家列
- UI：选词支持按品类、按国家筛选；可选「按选中 offer 的 geo」快速滤国家

### 3.2 Offer 库视图（第一版）

- 主键 **`offerId`**；跨漏斗去重后展示
- **范围**：仅 `FUNNEL_BROWSE_ALLOWLIST` 白名单漏斗下的 offer（与漏斗总览一致）
- 漏斗名仅作「出现在哪些漏斗」的附属信息 / 可选过滤，**不是执行单位**
- ~~人工给 offer 打品类标签~~：**第一版不做**（易与「词库按品类组织」混淆）。选词直接从品类词库勾选即可
- `offer-tags/by-offer.json` 文件可保留空壳，二期再用

### 3.3 明确不落浏览器作为源

| 数据 | 存储 |
|------|------|
| 词库、offer 品类标签 | `data/ops-center/**` 文件 + git |
| 生成任务草稿 / 替换日志 | 继续走现有 ops-center 落盘文件；若 UI 有 localStorage，只作与磁盘的合并缓存，**拉取代码后的权威仍是仓库/服务端文件** |

## 4. 分配算法

输入：选中的 offer 列表 `O[1..n]`，选中的词列表 `W[1..m]`（`m >= 1`）。

规则：

1. 拷贝 `W` 并 **随机打乱** 得到 `S`
2. 对每个 offer `i`（0-based）：词 = `S[i % S.length]`
3. 因此：
   - **词多于 offer**：打乱后只用前 n 个等价效果（取模后多余槽位不会被用到）
   - **词少于 offer**：循环复用
   - **只选 1 个词**：所有 offer 都用该词
4. **硬约束**：每个 offer 恰好 1 个词；禁止一词多挂到同一 offer 的多次槽位（单次任务内）

生成前 UI 展示「offer → 词」预览，可「重新打乱」后再确认。

## 5. 交互（第一版）

入口建议：**运营中心 → Offer 创编工作台**（可从漏斗详情跳入并带上当前漏斗 offer 作为筛选，但执行不依赖漏斗）。

主流程：

1. 筛选/多选 offer（可按漏斗、geo、是否已打标等）
2. 从词库选词（默认按 offer 品类过滤；允许跨品类多选）
3. 预览随机分配；可重新打乱
4. 确认 → 批量创编（复用现有 create job / poll / publish）
5. 成功后按现规则写回 offer：
   - `resultUrl`：整条新落地链
   - `url`：仅替换文章 id 与 ref
6. 预览 / 一键预览 / 一键替换：复用已有能力，对象仍是 offer 草稿

## 6. 执行内核

- 复用：`funnelOfferGenerate` 拼链逻辑、`landpulseOffer` 写回、文章 job API
- 任务记录建议按 `offerId` 索引（可仍写入 `funnel-offer-drafts.json`，但字段与查询以 offer 为准；`funnelId` 仅元数据）
- 批量脚本：后续可增加 `tmp/run-offer-generate.mjs`，输入 offerId 列表 + 分配结果，避免再按漏斗驱动

## 7. 非目标（第一版不做）

- 定时调度 / cron 全自动换文
- 按 RPM/换文建议自动改品类或自动抽词
- 埋点关键词自动写入词包
- 用 localStorage 作为词库或标签的唯一存储

## 8. 验收

1. 导入一份按品类组织的词库文件后，另机 pull 代码即可读到同一词库
2. 选 5 个 offer + 2 个词 → 预览为 5 条「一人一词」，且仅出现这 2 个词的循环分配
3. 选 5 个 offer + 8 个词 → 每 offer 一词，来自打乱后的子集
4. 选 1 个词 + 多个 offer → 全部同词
5. 生成并发布后，对应 offer 的 `resultUrl`/`url` 更新规则与现网一致
6. 刷新或换机器后，词库仍在（不依赖该浏览器 localStorage）

## 9. 实现顺序（计划阶段再拆任务）

1. 词库 JSON schema + 导入脚本/API 写入 `data/ops-center/seed-lexicon/`
2. 分配纯函数 + 单测（打乱可注入 RNG）
3. Offer 创编工作台 UI（多选 offer / 词 / 预览 / 生成）
4. 接通现有产文与写回
5. （可选）offer 品类标签文件与批量打标 UI
