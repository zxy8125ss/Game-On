// Game On 赛程自动更新（免费方案）
// 1) 结构化来源直接生成赛程：F1（Jolpica/Ergast 公开接口）、UEFA 官方接口（欧国联 A 级、欧冠）、ESPN 公开接口（英超/西甲/德甲/中超）、LoL 电竞官方接口
// 2) 非结构化来源（足协网页、WTA 出场顺序 PDF 等，见 data/sources.json）交给 Gemini 整理——不带搜索，免费额度即可
// 3) 外文队名由 Gemini 翻译成中文并缓存在 data/names.json
// 任何一个来源失败都只跳过该来源、保留原数据，不会把整份赛程冲掉。
import fs from 'node:fs';

const SCHEDULE = 'data/schedule.json', NAMES = 'data/names.json', SOURCES = 'data/sources.json';
const KEY = process.env.GEMINI_API_KEY || '';
const MODELS = [...new Set([process.env.GEMINI_MODEL, 'gemini-3.6-flash', 'gemini-3.5-flash-lite'].filter(Boolean))];
const H = 3600e3, DAY = 24 * H, TZ = 8 * H;
const now = Date.now();
const FROM = now - 2 * DAY, TO = now + 30 * DAY;      // 自动来源覆盖的时间窗

const doc = JSON.parse(fs.readFileSync(SCHEDULE, 'utf8'));
const names = fs.existsSync(NAMES) ? JSON.parse(fs.readFileSync(NAMES, 'utf8')) : {};
const sources = fs.existsSync(SOURCES) ? JSON.parse(fs.readFileSync(SOURCES, 'utf8')) : { pages: [] };
const report = [];

const pad = n => String(n).padStart(2, '0');
const bj = ms => { const d = new Date(ms + TZ); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
const ymd = ms => { const d = new Date(ms); return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`; };
const isoDay = ms => new Date(ms).toISOString().slice(0, 10);
const startOf = m => Date.parse((m.bj ? m.bj.replace(' ', 'T') : m.date + 'T00:00') + ':00+08:00');
const zh = s => names[s] || s;
const slug = s => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);

async function get(url, opts = {}) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal, headers: { 'user-agent': 'Mozilla/5.0 GameOnBot', ...(opts.headers || {}) } });
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return r;
  } finally { clearTimeout(t); }
}
const getJSON = async (url, opts) => (await get(url, opts)).json();

// ---------- 1. 结构化来源 ----------
const AUTO = new Map();          // id -> match
const OK_SRC = new Set();        // 本次成功的来源，用来替换旧数据
const add = m => { const t = startOf(m); if (t >= FROM && t <= TO) AUTO.set(m.id, m); };

async function srcF1() {
  const j = await getJSON('https://api.jolpi.ca/ergast/f1/current/races.json?limit=100');
  for (const r of j.MRData.RaceTable.Races) {
    const gp = r.raceName, base = `f1-${r.season}-${r.round}`;
    const sessions = [['Sprint', 's', '冲刺赛', 45], ['Qualifying', 'q', '排位赛', 60], [null, 'r', '正赛', 120]];
    for (const [k, suf, title, dur] of sessions) {
      const s = k ? r[k] : { date: r.date, time: r.time };
      if (!s || !s.date || !s.time) continue;
      add({ id: `${base}-${suf}`, src: 'f1', sport: 'f1', sub: `${zh(gp)}（第${r.round}站）`, title, teams: [], bj: bj(Date.parse(`${s.date}T${s.time}`)), dur, note: r.Circuit?.circuitName ? zh(r.Circuit.circuitName) : undefined, _en: [gp, r.Circuit?.circuitName] });
    }
  }
}

const BIG_CLUBS = ['Manchester City', 'Liverpool', 'Arsenal', 'Manchester United', 'Chelsea', 'Tottenham', 'Barcelona', 'Real Madrid', 'Atlético Madrid', 'Atletico Madrid', 'Bayern', 'Borussia Dortmund', 'Bayer Leverkusen', 'Paris Saint-Germain', 'Inter', 'AC Milan', 'Juventus', 'Napoli'];
const isBig = n => BIG_CLUBS.some(b => n && n.toLowerCase().includes(b.toLowerCase()));

async function srcUefa(compId, key, label, keep) {
  const url = `https://match.uefa.com/v5/matches?competitionId=${compId}&fromDate=${isoDay(FROM)}&toDate=${isoDay(TO)}&order=ASC&offset=0&limit=300`;
  const arr = await getJSON(url);
  if (!Array.isArray(arr)) throw new Error('UEFA 返回格式变化');
  for (const m of arr) {
    const home = m.homeTeam?.translations?.displayName?.EN || m.homeTeam?.internationalName;
    const away = m.awayTeam?.translations?.displayName?.EN || m.awayTeam?.internationalName;
    const group = m.group?.metaData?.groupName || m.group?.translations?.name?.EN || '';
    const t = Date.parse(m.kickOffTime?.dateTime || '');
    if (!home || !away || isNaN(t) || !keep(home, away, group)) continue;
    const fin = /FINISHED/i.test(m.status || '');
    const sh = m.score?.total?.home, sa = m.score?.total?.away;
    add({ id: `${key}-${m.id}`, src: key, sport: 'football', sub: label + (group ? ` · ${group.replace(/^Group\s*/i, '')} 组` : ''), title: `${zh(home)} vs ${zh(away)}`, teams: [zh(home), zh(away)], bj: bj(t), dur: 115, channels: ['咪咕视频'], ...(fin && sh != null ? { result: `${zh(home)} ${sh}:${sa} ${zh(away)}` } : {}), _en: [home, away] });
  }
}

async function srcEspn(league, key, label, keep) {
  for (let d = FROM; d <= Math.min(TO, now + 16 * DAY); d += DAY) {
    const j = await getJSON(`https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/scoreboard?dates=${ymd(d)}`);
    for (const e of j.events || []) {
      const c = e.competitions?.[0]; if (!c) continue;
      const H_ = c.competitors?.find(x => x.homeAway === 'home'), A_ = c.competitors?.find(x => x.homeAway === 'away');
      const home = H_?.team?.displayName, away = A_?.team?.displayName, t = Date.parse(e.date);
      if (!home || !away || isNaN(t) || !keep(home, away)) continue;
      const fin = e.status?.type?.completed;
      add({ id: `${key}-${e.id}`, src: key, sport: 'football', sub: label, title: `${zh(home)} vs ${zh(away)}`, teams: [zh(home), zh(away)], bj: bj(t), dur: 115, ...(fin ? { result: `${zh(home)} ${H_.score}:${A_.score} ${zh(away)}` } : {}), _en: [home, away] });
    }
  }
}

async function srcLol() {
  // LoL 电竞官方赛程接口（lolesports.com 网站本身使用的公开密钥）
  const j = await getJSON('https://esports-api.lolesports.com/persisted/gw/getSchedule?hl=en-US', { headers: { 'x-api-key': '0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z' } });
  const LPL = ['AL', 'BLG', 'TES', 'IG', 'JDG', 'WBG', 'LNG', 'NIP', 'WE', 'EDG', 'FPX', 'OMG', 'TT', 'UP', 'LGD', 'RA'];
  for (const e of j.data?.schedule?.events || []) {
    if (e.type !== 'match') continue;
    const lg = e.league?.name || '', teams = (e.match?.teams || []).map(t => t.code || t.name);
    const worlds = /world/i.test(lg), lpl = /LPL/i.test(lg);
    if (!(worlds && teams.some(t => LPL.includes(String(t).toUpperCase()))) && !(lpl && /playoff|final/i.test(e.blockName || ''))) continue;
    const t = Date.parse(e.startTime); if (isNaN(t)) continue;
    const bo = e.match?.strategy?.count || 1;
    const done = e.state === 'completed';
    const res = done ? (e.match.teams || []).map(x => `${x.code} ${x.result?.gameWins ?? ''}`).join(' : ') : undefined;
    add({ id: `lol-${e.match?.id || slug(teams.join('-') + t)}`, src: 'lol', sport: 'lol', sub: `${worlds ? 'S16 全球总决赛' : 'LPL'} · ${e.blockName || ''}`.trim(), title: teams.join(' vs '), teams: teams.map(String), bj: bj(t), dur: bo >= 5 ? 300 : bo >= 3 ? 180 : 60, channels: ['哔哩哔哩', '虎牙', '斗鱼'], ...(res ? { result: res } : {}) });
  }
}

const NL_A = (h, a, g) => /^Group A\d/i.test(g) || /League A/i.test(g);
const SOURCES_STRUCT = [
  ['F1 官方赛历', 'f1', srcF1],
  ['欧国联 A 级', 'unl', () => srcUefa(2014, 'unl', '欧国联 A 级', NL_A)],
  ['欧冠', 'ucl', () => srcUefa(1, 'ucl', '欧冠', (h, a) => isBig(h) || isBig(a))],
  ['英超', 'epl', () => srcEspn('eng.1', 'epl', '英超', (h, a) => isBig(h) || isBig(a))],
  ['西甲', 'liga', () => srcEspn('esp.1', 'liga', '西甲', (h, a) => isBig(h) || isBig(a))],
  ['德甲', 'bl', () => srcEspn('ger.1', 'bl', '德甲', (h, a) => isBig(h) || isBig(a))],
  ['中超', 'csl', () => srcEspn('chn.1', 'csl', '中超', () => true)],
  ['LoL 电竞', 'lol', srcLol],
];
for (const [label, key, fn] of SOURCES_STRUCT) {
  const before = AUTO.size;
  try { await fn(); OK_SRC.add(key); report.push(`${label}：${AUTO.size - before} 场`); }
  catch (e) { report.push(`${label}：失败（${String(e.message).slice(0, 80)}），保留旧数据`); }
}

// ---------- 2. Gemini（不带搜索，免费额度） ----------
function parseJson(t) {
  const s = t.replace(/```json|```/g, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('输出中没有 JSON');
  return JSON.parse(s.slice(a, b + 1));
}
async function gemini(parts, label) {
  if (!KEY) throw new Error('缺少 GEMINI_API_KEY');
  for (const model of MODELS) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY },
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.1, responseMimeType: 'application/json' } }) });
    if (r.ok) {
      const j = await r.json();
      const t = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
      if (t.trim()) { console.log(`${label}：使用 ${model}`); return parseJson(t); }
    } else console.error(`${label}：${model} ${r.status} ${(await r.text()).slice(0, 160)}`);
    await new Promise(res => setTimeout(res, 13000));   // 免费额度每分钟 5 次，留足间隔
  }
  throw new Error('Gemini 不可用');
}

// 2a. 翻译新出现的外文名
const unknown = [...new Set([...AUTO.values()].flatMap(m => m._en || []).filter(n => n && !names[n]))];
if (unknown.length) {
  try {
    const out = await gemini([{ text: `把下面这些体育队伍、国家、大奖赛、赛道名称翻译成中国大陆体育媒体最常用的简体中文叫法（如 Manchester City→曼城，Bayern Munich→拜仁，Czechia→捷克，Bahrain Grand Prix→巴林大奖赛）。只输出一个 JSON 对象，键为原文，值为中文。\n${JSON.stringify(unknown)}` }], '翻译');
    let n = 0; for (const [k, v] of Object.entries(out || {})) if (typeof v === 'string' && v.trim() && unknown.includes(k)) { names[k] = v.trim(); n++; }
    fs.writeFileSync(NAMES, JSON.stringify(names, null, 1) + '\n');
    report.push(`翻译新名称 ${n} 个`);
  } catch (e) { report.push(`翻译失败（${e.message}），暂用外文名`); }
}
// 用译名重写标题
for (const m of AUTO.values()) if (m._en) {
  if (m.sport === 'f1') { m.sub = `${zh(m._en[0])}${m.sub.slice(m.sub.indexOf('（'))}`; if (m._en[1]) m.note = zh(m._en[1]); }
  else {
    const [h, a] = m._en; const oh = m.teams[0], oa = m.teams[1];
    m.title = `${zh(h)} vs ${zh(a)}`; m.teams = [zh(h), zh(a)];
    if (m.result) m.result = m.result.replace(oh, zh(h)).replace(oa, zh(a));
  }
}

// 2b. 非结构化官方页面 → Gemini 整理（中国队、网球等）
const ALLOWED = /^(cn-|ten-|ag-|nt-)/;
let pageChanges = [];
const pages = (sources.pages || []).filter(p => !p.until || Date.parse(p.until + 'T23:59:59+08:00') > now);
if (pages.length && KEY) {
  const parts = [];
  for (const p of pages) {
    try {
      const r = await get(p.url);
      const type = r.headers.get('content-type') || '';
      if (/pdf/i.test(type) || /\.pdf$/i.test(p.url)) {
        const b = Buffer.from(await r.arrayBuffer());
        parts.push({ text: `\n【来源：${p.name}（${p.url}），官方 PDF】` }, { inline_data: { mime_type: 'application/pdf', data: b.toString('base64') } });
      } else {
        const html = await r.text();
        const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').slice(0, 12000);
        parts.push({ text: `\n【来源：${p.name}（${p.url}），官方网页】\n${text}` });
      }
    } catch (e) { report.push(`${p.name}：抓取失败（${String(e.message).slice(0, 60)}）`); }
  }
  if (parts.length) {
    const keep = doc.matches.filter(m => ALLOWED.test(m.id) && startOf(m) > now - 3 * DAY);
    const prompt = `你是体育赛程数据维护员。现在是北京时间 ${bj(now)}。下面是几份官方网页/PDF 的内容。只根据这些内容（不要凭记忆补充），整理出北京时间未来 21 天内的比赛，以及过去 2 天内结束比赛的赛果，范围：
- 中国男足各级国家队（国家队、U23、U20、U19、U17、U16、U15）：必须写 squad 字段（国家队 / U23 亚运队 / U17 等），teams 中中国队写作 中国 / 中国U23 / 中国U17 等；
- 郑钦文及其他中国网球选手在 WTA 赛事中的比赛（出场顺序 PDF 里的开赛时间是当地时间，北京举办的赛事即北京时间）。
规则：只写资料里明确写出的信息；时间不明确就只填 date；比分只来自资料里的赛果。id 用小写字母、数字和连字符，必须以 cn-（国足各级）或 ten-（网球）开头；如果下面"已有条目"里已经有同一场比赛，必须沿用它的 id。
输出一个 JSON 对象：{"changes":[{"op":"upsert","match":{"id":"","sport":"football|tennis","squad":"","sub":"","title":"","teams":[],"bj":"YYYY-MM-DD HH:mm","date":"YYYY-MM-DD","dur":115,"result":"","note":""}}]}；没有改动就输出 {"changes":[]}。不需要的字段直接省略。
已有条目：${JSON.stringify(keep)}`;
    try { const out = await gemini([{ text: prompt }, ...parts], '页面整理'); pageChanges = out?.changes || []; report.push(`官方页面整理：${pageChanges.length} 条改动`); }
    catch (e) { report.push(`官方页面整理失败（${e.message}）`); }
  }
}

// ---------- 3. 合并 ----------
const LEGACY = { f1: /^f1-(?!\d{4}-)/, unl: /^unl-[a-z]/, epl: /^epl\d/, liga: /^liga-/, bl: /^bl\d/ };
const byId = new Map(doc.matches.map(m => [m.id, m]));
for (const key of OK_SRC) {
  for (const [id, m] of byId) {
    const t = startOf(m);
    const legacy = LEGACY[key] && LEGACY[key].test(id);
    if ((m.src === key || legacy) && t >= FROM && t <= TO) byId.delete(id);   // 由新抓取结果替换
  }
}
for (const m of AUTO.values()) { delete m._en; Object.keys(m).forEach(k => m[k] === undefined && delete m[k]); byId.set(m.id, m); }

const valid = m => m && /^[a-z0-9][a-z0-9-]{2,60}$/.test(m.id || '') && ALLOWED.test(m.id) && ['football', 'tennis'].includes(m.sport) && m.title &&
  (m.bj ? /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(m.bj) : /^\d{4}-\d{2}-\d{2}$/.test(m.date || '')) && !isNaN(startOf(m));
let pu = 0;
for (const c of pageChanges) if (c?.op === 'upsert' && valid(c.match)) {
  const m = c.match; if (m.bj) delete m.date; if (!Array.isArray(m.teams)) m.teams = []; if (typeof m.dur !== 'number') m.dur = m.sport === 'tennis' ? 150 : 115;
  if (m.squad && m.sport !== 'football') delete m.squad;
  for (const k of Object.keys(m)) if (m[k] === '' || m[k] == null) delete m[k];
  const prev = byId.get(m.id) || {};
  if (prev.verify && m.bj) delete prev.verify;            // 官方页面给出了确切时间，视为已确认
  byId.set(m.id, { ...prev, ...m }); pu++;
}
for (const [id, m] of byId) if (startOf(m) < now - 30 * DAY) byId.delete(id);

doc.matches = [...byId.values()].sort((a, b) => startOf(a) - startOf(b));
doc.updatedAt = new Date(now + TZ).toISOString().replace(/\.\d{3}Z$/, '+08:00');
const okN = report.filter(r => !/失败/.test(r)).length;
doc.note = `自动更新 ${okN}/${report.length} 项成功`;
doc.sources = report;
fs.writeFileSync(SCHEDULE, JSON.stringify(doc, null, 1) + '\n');
console.log(report.join('\n'));
console.log(`官方页面改动采用 ${pu} 条；共 ${doc.matches.length} 场。`);
if (!OK_SRC.size && !pu) { console.error('所有来源都失败了'); process.exit(1); }
