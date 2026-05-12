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
  -> open real Chrome/Edge persistent profile
  -> english: try direct PDF URL -> article-page selectors
  -> chinese: article link -> wanfang -> cqvip -> cnki
  -> if SSO / captcha: pause for manual handling
  -> continue on per-ref errors
  -> write download_report.csv + download_summary.json
```

## 关键设计

下载逻辑主要收束成三层：

1. 英文 DOI / 出版商 PDF URL
2. 中文平台文章页搜索与严格校验
3. 文章页上的 PDF 链接和按钮
4. 人工处理学校登录或验证码，然后继续

而在进入下载前，参考文献 DOI 的补全逻辑是：

1. 参考文献里已有 DOI
2. 参考文献里有文章链接，从链接页抓 DOI
3. 参考文献里没有 DOI，用题名/作者/年份等文本去 Crossref 检索

这样做的取舍是：

- 代码规模更可控，适合 skill 分发
- Chrome / Edge 跨平台支持更直接
- 对复杂出版商站点，更多依赖真实浏览器和人工接管配合
- 中文平台优先保证“不下错”，因此校验不通过时宁可失败

## 推荐运行方式

- 默认用 `chrome`
- 默认 `headless = false`
- 首次在新学校网络环境里跑，尽量不要用 `--auto`
- 如果用户本身一直用 Edge，可以显式 `--browser msedge`

## 何时建议跳过

下列场景更适合直接让用户手动提供 DOI 或手动点下载：

- PDF 里根本抽不出 DOI
- 目标站点大量使用私有文档 viewer，且没有稳定 PDF link
- 中文平台只有 `CAJ` 而用户明确只接受 PDF
- 用户明确只想下载一两篇，而不是整批参考文献
