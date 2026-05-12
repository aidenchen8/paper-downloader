# paper-downloader

> 用真实 Chrome / Edge 登录态批量下载一篇论文的参考文献 PDF。

这个 skill 的重点是：

- 默认面向 `Chrome`
- 兼容 `macOS` 和 `Windows`
- 支持 DOI 和本地文档两种入口
- 支持中英文混合参考文献一次处理
- 保留“提取参考文献 + 补 DOI + 真实浏览器会话下载”的基本工作流
- 适合 agent skill 直接调用，也适合手工命令行运行

## 当前范围

这版优先保证主链路可用：

- DOI 输入
- 本地文档输入：`pdf`、`docx`、`txt`、`md`、`html`、`htm`、`rtf`
- 从文档里提取参考文献列表
- 逐条解析 DOI、文章链接、标题/作者/年份等信息
- 英文文献走 DOI / 出版商下载链路
- 中文文献走平台保守链路：文章链接 -> 万方 -> 维普 -> 知网
- 用 Crossref 做引用提取、元数据校验与 DOI 补全
- 使用真实 Chrome / Edge profile 下载主 PDF
- 学校 SSO / 验证码页面的人工接管
- 单条失败不会中断整批任务，最后会输出下载汇总

当前边界：
- 目前主要覆盖主 PDF 下载，不包含 supplementary files
- 文档参考文献提取是启发式的，对版式很差的 PDF 可能不稳定
- 下载策略以通用 PDF 链接、文章页按钮和人工接管为主
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

## 输出结构

```text
<output-dir>/
├── <project-name>/
│   ├── refs_raw.json
│   ├── refs_validated.json
│   ├── download_report.csv
│   ├── download_summary.json
│   ├── project_meta.json
│   └── *.pdf
└── runs/
    └── <timestamp>-round-01/
        ├── events.jsonl
        └── downloads/
```

## 配置说明

`config.local.json` 支持三部分：

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
8. 中文文献优先按原始文章链接，再按 `万方 -> 维普 -> 知网` 搜索
9. 每个候选页面都先做严格校验，校验不过就不下载

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

## 运行习惯

- 运行前请把 Chrome / Edge 全部关掉，不然 profile 会被锁住。
- 第一次跑建议用交互模式，不要加 `--auto`。
- 遇到学校登录或验证码时，直接在弹出的真实浏览器窗口里完成，再回终端按回车继续。

## 作为 skill 使用

如果你的 agent 支持目录型 skill，把当前目录作为 skill 目录即可。入口说明见 [SKILL.md](SKILL.md)。
