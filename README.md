# Game On · 北京时间赛程表

网球、F1、电竞、足球的本周推荐与赛程，手机一屏看完。纯静态网页，部署在 GitHub Pages：https://zxy8125ss.github.io/Game-On/

## 数据怎么更新（双轨）

| 时间（北京） | 谁来做 | 做什么 |
|---|---|---|
| 07:18 / 16:48 | GitHub Actions（免费） | 结构化接口：F1、欧国联 A 级、欧冠、英超、西甲、德甲、LoL；足协网页和 WTA 出场顺序交给 Gemini 整理 |
| 07:48 / 17:18 | Claude 定时任务 | 联网复核：补赛果、核实待复核条目、亚运会/中超/网球等没有免费接口的部分，提交到本仓库 |

- Claude 复核过的条目带 `"by": "claude"`，GitHub 那一轨只给它补空缺字段，不会覆盖。
- 网页标题下显示"赛程更新于 … · Claude 复核 …"，能看出两轨各自最近一次运行。

## 切换方案

**现在：双轨运行。** 观察一到两周，看 Claude 复核的提交（提交信息以"Claude 复核"开头）里还在改什么。

**切到纯 GitHub（不需要 Claude）的条件**：亚运会结束后，Claude 的复核连续几天只是补零星赛果、没有纠错。
切换方法：在 Claude 里说"暂停 Game On 的两个定时任务"即可，GitHub 这一轨照常运行，网页标题下不再显示"Claude 复核"。

**切回双轨**：遇到大赛（奥运、亚运、世界杯）或发现数据出错时，在 Claude 里说"恢复 Game On 定时任务"。

**单轨出问题时**：
- GitHub 失败：Actions 页面会显示红叉，Claude 那一轨照常复核；修好后手动 Run workflow。
- Claude 失败：网页上的"Claude 复核"时间停住不动，GitHub 那一轨照常更新基础赛程。

## 目录

| 路径 | 作用 |
|---|---|
| `index.html` | 整个网页 |
| `data/schedule.json` | 赛程数据 |
| `data/names.json` | 外文队名/赛事名 → 中文 |
| `data/sources.json` | 交给 Gemini 整理的官方网页/PDF 列表（新赛事在这里加一条） |
| `scripts/update.mjs` | GitHub 那一轨的更新脚本 |
| `.github/workflows/update-schedule.yml` | GitHub 定时任务 |

## 配置

- Settings → Secrets and variables → Actions：`GEMINI_API_KEY`（Google AI Studio 免费 Key）。
- 可选变量 `GEMINI_MODEL`，默认 `gemini-3.6-flash`，失败自动换 `gemini-3.5-flash-lite`。

## 日常使用

- 网页上的"刷新"只是重新读取最新数据；想立刻更新，到 Actions → 更新赛程 → Run workflow。
- iPhone：Safari 打开网址 → 分享 → 添加到主屏幕。
- "加到日历"会下载 .ics 文件，点开即可加入系统日历。
