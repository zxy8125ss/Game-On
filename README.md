# Game On · 北京时间赛程表

网球、F1、电竞、足球的本周推荐与赛程，手机一屏看完。纯静态网页，部署在 GitHub Pages；赛程由 GitHub Actions 每天调用 Gemini（Google 搜索）核对后自动更新。

## 目录

| 路径 | 作用 |
|---|---|
| `index.html` | 整个网页（样式、脚本都在里面） |
| `data/schedule.json` | 赛程数据，网页每次打开时读取 |
| `scripts/update.mjs` | 调用 Gemini 核对赛程、合并改动的脚本 |
| `.github/workflows/update-schedule.yml` | 定时任务：每天北京时间 07:18、16:48 运行 |
| `fonts/`、`icons/`、`manifest.webmanifest` | 字体、图标、添加到主屏幕用的配置 |

## 一次性配置

1. **开启网站**：仓库 Settings → Pages → Build and deployment → Source 选 `Deploy from a branch`，Branch 选 `main`、目录 `/ (root)`，保存。1–2 分钟后访问 `https://zxy8125ss.github.io/game-on/`。
2. **申请 Gemini Key**：打开 Google AI Studio（aistudio.google.com）→ Get API key → Create API key，复制下来。
3. **填入 Key**：仓库 Settings → Secrets and variables → Actions → New repository secret，Name 填 `GEMINI_API_KEY`，Secret 粘贴刚才的 Key。
4. **试运行**：仓库 Actions → 更新赛程 → Run workflow。成功后 `data/schedule.json` 会多一次"更新赛程"提交，网页标题下的更新时间随之变化。

可选：在 Settings → Secrets and variables → Actions → Variables 新建 `GEMINI_MODEL`，换用其他模型（默认 `gemini-3.8-flash`）。

## 日常使用

- 网页上的"刷新"只是重新读取最新数据；想立刻核对一次，到 Actions 里手动 Run workflow（GitHub 手机 App 也能操作）。
- 关注、已看、提醒等设置保存在各自手机的浏览器里。
- iPhone：Safari 打开网址 → 分享 → 添加到主屏幕。
- "加到日历"会下载 .ics 文件，iPhone 上点开即可加入系统日历，带开赛前提醒。

## 数据更新的安全措施

- Gemini 只返回"改动清单"（新增/修改/删除），不整份覆盖。
- 每条改动都会校验格式，不合格的跳过；单次最多删除 6 场；30 天前的旧场次自动清理。
- 来源规则写在 `scripts/update.mjs` 的提示词里：官方 > 主流媒体 > 知名专业自媒体 > 聚合稿，来源不足的标"待复核"。要调整关注范围或规则，直接改这段文字即可。
