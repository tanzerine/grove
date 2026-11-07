// Prospect keyword research, outside the verified-domain gate. Feeds lib/reports.
//   node scripts/prospect-research.mjs                 -> research pass (~$1.20)
//   node scripts/prospect-research.mjs serp            -> SERP pass on scripts/out/krevaya/finalists.txt (~$0.05)
// Reads DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD from .env.local. Writes raw JSON to scripts/out/krevaya/
// (gitignored). Edit TARGET / PEERS / SEEDS / HEADS per prospect.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

for (const raw of (existsSync('.env.local') ? readFileSync('.env.local', 'utf8') : '').split('\n')) {
  const l = raw.trim(); const i = l.indexOf('=');
  if (!l || l.startsWith('#') || i < 1) continue;
  const k = l.slice(0, i).trim(); let v = l.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  if (!process.env[k]) process.env[k] = v;
}
const { DATAFORSEO_LOGIN: L, DATAFORSEO_PASSWORD: P } = process.env;
if (!L || !P) { console.error('No DataForSEO credentials in .env.local'); process.exit(1); }
const AUTH = 'Basic ' + Buffer.from(`${L}:${P}`).toString('base64');
const OUT = 'scripts/out/krevaya'; mkdirSync(OUT, { recursive: true });
const LOC = 2840, LANG = 'en';
let spent = 0;

async function call(path, body, name) {
  const res = await fetch('https://api.dataforseo.com' + path, {
    method: 'POST', headers: { authorization: AUTH, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const j = await res.json();
  spent += j?.cost ?? 0;
  const t = j?.tasks?.[0];
  console.log(`${name.padEnd(40)} ${t?.status_code} ${t?.status_message ?? ''}  items=${t?.result?.[0]?.items_count ?? t?.result?.length ?? 0}`);
  writeFileSync(`${OUT}/${name}.json`, JSON.stringify(j, null, 1));
  return j;
}

const TARGET = 'krevaya.com';
const PEERS = ['postiz.com', 'typefully.com', 'ayrshare.com', 'upload-post.com', 'socialbee.com',
  'contentstudio.io', 'publer.com', 'blotato.com', 'metricool.com', 'buffer.com'];
const SEEDS = ['social media automation', 'content pillars', 'schedule social media posts', 'instagram carousel',
  'instagram comment to dm', 'social media competitor analysis', 'trending topics social media', 'social media mcp',
  'claude code social media', 'social media automation tools', 'social media content calendar', 'repurpose blog post',
  'ai brand voice', 'social media approval workflow', 'link in bio', 'social media api', 'linkedin api post',
  'buffer alternative', 'hootsuite alternative', 'schedule linkedin posts', 'schedule tiktok posts', 'mcp server'];
const HEADS = ['social media automation', 'content pillars', 'schedule social media posts across time zones',
  'instagram carousel', 'instagram comment to dm automation', 'social media competitor analysis',
  'trending topics on social media', 'social media mcp server', 'social media automation tools',
  'social media content calendar', 'repurpose blog post into social media', 'ai brand voice',
  'social media approval workflow', 'content calendar template'];

if (process.argv[2] === 'serp') {
  const kws = readFileSync(`${OUT}/finalists.txt`, 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
  for (const kw of kws) {
    await call('/v3/serp/google/organic/live/regular', [{ keyword: kw, location_code: LOC, language_code: LANG, depth: 10 }],
      'serp__' + kw.replace(/[^a-z0-9]+/gi, '-').slice(0, 60));
  }
} else {
  // 1. What Google already shows the target for.
  await call('/v3/dataforseo_labs/google/ranked_keywords/live',
    [{ target: TARGET, location_code: LOC, language_code: LANG, limit: 1000 }], 'ranked__' + TARGET);
  // 2. Peer gap: keywords peers rank top-20 for that are low difficulty and have demand.
  for (const d of PEERS) {
    await call('/v3/dataforseo_labs/google/ranked_keywords/live', [{
      target: d, location_code: LOC, language_code: LANG, limit: 300,
      filters: [['ranked_serp_element.serp_item.rank_group', '<=', 20], 'and',
                ['keyword_data.keyword_info.search_volume', '>=', 30], 'and',
                ['keyword_data.keyword_properties.keyword_difficulty', '<=', 35]],
      order_by: ['keyword_data.keyword_info.search_volume,desc'],
    }], 'peer__' + d);
  }
  // 3. Expand the product's own vocabulary.
  for (const s of SEEDS) {
    await call('/v3/dataforseo_labs/google/keyword_suggestions/live', [{
      keyword: s, location_code: LOC, language_code: LANG, limit: 150, include_seed_keyword: true,
    }], 'sugg__' + s.replace(/\s+/g, '-'));
  }
  // 4. How hard the existing guides' head terms are.
  await call('/v3/dataforseo_labs/google/keyword_overview/live',
    [{ keywords: HEADS, location_code: LOC, language_code: LANG }], 'heads__overview');
}
console.log(`\nDone. Spent $${spent.toFixed(3)}. Files in ${OUT}/`);
