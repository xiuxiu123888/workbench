# 自动化 Offer 换文（Architectural）

日期：2026-11-13  
状态：待评审（先报告，未实现）

## 1. 目标

每隔约 2 小时，对白名单漏斗里「该换」的非 default offer：

1. 在**同合作商前缀**内，找收入最高且仍有二跳的 offer，取其落地 `ref` 当种子词；
2. 用现有产文管线生成新文（`publish=true`）；
3. **预览确认后再写回**该 offer（`resultUrl` 整链；`url` 仅替换文章 id + ref）；
4. 在「自动化换文列表页」展示本轮队列，并落盘**换文数据快照**便于回看。

成功标准：弱 offer / 无广告 offer 数量下降；被换 offer 的二跳率与 RPC 在换后 2–6 小时可对比改善；每次跑都有可审计快照。

## 2. 已对齐约束

| 项 | 决定 |
|---|---|
| 借词范围 | 同合作商前缀（`Blinkdrama-*`→blinkdrama，`moboreels-*`→moboreels…） |
| 种子来源 | 商内收入最高、非 default、且广告点击或转化 > 0 的 offer 的 `ref` |
| 排除 | offer 名含 `default`；非白名单漏斗不进自动队列 |
| 写回时机 | 产文成功后先预览，确认后再写（与 Offer 创编一致） |
| 效率指标 | 主看 `funnelRpm` + `RPC(=revenue/funnelClicks)`；二跳看 `clicks/funnelClicks` |
| 节奏 | 目标每 2 小时一轮；先半自动，全自动需傍晚整天数据后再开 |

## 3. 触发优先级（本批起）

双跳排查后：一跳（词点击）普遍不差，收入差在二跳（广告）。因此队列分层：

### P0 — 疑似无广告（本批优先）

- `funnelClicks ≥ 50`
- `clicks(广告) = 0` 且 `conversion = 0`
- 排除 default

含义：词有人点，但几乎没广告点击 → 优先换文/换域，而不是继续堆词曝光。

### P1 — 弱二跳

- `funnelClicks ≥ 100`
- 二跳率 `clicks/funnelClicks < 2%`
- 且 `funnelRpm < 1` **或** `RPC < 0.01`

### P2 — 常规低 RPM（全自动候选，暂缓猛扫）

- `visits ≥ 50`（量不足时可用 ≥10，但更吵）
- `funnelRpm < 1`
- 排除已在 P0/P1 的行

说明：仅 `RPM < 1` 会扫进大量 offer；全自动默认建议 **P0/P1 优先**，P2 每商每轮设上限（建议 2–3）。

## 4. 借种规则

1. 按漏斗名前缀归合作商。
2. 商内选：`revenue` 最大，且 `adClicks > 0 || conversion > 0`，且 `ref` 非空，且非 default。
3. 目标 offer 若已是商内最高收 → 不借自身；标「人工指定种子」或仅换域。
4. 借到的 `ref` 与当前 `ref` 相同 → 标「同词跳过/换域再试」（换文解决不了域/广告位问题时不要空跑）。
5. 已知取舍：跨品类借词（例如 moboreels 高收是家清词）是当前规则的结果；若后续要「同品类优先」，作为规则 v2，不阻塞 v1。

## 5. 系统方案（推荐）

### 方案对比

| 方案 | 做法 | 优点 | 缺点 |
|---|---|---|---|
| A. 纯脚本+人工 | 出报告 txt/json，人在创编台点产文写回 | 最快落地 | 无列表页/无定时/无快照体系 |
| B. 半自动子系统（推荐） | 定时算队列+快照；列表页勾选→批量产文→预览→写回 | 可审计、可控、复用现有写回 | 需新页+任务存储 |
| C. 全自动无人值守 | 定时直接产文写回 | 省人力 | 误换成本高；今数据未全日，不建议先上 |

**推荐 B。** 本批 P0 可先用 A 出队执行；B 与 A 共用同一套选队/借种逻辑。

### 模块

1. **选队 / 优化批次** `optimize-batches/`  
   P0/P1 队列 + 优化前快照 + 回收报告
2. **备货池** `optimize-batches/article-stock.json`  
   先按借种产文入库（ordered→ready），到点只写回漏斗并 consume
3. **页面** `/auto-offer-replace`  
   复盘报告 + 备货水位 + 导入备货单 + 从创编草稿同步 + 跑一轮写回
4. **调度**  
   节奏默认 3 小时；页面开启后在本页存活期间 `setInterval` 自动跑一轮；服务端常驻 cron 下一阶段再接

### 写回契约（沿用现有）

- `resultUrl`：完整新落地链（含新文章 id、新 ref、原 channel/partner/subid）
- `url`：仅替换文章 id 与 ref
- 写前预览；写后记 replace-log

## 6. 优化记录与前后对比（已配）

落盘目录：`data/ops-center/optimize-batches/`

| 文件 | 用途 |
|---|---|
| `index.json` | 批次索引（优化记录列表） |
| `{batchId}.json` | 批次详情：计划借种 + **优化前快照** + 可选优化后快照 |
| `{batchId}.report.txt` | 可读对比报告 |

### 建批次（存优化前）

```bash
npx tsx tmp/build-noad-replace-report.ts
npx tsx tmp/create-p0-optimize-batch.ts
```

### 回收优化后（链接换文后，有新指标日再请求）

```bash
npx tsx tmp/harvest-optimize-batch.ts opt-p0-20261113 2026-11-14
```

或 API：

- `GET /local-api/ops-center/optimize-batches` — 优化记录列表
- `GET /local-api/ops-center/optimize-batches/:id` — 批次详情（含 before）
- `GET /local-api/ops-center/optimize-batches/:id/report` — 报告文本
- `POST /local-api/ops-center/optimize-batches/:id/harvest` body `{"day":"2026-11-14"}` — 按指标日回收 after 并刷新报告
- `POST /local-api/ops-center/optimize-batches/:id/mark-written` — 换文写回后标记

## 7. 本批执行建议（11-13）

- **先换 P0：24 条**（见 `tmp/noad-replace-report.txt` / 批次 `opt-p0-20261113`）
- 不要同轮扫光 P2（约 19+）
- 同词已对齐 donor 的（如 storyreel 已挂 `long acting buprenorphine` 仍无广告）→ **换域/换模板优先于再产同词**
- 换后用 harvest 拉新日指标出对比报告；若词点击仍高、广告仍 0 → 记为域名/广告位问题，移出「只换词」队列

## 8. 不做（本期）

- 跨合作商借词
- 自动改品类 / 自动从词库抽无关新品类（列表页可展示推荐，但不自动改）
- 默认全自动无人确认写回
- 把 default offer 纳入换文
- 服务端常驻 cron（当前：页面开启节奏后，本页打开期间按间隔自动跑一轮）

## 9. 验收

- [x] 选队脚本对 11-13 指标复现 P0=24，且每条有借种或明确跳过原因
- [x] 优化批次落盘含优化前快照；可 harvest 优化后并出报告
- [x] 页面 `/auto-offer-replace` 可看优化记录、条目前后对比、回收报告
- [x] 页面可配置 3 小时换文节奏（enabled / interval / 上限 / 优先级）
- [ ] 页面内勾选产文→预览→写回
- [ ] 预览→写回路径与 Offer 创编一致，replace-log 有记录
- [x] 快照可回看任意一轮队列与结果
- [x] 文档中的 RPM/RPC/二跳口径与 browse 面板一致

## 10. 开放项

1. P2 每商每轮上限：默认 2 还是 3？
2. 借种 v2 是否改为「同商 + 同品类优先，否则回退商内最高收」？
3. 全自动写回开关默认关；打开条件是否定为「连续两日 P0 下降且无误换投诉」？

---

相关产出：

- 今日优先队列：`tmp/noad-replace-report.txt` / `tmp/noad-replace-report.json`
- 优化批次：`data/ops-center/optimize-batches/`
- 二跳排查：`tmp/ref-offer-noad.json`
- 旧半自动换文说明：`docs/superpowers/specs/ARTICLE_REPLACE_OPS.md`（域名文章维度，与本 Offer 漏斗换文互补）
