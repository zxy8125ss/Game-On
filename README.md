# Game On · 北京时间赛程表

网球、F1、电竞、足球的本周推荐与赛程，手机一屏看完。纯静态网页，部署在 GitHub Pages；赛程由 GitHub Actions 每天自动更新，全部用免费资源：

- **结构化接口直接生成**：F1（Jolpica/Ergast）、UEFA 官方接口（欧国联 A 级、欧冠）、ESPN（英超/西甲/德甲焦点战、中超）、LoL 电竞官方接口
- **官方网页交给 Gemini 整理**（不带搜索，免费额度即可）：中国足协各级国家队页面、WTA 签表与出场顺序 PDF，清单在 `data/sources.json`
- **队名翻译**：Gemini 翻译后缓存在 `data/names.json`，可手动修改

## 目录

| 路径 | 作用 |
|---|---|
| `index.html` | 整个网页（样式、脚本都在里面） |
| `data/schedule.json` | 赛程数据，网页每次打开时读取 |
| `scripts/update.mjs` | 抓取各来源、合并赛程的脚本 |
| `data/sources.json` | 交给 Gemini 整理的官方网页/PDF 清单 |
| `data/names.json` | 外文队名 → 中文译名 |
| `.github/workflows/update-schedule.yml` | 定时任务：每天北京时间 07:18、16:48 运行 |
| `fonts/`、`icons/`、`manifest.webmanifest` | 字体、图标、添加到主屏幕用的配置 |

## 一次性配置

1. **开启网站**：仓库 Settings → Pages → Build and deployment → Source 选 `Deploy from a branch`，Branch 选 `main`、目录 `/ (root)`，保存。1–2 分钟后访问 `https://zxy8125ss.github.io/game-on/`。
2. **申请 Gemini Key**：打开 Google AI Studio（aistudio.google.com）→ Get API key → Create API key，复制下来。
3. **填入 Key**：仓库 Settings → Secrets and variables → Actions → New repository secret，Name 填 `GEMINI_API_KEY`，Secret 粘贴刚才的 Key。
4. **试运行**：仓库 Actions → 更新赛程 → Run workflow。成功后 `data/schedule.json` 会多一次"更新赛程"提交，网页标题下的更新时间随之变化。

默认使用免费额度可用的 gemini-3.6-flash（失败时再试 3.5-flash-lite）。也可以在 Settings → Secrets and variables → Actions → Variables 新建 `GEMINI_MODEL` 指定优先使用的模型。你的各模型免费额度见 https://aistudio.google.com/rate-limit 。

## 日常使用

- 网页上的"刷新"只是重新读取最新数据；想立刻核对一次，到 Actions 里手动 Run workflow（GitHub 手机 App 也能操作）。
- 关注、已看、提醒等设置保存在各自手机的浏览器里。
- iPhone：Safari 打开网址 → 分享 → 添加到主屏幕。
- "加到日历"会下载 .ics 文件，iPhone 上点开即可加入系统日历，带开赛前提醒。

## 数据更新的安全措施

- 每个来源独立处理：某个接口失败只跳过它，旧数据保留，Actions 日志里会列出各来源结果。
- Gemini 只整理你指定的官方页面内容，不凭记忆补充；输出逐条校验格式，只允许改 `cn-`（国足各级）和 `ten-`（网球）开头的条目。
- 30 天前的旧场次自动清理；手动维护的条目（如亚运会）不会被自动来源覆盖。
- 新赛事（如武网）需要在 `data/sources.json` 里加上它的 WTA 出场顺序 PDF 地址。
