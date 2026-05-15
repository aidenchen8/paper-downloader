# Agent Runbook

这是给 agent/贡献者看的扩展说明，重点是运行假设和人工接管边界。

## 工作流

```text
DOI 或 document
  -> resolve source mode (DOI or document)
  -> extract refs from Crossref or document text
  -> if needed: resolve DOI from ref text -> link -> Crossref search
  -> classify ref route (english_doi or chinese_platform)
  -> validate each ref via Crossref and strict metadata checks
  -> english: OA-first resolver (Unpaywall/OpenAlex/S2/Europe PMC/arXiv)
  -> if OA misses: optionally try publisher direct fetch
  -> if still missing: lazily open real Chrome/Edge persistent profile
  -> with browser context: try authenticated direct PDF fetch before clicking
  -> english browser fallback: article-page selectors
  -> chinese: article link -> wanfang -> cqvip -> cnki
  -> if SSO / captcha: pause for manual handling or queue in --auto
  -> continue on per-ref errors
  -> write download_report.csv + download_summary.json + manual_intervention.*
```

## 关键设计

下载逻辑主要收束成三层：

1. 合法公开 OA 索引和仓储直下，必须通过 PDF 魔数校验
2. 可选出版商 direct fetch，默认关闭，避免无谓触发站点风控
3. 真实 Chrome / Edge 机构访问兜底，只在需要时启动
4. 同一 BrowserContext 的 request 共享登录态，先尝试候选 PDF 直连
5. 中文平台文章页搜索与严格校验
6. 人工处理学校登录、验证码或低置信匹配，然后继续

而在进入下载前，参考文献 DOI 的补全逻辑是：

1. 参考文献里已有 DOI
2. 参考文献里有文章链接，从链接页抓 DOI
3. 参考文献里没有 DOI，用题名/作者/年份等文本去 Crossref 检索

这样做的取舍是：

- 代码规模更可控，适合 skill 分发
- Chrome / Edge 跨平台支持更直接
- 对复杂出版商站点，优先减少自动化访问；确实需要时再依赖真实浏览器和人工接管配合
- 中文平台优先保证“不下错”，因此校验不通过时宁可失败
- 不做 CAPTCHA/Cloudflare/反爬绕过；挑战页只暂停给用户或在 `--auto` 下标记 `manual_pending`
- 不手工导出、注入或伪造 cookie；只复用 Playwright BrowserContext 自带的授权会话
- `manual_intervention.md` 是给人看的工作单，`manual_intervention_queue.json` 是给 agent/脚本继续处理的结构化队列

## 推荐运行方式

- 默认用 `chrome`
- 默认 `headless = false`
- OA-heavy 批次先跑 `--oa-only`，看剩余失败项再决定是否启用浏览器兜底
- 长批次可先跑 `--yes --auto`，让机器把能完成的全部完成，再把人工队列交给用户集中处理
- 首次在新学校网络环境里跑，尽量不要用 `--auto`
- 如果用户本身一直用 Edge，可以显式 `--browser msedge`

## 前人智慧如何复用

- Zotero translators 的思路是“站点专用规则优先于 generic 规则”，本项目的出版商/中文平台策略也应保持 registry 化，避免所有站点共用一个脆弱选择器。
- Zotero attachment 模型把 PDF URL、网页 snapshot、补充链接都当成结构化附件候选；本项目当前先落地 PDF 候选，后续可以把 supplementary files 和 Zotero/CSL 导出放进 manifest。
- Zotero translation-server 可以作为可选 provider：当本地或机构允许运行服务时，用它产出元数据和 PDF attachment candidates；不把它设为硬依赖，避免部署门槛变高。
- CNKI/Jasminum 类中文工具说明中文文献经常依赖文件名、平台元数据和 CAJ/PDF 格式判断；中文链路要继续坚持严格校验和人工确认，而不是盲目放宽匹配。

## 何时建议跳过

下列场景更适合直接让用户手动提供 DOI 或手动点下载：

- PDF 里根本抽不出 DOI
- 目标站点大量使用私有文档 viewer，且没有稳定 PDF link
- 中文平台只有 `CAJ` 而用户明确只接受 PDF
- 用户明确只想下载一两篇，而不是整批参考文献
