# paper-downloader

> 用真实 Chrome / Edge 登录态批量下载一篇论文的参考文献 PDF。

这个 skill 的重点是：

- 默认面向 `Chrome`
- 兼容 `macOS` 和 `Windows`
- 支持 DOI 和本地文档两种入口
- 支持中英文混合参考文献一次处理
- 保留“提取参考文献 + 补 DOI + 真实浏览器会话下载”的基本工作流
- 新增合法 OA-first 下载链路，公开 PDF 不再默认进入 RPA
- 新增人机协作队列：后台跑完，卡住项集中交给人类处理
- 适合 agent skill 直接调用，也适合手工命令行运行

## 当前范围

这版优先保证主链路可用：

- DOI 输入
- 本地文档输入：`pdf`、`docx`、`txt`、`md`、`html`、`htm`、`rtf`
- 从文档里提取参考文献列表
- 逐条解析 DOI、文章链接、标题/作者/年份等信息
- 英文文献走 DOI / 出版商下载链路
- 中文文献走平台保守链路：文章链接 -> 万方 -> 维普 -> 知网
- 英文 DOI 优先走公开开放获取链路：Unpaywall -> OpenAlex -> Semantic Scholar -> Europe PMC/PMC -> arXiv
- 用 Crossref 做引用提取、元数据校验与 DOI 补全
- 只有 OA 链路没有可验证 PDF 时，才使用真实 Chrome / Edge profile 作为机构访问兜底
- 启动浏览器后优先用同一 BrowserContext 的登录态直接请求 PDF，减少无谓点击
- 学校 SSO / 验证码页面的人工接管
- `--auto` 后台运行会把卡住项写入 `manual_intervention.md` / `manual_intervention_queue.json`
- 单条失败不会中断整批任务，最后会输出下载汇总

当前边界：
- 目前主要覆盖主 PDF 下载，不包含 supplementary files
- 文档参考文献提取是启发式的，对版式很差的 PDF 可能不稳定
- 下载策略以通用 PDF 链接、文章页按钮和人工接管为主
- 不绕过 Cloudflare、验证码或网站访问控制；遇到挑战页只会暂停交给用户处理或标记 `manual_pending`
- 中文平台当前坚持严格匹配，不满足标题/作者/年份校验时会直接跳过
- 如果中文平台只提供 `CAJ` 而没有稳定 PDF，这版会报告失败，不会误存成 PDF

## 安装

```bash
cd /path/to/paper-downloader
npm install
cp config.example.json config.local.json
```

然后编辑 `config.local.json`，至少改这几个字段：

```json
{
  "crossref": {
    "mailto": "you@example.com"
  },
  "openAccess": {
    "unpaywallEmail": "you@example.com"
  },
  "browser": {
    "channel": "chrome",
    "profileDirectory": "Default"
  }
}
```

如果不是默认浏览器资料目录，再加：

- `browser.userDataDir`
- `browser.executablePath`

## 使用

### 一条命令跑完整流程

```bash
node scripts/run-paper-downloader.mjs 10.1021/jacs.5c05017
```

### 输入本地文档

```bash
node scripts/run-paper-downloader.mjs "/path/to/paper.pdf"
```

```bash
node scripts/run-paper-downloader.mjs "/path/to/paper.docx"
```

### 使用 Edge 而不是 Chrome

```bash
node scripts/run-paper-downloader.mjs 10.1021/jacs.5c05017 --browser msedge
```

### 非交互模式

```bash
node scripts/run-paper-downloader.mjs 10.1021/jacs.5c05017 --yes --auto
```

`--auto` 适合后台尽量跑完：遇到学校登录、验证码、Cloudflare 或需要人工判断的项时，不阻塞整批任务，而是写入人工介入队列。

### 只下载公开 OA PDF，不启动浏览器

```bash
node scripts/run-paper-downloader.mjs 10.1038/s41586-020-2649-2 --yes --oa-only
```

## 输出结构

```text
<output-dir>/
├── <project-name>/
│   ├── refs_raw.json
│   ├── refs_validated.json
│   ├── download_report.csv
│   ├── download_summary.json
│   ├── manual_intervention.md
│   ├── manual_intervention_queue.json
│   ├── project_meta.json
│   └── *.pdf
└── runs/
    └── <timestamp>-round-01/
        ├── events.jsonl
        └── downloads/
```

## 配置说明

`config.local.json` 支持这些部分：

- `crossref.mailto`
  Crossref polite pool 用的邮箱。
- `browser.channel`
  默认 `chrome`，也支持 `msedge`。
- `browser.userDataDir`
  浏览器用户数据目录。留空时自动推断常见的 macOS / Windows 默认路径。
- `browser.profileDirectory`
  profile 名称，通常是 `Default` 或 `Profile 1`。
- `browser.executablePath`
  可选，自定义浏览器可执行文件路径。
- `browser.disableExtensions`
  调试时可关扩展。
- `browser.headless`
  默认为 `false`，因为学校登录和验证码通常需要真实可见浏览器。
- `openAccess.enabled`
  默认为 `true`。开启后会先查合法开放获取来源，命中并通过 PDF 魔数校验后直接保存。
- `openAccess.providers`
  默认 `["unpaywall", "openalex", "semantic_scholar", "europepmc", "arxiv"]`。
- `openAccess.unpaywallEmail`
  Unpaywall API 推荐的联系邮箱。留空时会复用 `crossref.mailto`。
- `openAccess.openalexApiKey`
  可选。OpenAlex 免费 API key；不填时尽量用 `mailto` 走公共访问。
- `openAccess.semanticScholarApiKey`
  可选。Semantic Scholar API key；不填也可尝试公共限额。
- `download.browserFallback`
  默认为 `true`。设为 `false` 或使用 `--oa-only` / `--skip-browser` 时不会启动浏览器。
- `download.publisherDirectFetch`
  默认为 `false`。开启后，OA 失败但浏览器前会尝试出版商直链 fetch；这可能增加对出版商站点的请求。
- `download.authenticatedDirectFetch`
  默认为 `true`。进入真实浏览器兜底后，优先使用同一个 BrowserContext 的登录态请求候选 PDF，类似“浏览器已登录，后台用同一会话取附件”，避免不必要的页面按钮点击。
- `download.manualInterventionQueue`
  默认为 `true`。每轮下载都会输出人工介入队列，方便后台自动跑完后集中处理卡住项。
- `download.directRequestDelayMs`、`download.browserAttemptDelayMs`、`download.itemDelayMs`
  控制请求与浏览器尝试之间的等待时间，默认偏保守，减少批量访问压力。
- `institution.authHosts`
  学校 SSO 域名列表。
- `institution.authUrlFragments`
  SSO URL 片段。
- `institution.authPageTitles`
  SSO 页面标题关键词。
- `institution.authLoadingTitles`
  学校登录时的中间加载页标题关键词。
- `institution.ignoredAccessDois`
  已知不想重试的 DOI。

## 文档模式怎么工作

当输入是文档时，处理顺序是：

1. 从文档文本中定位 `References` / `参考文献` 一类的章节
2. 拆成单条参考文献
3. 每条先看有没有 DOI
4. 没有 DOI 就看有没有文章链接，并尝试从链接页抓 DOI
5. 还没有就拿参考文献文本去 Crossref 做 bibliographic search
6. 判断文献是英文路由还是中文平台路由
7. 英文文献按 DOI/出版商链路下载
8. 英文文献先查公开 OA 索引并直接下载可验证 PDF
9. OA 没有命中时，可选尝试出版商直链
10. 进入机构浏览器兜底后，先用浏览器登录态做候选 PDF 直连请求
11. 直连仍失败时，才按 DOI/出版商页面选择器点击
12. 中文文献优先按原始文章链接，再按 `万方 -> 维普 -> 知网` 搜索
13. 每个候选页面都先做严格校验，校验不过就不下载

## 校验与汇总

- 这版默认是“宁可没下到，也不下错”。
- 中文平台候选页必须通过严格匹配，至少以题名为核心，并拒绝明显的作者/年份冲突。
- 任意一条参考文献失败时，任务会继续跑完其他条目。
- 最终结果同时写到：
  - `download_report.csv`
  - `download_summary.json`

`download_summary.json` 会列出：

- 哪些已经下载或已存在
- 哪些没下载
- 每条没下载的原因，例如 `platform_search_no_candidate`、`strict_match_not_met`、`manual_pending`
- 需要人工处理的队列路径

## 运行习惯

- 运行前请把 Chrome / Edge 全部关掉，不然 profile 会被锁住。
- 第一次跑建议用交互模式，不要加 `--auto`。
- 遇到学校登录或验证码时，直接在弹出的真实浏览器窗口里完成，再回终端按回车继续。
- 如果主要目标是 OA 文献，优先用 `--oa-only` 跑一轮；剩余失败项再开启浏览器兜底。
- 如果希望无人值守先跑完，用 `--yes --auto`。结束后看 `manual_intervention.md`，处理完登录/验证/人工判断后重新运行同一命令即可，已有 PDF 会自动跳过。

## 人机协作模式

这版把下载任务拆成两个节奏：

1. 机器后台尽量完成：OA 索引、公开仓储、出版商模板、登录态直连、页面候选链接。
2. 人类只处理真正需要判断的少数项：SSO、验证码、Cloudflare、人眼确认中文平台匹配、CAJ/PDF 取舍。

人工队列文件：

- `manual_intervention.md` 给人看，包含题名、原因、可打开链接和建议动作。
- `manual_intervention_queue.json` 给后续 agent 或脚本看，结构化记录每个卡住项。

安全边界：

- 不手工导出、注入或伪造 cookie。
- 不绕过 CAPTCHA、Cloudflare、SSO 或出版商访问控制。
- 只复用用户已经授权打开的真实浏览器上下文；如果站点要求人类确认，就暂停或排队。

## OA-first 方案参考

这次优化借鉴了社区里常见的 free-first / OA-first 下载链路：先查合法开放获取索引与仓储，验证 PDF 后保存，只有没有公开版本时才进入机构访问或浏览器兜底。

- [Unpaywall REST API](https://support.unpaywall.org/support/solutions/articles/44001874811-link-resolver-integrations)：按 DOI 返回 OA 位置和直接 PDF URL。
- [OpenAlex Works API](https://developers.openalex.org/api-reference/works/list-works)：`best_oa_location` / `locations` 中包含 OA PDF URL。
- [Semantic Scholar Academic Graph API](https://webflow.semanticscholar.org/product/api/tutorial)：`openAccessPdf` 可提供公开 PDF。
- [Europe PMC RESTful API](https://europepmc.org/RestfulWebService)：生命科学方向可查开放全文、PMCID 和全文链接。
- [openags/paper-search-mcp](https://github.com/openags/paper-search-mcp)：社区项目也采用 public sources first、OA fallback chain 的设计。

## 社区工具启发

- [Zotero translators](https://www.zotero.org/support/dev/translators/coding) 的核心启发是：站点专用规则优先于 generic 规则，并把 PDF attachment 作为结构化候选保存。
- [Zotero translation-server](https://github.com/zotero/translation-server) 证明 translator 规则可以脱离 Zotero 客户端运行；后续可把它作为可选元数据/候选链接 provider，而不是重写所有站点规则。
- [Playwright APIRequestContext](https://playwright.dev/docs/api/class-apirequestcontext) 明确支持 BrowserContext 与 request 共享 cookie，这正适合“人类登录一次，后台合法复用同一会话下载附件”的协作模式。
- [Jasminum](https://github.com/Pretty-M/-jasminum) 这类中文 Zotero 插件提醒我们：中文文献组织不能只看 DOI，文件名、CNKI 元数据、核心期刊/引用信息也很重要；本项目先把这些沉淀为严格校验和人工队列。

## 作为 skill 使用

如果你的 agent 支持目录型 skill，把当前目录作为 skill 目录即可。入口说明见 [SKILL.md](SKILL.md)。
