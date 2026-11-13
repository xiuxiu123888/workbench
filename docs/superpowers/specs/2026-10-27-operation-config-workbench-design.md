# 运营配置工作台

日期：2026-10-27  
修订：2026-10-28，按当前页面行为重写。

## 目的

给运营一个 Vue 3 页面：按组处理文章，复制后只改归属，生成落地页链接，再把成功的链接追加进某条运营配置的 `recentArticles`。

收入按链接里的渠道 id 统计。报表不在本期。

每一组有自己的文章 ID、可选的渠道 ID，以及必填的 ref。文章账户、网站整批共用。AFS 账户只在有文章没填渠道 ID 时才需要。

## 成功标准

- 本机用 `.env.local` 配好两个接口地址和 token 后，页面能查出运营配置。
- 每一组都会复制文章，并只把归属改成所选的文章账户和网站。标题和正文保持原样。
- 填了渠道 ID 的一组不调用 `POST /funnel/campaign/add`，用复制出来的新文章 ID 和这一组的 ref 直接拼链接。
- 没填渠道 ID 的一组会调用创建接口。页面不使用接口返回的原始长链接，而是用返回链接里的渠道号重拼短链接。
- 选中一条运营配置后，成功的链接追加到推荐文章末尾。也可以自己粘贴一条 http 链接写入。展开后的每一条链接可以直接改，或删除这一条。
- 更新只改 `recentArticles` 的内容；配置里的其他字段按详情原样提交，其中 `refList` 和 `adsType` 按下面的规则整理。
- 每一组处理完，无论成功还是失败，都写入本机 SQLite。顶栏「生成记录」打开抽屉查看。

## 不做

- 登录页、Offer 创建、`resultUrl` 拼接、分类管理、运营配置的新增和删除、收入报表。
- 不提供 MIS 添加弹窗里的 Pixel、Campaign、跟踪开关、单渠道模式、投放渠道切换、文章链接模式。这些值在需要创建投放时由页面按固定规则提交。
- 不新增、不删除整条运营配置。已有推荐文章可以改链接，也可以删除这一条。
- 生成记录不写浏览器存储。

## 技术

- Vue 3、Vite、TypeScript。
- Element Plus 负责输入框、下拉、消息、确认框、抽屉和表格。页面外壳自己写样式。
- 不引入状态库。分组校验、链接拼接、请求体组装放在纯函数里，用 Vitest 覆盖。
- 生成记录用 Node 内置 `node:sqlite`，只在开发服务里提供本机接口。数据库文件 `data/generation-log.db`，目录已加入 `.gitignore`。库为空且旁边还有旧的 `data/generation-log.json` 时，导入一次。

开发端口 `5173`。改环境变量或 Vite 配置后重启开发服务。

## 配置文件

仓库提交 `.env.example`。本机填写 `.env.local`，并写入 `.gitignore`。

```
VITE_ARTICLE_API_TARGET=http://adesmobi.com/creator-platform/back
VITE_ARTICLE_TOKEN=
VITE_MIS_API_TARGET=http://47.243.85.138/prod-api
VITE_MIS_TOKEN=
VITE_MIS_CLIENT_ID=e5cd7e4891bf95d1d19206ce24a7b32e
```

Vite 代理：

| 前缀 | 转发目标 | 路径处理 |
| --- | --- | --- |
| `/article-api` | `VITE_ARTICLE_API_TARGET` | 去掉前缀 |
| `/mis-api` | `VITE_MIS_API_TARGET` | 去掉前缀 |

任一地址或 token 为空时，不发业务请求，整页只说明要填哪些项、文件在哪、改完要重启。`ClientID` 为空也算未配置。

## 接口

文章与运营配置请求头：`Authorization: Bearer <VITE_ARTICLE_TOKEN>`。成功条件是 `code` 为 `200` 或 `0`，业务数据在 `data`。失败时展示 `msg` 或 `message`。

| 用途 | 方法与路径 |
| --- | --- |
| 网站列表 | `GET /site/getAll` |
| 文章账户 | `GET /account/getAll` |
| 复制文章 | `POST /article/copyArticle`，体为 `{ id }` |
| 文章详情 | `POST /article/detail`，体为 `{ id }` |
| 更新文章 | `POST /article/update` |
| 配置分页 | `POST /operationConfig/page`，体为 `{ pageNum, pageSize, siteId? }` |
| 配置详情 | `GET /operationConfig/detail?id=` |
| 更新配置 | `POST /operationConfig/update` |

列表读 `data.records` 和 `data.total`。网站项使用 `id`、`siteName`，域名优先 `siteUrl`，没有再用 `siteName`。网站可带 `accountId`，用来按文章账户过滤。复制成功时 `data` 是新文章 ID。

MIS 请求头：`Authorization: Bearer <VITE_MIS_TOKEN>`，以及 `ClientID: <VITE_MIS_CLIENT_ID>`。成功条件是 `code === 200`，业务数据在 `data`。失败时展示 `msg`，没有 `msg` 时展示「请求失败」。

| 用途 | 方法与路径 |
| --- | --- |
| AFS 账户 | `GET /system/dict/data/type/afs_account` |
| 创建投放 | `POST /funnel/campaign/add` |

账户字典用 `dictLabel` 显示、`dictValue` 作为提交值。创建成功时 `data` 必须是以 `http://` 或 `https://` 开头的字符串。页面只从这条链接里取渠道号：优先 `channel`，没有则用 `subid1`。

HTTP 401 提示对应 token 失效，请修改 `.env.local` 后重启。网络错误提示检查对应的接口地址。

本机生成记录只挂在开发服务上：

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `GET` | `/local-api/generation-log` | 按时间倒序返回全部记录 |
| `POST` | `/local-api/generation-log` | 插入一条记录 |
| `DELETE` | `/local-api/generation-log` | 清空数据库 |

## 页面

顶栏：标题「运营配置工作台」。配置齐全时，左侧是「生成记录 N 条」按钮；右侧是运营配置、MIS 两个状态点。地址和 token 都有值时为「已配置」，否则为「未配置」。

左侧宽 380px：

- 域名下拉来自网站列表，可清空、可搜索。查询从第 1 页开始，每页 10 条。
- 卡片显示域名、投流站或内容站、推荐文章条数。
- 选中一张卡片后请求该配置详情，用详情里的 `recentArticles` 展开。每行显示序号、完整链接、从查询参数解析出的渠道 id，以及「编辑」「删除」。未选中时，列表行自带该字段就显示条数，否则条数显示为「—」。
- 编辑时就地改成输入框，保存前校验必须是 `http://` 或 `https://`。内容没变则不请求。删除前确认。
- 展开后可以自己粘贴一条链接。换一张配置时，已生成的链接保留，未保存的编辑取消。

右侧是批量处理表单：

- 可添加多组。每组是文章 ID、渠道 ID、ref。渠道 ID 可空。
- 整批共用文章账户和网站。选了文章账户后，网站只列出该账户下的站点。
- 只要有一组没填渠道 ID，就要选择 AFS 账户。

底部固定结果栏：说明已生成几条，可以复制全部成功链接，按钮文案为「追加 N 条」。未生成时说明先复制并生成链接。

底色 `#f4f5f7`，主文字 `#1c2430`，主按钮 `#1677ff`。链接和渠道 id 使用等宽字体。写入成功后，新追加的行用浅黄背景停留约 2 秒。

## 一组文章怎么处理

空组丢掉：文章 ID、渠道 ID、ref 都是空白才算空组。至少要有一组。

校验：

- 每一组都要有文章 ID，且是纯数字，同一批不能重复。
- 每一组都要有 ref。ref 保留用户输入的首尾空格，不trim。
- 渠道 ID 可空。填了就必须是纯数字。
- 文章账户、网站必填。网站没有域名时不能提交。
- 存在没填渠道 ID 的组时，AFS 账户必填。

按组顺序处理。某一组失败只记在这一组上，继续下一组。失败行出现「重试」，只重跑这一组。已经复制出新文章 ID 的，不再复制，从更新归属继续；还没有新文章 ID 的，从头复制。重试成功后，这条链接并进可写入的结果，其他组保持不变。重试同样写入一条生成记录。

每一组都先做这两步：

1. `POST /article/copyArticle`，拿到新文章 ID。
2. `POST /article/detail` 读复制结果，再 `POST /article/update`。只改 `accountId` 和 `siteId`。分类取数组最后一项。正文里第一张图片的地址写入 `image`。标题、正文和其他内容字段保持详情原样。

然后分两条路。

### 填了渠道 ID

不再调用 `POST /funnel/campaign/add`。用新文章 ID、用户填的渠道 ID、这一组的 ref，以及所选网站的域名拼链接：

```
https://域名/detail/新文章ID?subid1=渠道ID&subid2=新文章ID&channel=渠道ID&rType=2&ref=这一组的ref
```

域名优先用网站的 `siteUrl`，没有再用 `siteName`。没有协议时补 `https://`。`rType` 固定为 `2`。ref 里的空格写成 `+`，末尾空格保留。

### 没填渠道 ID

调用 `POST /funnel/campaign/add`。投放标题就是这一组的 ref，不 trim。其余固定为：

```
source = 所选 AFS 账户
articleId = 新文章 ID
siteName = 所选网站域名
investTitle = 这一组的 ref
investChannel = TikTok
rType = 2
singleChannelMode = false
subid2 = 新文章 ID
subid3 = {data-campaign}
subid4 = {data-campaign_name}
subid5 = {data-adgroup_id}
subid6 = {data-creative_id}
subid7 = {data-account_id}
```

不提交 Pixel 和 Campaign 名称。不调用 Offer 创建。

创建返回的长链接只用来取渠道号。写入和展示的是重拼后的短链接：

```
https://域名/detail/新文章ID?subid1=渠道号&subid2=新文章ID&partner=TikTok&rType=2&ref=这一组的ref&channel=渠道号
```

返回链接里没有渠道号时，这一组记为失败。

## 写入运营配置

生成成功的链接可以整批追加。选中配置后，也可以粘贴一条 `http://` 或 `https://` 链接，走同一条写入。

已有推荐文章可以单独编辑或删除。编辑保存的是新链接；删除拿掉这一条。两者都先重新读取详情。如果该下标上的链接已经不是刚才看到的那条，就中止并提示列表已变化。

追加写入前确认框写明条数，并列出链接。超过 8 条时只展示前 8 条，并说明其余一并追加。删除前确认框写明序号和原链接。取消则不请求。

确认后：

1. `GET /operationConfig/detail?id=`。
2. `recentArticles` 整理成 URL 字符串数组。字符串直接使用；对象取 `url`；空值丢掉。详情若把该字段做成 JSON 字符串，先解析再整理。
3. 追加时把新链接放到末尾。编辑时替换对应下标。删除时去掉对应下标。
4. `refList` 提交为 `{ tagId, categoryIds }`。`categoryIds` 只保留数字：优先取 `categoryInfoList[].categoryId`；没有该列表时使用已有 `categoryIds`，其中若某一项是数组，则取数组最后一项。`refList` 不是数组时提交空数组。
5. `adsType` 已是字符串则原样提交；是数组则 `JSON.stringify`。
6. 其余详情字段原样放进 `POST /operationConfig/update`。

成功后重新拉取当前配置详情和列表，高亮刚写入的行，并提示成功。失败时已生成的链接保留。清空生成记录不会改已经写入的运营配置。

## 生成记录

顶栏按钮打开抽屉，宽度约为视口的 92%。表格列：时间、原文章 ID、新文章 ID、标题、ref、网站、文章账户、AFS、渠道、链接、状态。

可以按文章 ID、标题、ref、渠道、网站、账户、链接或失败原因搜索。链接可以单独复制。状态成功显示「完成」，失败显示错误信息。

清空前要确认。确认后只删除 `data/generation-log.db` 里的记录。

每一组结束就立刻写入一条，成功和失败都记。多组同时完成时按顺序插入，避免后写的把先写的盖掉。渠道号从最终链接解析。ref 原样保存。

## 测试

纯函数用 Vitest：

- 分组校验：空组忽略、ref 保留末尾空格、文章 ID 和渠道 ID 必须是纯数字、文章 ID 不能重复。
- 没填渠道 ID 时，创建请求体包含 TikTok、`rType = 2` 和 subid 模板；短链接参数顺序为 `subid1`、`subid2`、`partner`、`rType`、`ref`、`channel`。
- 填了渠道 ID 时，短链接参数顺序为 `subid1`、`subid2`、`channel`、`rType`、`ref`，ref 的空格变成 `+`。
- 渠道号优先取 `channel`，没有则取 `subid1`。
- 文章更新体只改账户和网站，并保留标题、正文。
- `recentArticles` 从字符串、对象、JSON 字符串整理成 URL 数组；一次追加多条，并标出新下标。替换或删除某一条时不改原数组；下标或原链接对不上时中止。
- `refList`、`adsType` 的提交整理。
- 生成记录保留 ref 原文，并从链接解析渠道；搜索能命中标题、ref 和渠道。
- SQLite 按时间倒序读写，清空后为空；旧 JSON 只在库为空时导入一次。

页面在浏览器里核对：未配置环境变量时的说明、选配置、分组表单、有渠道 ID 时不调用创建投放、追加确认文案、生成记录抽屉。没有可用 token 时，不把接口失败说成页面已完成。复制文章和创建投放会改生产数据，核对界面时不要为了看效果去点真正提交。


8487306165  joyfulgaminghub9.com

7563381316 playfulviibes.com

7346138321 minigamemix.com

6844377770 laidbackgam.com

6507123661 jubilantsphere.com

6347949094 zestfularcade.com

6253454054 fluxpaid.com

5949606886 zestfularcade.com（日语）
