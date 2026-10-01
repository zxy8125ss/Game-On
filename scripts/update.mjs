// Game On 赛程自动更新脚本
// 由 GitHub Actions 定时运行：调用 Gemini API（Google 搜索），按规则核对赛程，生成"改动清单"后合并进 data/schedule.json。
// 只依赖 Node 20 自带的 fetch，无需安装任何包。
import fs from 'node:fs';

const FILE = 'data/schedule.json';
const KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const MAX_DELETES = 6;           // 单次运行最多删除场次数，防止一次错误输出冲掉数据
const H = 3600e3, DAY = 24 * H, TZ = 8 * H;

if (!KEY) { console.error('缺少 GEMINI_API_KEY（在仓库 Settings → Secrets and variables → Actions 中添加）'); process.exit(1); }

const doc = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const now = Date.now();
const bjIso = ms => new Date(ms + TZ).toISOString().replace('Z', '+08:00').replace(/\.\d{3}/, '');
const startOf = m => Date.parse((m.bj ? m.bj.replace(' ', 'T') : m.date + 'T00:00') + ':00+08:00');

// 只把相关窗口内的场次发给模型（过去 3 天到未来 21 天），减少输入长度
const windowed = doc.matches.filter(m => { const t = startOf(m); return t > now - 3 * DAY && t < now + 21 * DAY; });

const RULES = `
你是一个体育赛程数据维护员。现在是北京时间 ${bjIso(now)}。请用 Google 搜索核对并更新下列赛程数据，只输出 JSON。

## 关注范围（只维护这些）
- 中国男足各级国家队（重点）：国家队、U23/亚运队、U20、U19、U17、U16、U15 的正式比赛、邀请赛、友谊赛、青年赛事。必须写 squad 字段（国家队 / U23 亚运队 / U17 等）。
- 综合性运动会（亚运会、奥运会、全运会）期间：中国网球选手的比赛（重点半决赛、决赛、奖牌战）；足球奖牌战（不论是否有中国队）。
- 网球：郑钦文的所有正赛。
- F1：每站冲刺赛、排位赛、正赛。
- 英雄联盟：LPL 各队在全球总决赛（S16）的比赛；对阵公布后写清对手。
- 足球：英超焦点战（曼城、利物浦、阿森纳、曼联、切尔西、热刺相关，每轮最多 3 场）、西甲巴萨/皇马、德甲拜仁/多特焦点战、欧冠焦点战、中超每轮焦点战；国际比赛周的欧国联 A 级全部场次（id 前缀 unl-）。

## 数据源规则（每条写入前都要过一遍）
1. 来源等级：A 级=官方（中国足协 thecfa.cn、亚足联、亚奥理事会 oca.asia、UEFA、FIFA、WTA/ATP 与赛事官网及其签表/出场顺序 PDF、formula1.com、lolesports.com、各联赛与俱乐部官网）；B 级=新华社、央视、人民网、中新社、ESPN、BBC、Reuters、AP、Sky Sports；B- 级=垂直领域长期跟踪的知名专业自媒体（网球如"克母鸡"）；C 级=聚合稿与内容农场（新浪"一文看懂"/"热点小时报"、网易号、搜狐号、百家号、微博个人号）——C 级只能当线索。
2. 看发布日期并与事件日期对比：赛程会调整、对手会退出替换，以发布最晚的 A/B 级来源为准；比赛前发布的文章不能当赛果来源。
3. 写入规则：有 A 级直接写；否则需两个独立 B 级一致，或一个 B 级加一个 B- 级一致；只有单一 B- 级、只有 C 级或来源矛盾时，写入但加 "verify":"pending"，并在 note 写明待复核原因；不要猜。
4. 合理性检查：时差换算是否合理；同一队伍不能同时出现在两地；选手/球队是否仍在赛事中。欧洲夏令时到 10 月最后一个周日结束（之前 20:45 CEST=北京时间次日 02:45，之后 20:45 CET=次日 03:45）；美国夏令时到 11 月第一个周日结束。
5. 优先复核带 verify:"pending" 的条目；确认后在 upsert 中去掉 verify 并改写 note，note 与 verify 不得矛盾。
6. 比分 result 只能来自 A 或 B 级来源。

## 要做的事
- 核对未来 14 天场次的开赛时间（北京时间）；过去 36 小时结束的场次补 result；时间未公布(date)的已公布则改为 bj；对阵已定的去掉 tbdTeams 并更新 title/teams；补入未来 14 天新公布且在关注范围内的场次；官方取消或球队退出的场次删除。

## 数据格式（每场比赛）
{"id":"稳定唯一，已有的绝不改名","sport":"tennis|f1|lol|football","squad":"仅中国男足各级","sub":"赛事与轮次","title":"对阵或场次","teams":["参赛方全名；中国队写 中国/中国U23 等；F1 留空"],"bj":"YYYY-MM-DD HH:mm 北京时间（已确认时）","date":"YYYY-MM-DD（仅时间未公布时，此时不要 bj）","dur":分钟数,"result":"完赛比分（可选）","note":"可选","channels":["可选"],"tbdTeams":true,"verify":"pending"}

## 输出（只输出一个 JSON 对象，不要任何解释文字，不要代码块标记）
{"note":"一句话总结本次改动","changes":[{"op":"upsert","match":{完整的比赛对象}},{"op":"delete","id":"...","reason":"取消/退出的依据"}]}
没有改动就输出 {"note":"无变化","changes":[]}。

## 当前数据（窗口内）
${JSON.stringify(windowed)}
`;

// 依次尝试的模型：先用仓库变量 GEMINI_MODEL 指定的，再按顺序退到免费额度通常可用的型号
const MODELS = [...new Set([MODEL, 'gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3-flash-preview'].filter(Boolean))];

async function callGemini() {
  const body = { contents: [{ role: 'user', parts: [{ text: RULES }] }], tools: [{ google_search: {} }], generationConfig: { temperature: 0.2 } };
  const tried = [];
  for (const model of MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY }, body: JSON.stringify(body) });
      if (r.ok) {
        const j = await r.json();
        const text = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
        if (text.trim()) { console.log(`使用模型：${model}`); return text; }
        console.error(`${model} 返回为空：${JSON.stringify(j).slice(0, 300)}`);
        break;
      }
      const t = await r.text();
      const msg = (() => { try { return JSON.parse(t).error?.message || t; } catch { return t; } })();
      console.error(`${model} 请求失败（${r.status}）：${String(msg).slice(0, 200)}`);
      tried.push(`${model}: ${r.status}`);
      // 额度为 0 / 模型不可用 / 参数不支持：直接换下一个模型；服务器临时错误：等一下重试一次
      if (r.status >= 500 && attempt === 1) { await new Promise(res => setTimeout(res, 20000)); continue; }
      break;
    }
  }
  // 诊断：不带搜索再试一次，区分"整个 Key 没额度"和"免费额度不含搜索"
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent', { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY }, body: JSON.stringify({ contents: [{ parts: [{ text: '回复 OK' }] }] }) });
    console.error(r.ok ? '诊断：不带 Google 搜索的请求可以成功 → 你的免费额度不包含"搜索增强"，需要在 AI Studio 开通结算（按量付费）才能用搜索。' : `诊断：不带搜索的请求也失败（${r.status}）→ 这个 API Key 本身没有可用额度，请检查 Key 所在项目。`);
  } catch (e) { console.error('诊断请求出错：', e.message); }
  throw new Error('所有模型都不可用：' + tried.join('；') + '。请到 https://aistudio.google.com/rate-limit 查看你的免费额度，或在仓库变量 GEMINI_MODEL 指定一个有额度的模型。');
}

function parseJson(text) {
  const s = text.replace(/```json|```/g, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('输出中没有 JSON');
  return JSON.parse(s.slice(a, b + 1));
}

const SPORTS = new Set(['tennis', 'f1', 'lol', 'football']);
function valid(m) {
  if (!m || typeof m !== 'object') return '不是对象';
  if (!/^[a-z0-9][a-z0-9-]{2,60}$/.test(m.id || '')) return 'id 格式不对';
  if (!SPORTS.has(m.sport)) return 'sport 不对';
  if (!m.title || typeof m.title !== 'string') return '缺 title';
  if (m.bj && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(m.bj)) return 'bj 格式不对';
  if (!m.bj && !/^\d{4}-\d{2}-\d{2}$/.test(m.date || '')) return '缺 bj/date';
  if (m.bj && m.date) delete m.date;
  if (!Array.isArray(m.teams)) m.teams = [];
  if (typeof m.dur !== 'number' || m.dur < 15 || m.dur > 720) m.dur = 120;
  if (m.verify && m.verify !== 'pending') delete m.verify;
  if (m.squad && m.sport !== 'football') delete m.squad;
  const t = startOf(m);
  if (isNaN(t)) return '日期无法解析';
  if (t < now - 40 * DAY || t > now + 120 * DAY) return '日期超出合理范围';
  return null;
}

const out = parseJson(await callGemini());
const byId = new Map(doc.matches.map(m => [m.id, m]));
let up = 0, add = 0, del = 0, skipped = 0;
for (const c of out.changes || []) {
  if (c.op === 'upsert') {
    const why = valid(c.match);
    if (why) { skipped++; console.warn('跳过无效条目：', why, JSON.stringify(c.match).slice(0, 200)); continue; }
    if (byId.has(c.match.id)) up++; else add++;
    byId.set(c.match.id, c.match);
  } else if (c.op === 'delete' && byId.has(c.id)) {
    if (del >= MAX_DELETES) { skipped++; console.warn('删除次数已达上限，跳过：', c.id); continue; }
    byId.delete(c.id); del++; console.log('删除：', c.id, c.reason || '');
  }
}
// 清理 30 天前结束的场次
for (const [id, m] of byId) if (startOf(m) < now - 30 * DAY) byId.delete(id);

doc.matches = [...byId.values()].sort((a, b) => startOf(a) - startOf(b) || (a.bj ? 0 : 1) - (b.bj ? 0 : 1));
doc.updatedAt = bjIso(now);
doc.note = (out.note || '').slice(0, 80) || (up + add + del ? `更新 ${up} 场，新增 ${add} 场，删除 ${del} 场` : '无变化');
fs.writeFileSync(FILE, JSON.stringify(doc, null, 1) + '\n');
console.log(`完成：更新 ${up}，新增 ${add}，删除 ${del}，跳过 ${skipped}。共 ${doc.matches.length} 场。说明：${doc.note}`);
