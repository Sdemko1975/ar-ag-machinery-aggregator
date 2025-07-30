// Aggregates tractor / machinery market stories from 5 Argentine sites.
// Runs twice a week via GitHub Actions and writes site/data/articles.json

import got from 'got';
import * as cheerio from 'cheerio';
import { XMLParser } from 'fast-xml-parser';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const SOURCES = [
  { name: 'MaquiNAC', base: 'https://maquinac.com' },
  { name: 'Agrofy News', base: 'https://news.agrofy.com.ar' },
  { name: 'Infocampo', base: 'https://www.infocampo.com.ar' },
  { name: 'Agrositio', base: 'https://www.agrositio.com.ar' },
  { name: 'Bichos de Campo', base: 'https://bichosdecampo.com' }
];

// Spanish + English variants that commonly appear in titles/descriptions.
const KEYWORDS = [
  'tractor','tractores',
  'venta de tractores','ventas de tractores','patentamientos de tractores',
  'maquinaria agrícola','mercado de maquinaria','tendencias','mercado',
  'AFAT','INDEC',
  'agricultural machinery','tractor sales','market trends'
];

const FEED_HINTS = [
  '/feed','/?feed=rss2','/rss','/rss.xml','/feed.xml','/atom.xml'
];

// ------------ helpers
const sleep = ms => new Promise(r => setTimeout(r, ms));

function normalize(s='') {
  return s.toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu, ''); // strip accents
}
function matchesKeywords(text) {
  const hay = normalize(text);
  return KEYWORDS.some(k => hay.includes(normalize(k)));
}
function hash(s) {
  return createHash('sha1').update(s).digest('hex');
}
function toISODate(s) {
  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString();
}

async function get(url, opt={}) {
  return got(url, {
    timeout: { request: 15000 },
    headers: { 'user-agent': 'Mozilla/5.0 (content-aggregator; +github-pages)' },
    http2: true,
    throwHttpErrors: false,
    ...opt
  });
}

// Try common RSS/Atom endpoints first; fall back to lightweight HTML scrape.
async function fetchItemsFromSource(src) {
  const items = [];

  // 1) Try feeds
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
  for (const hint of FEED_HINTS) {
    const feedUrl = new URL(hint, src.base).toString();
    try {
      const res = await get(feedUrl);
      if (res.statusCode !== 200 || !/^application|text\/(xml|rss|atom|rdf)/.test(res.headers['content-type'] || '')) continue;
      const xml = parser.parse(res.body);
      let feedItems = [];

      // RSS 2.0
      if (xml?.rss?.channel?.item) feedItems = xml.rss.channel.item;
      // Atom
      else if (xml?.feed?.entry) feedItems = xml.feed.entry;
      if (!Array.isArray(feedItems) || feedItems.length === 0) continue;

      for (const it of feedItems) {
        const title = (it.title?.['#text'] ?? it.title ?? '').toString().trim();
        const link = (it.link?.href ?? it.link ?? it.guid?.['#text'] ?? it.guid ?? '').toString().trim();
        const desc = (it.description ?? it.summary ?? '').toString().trim();
        const dateRaw = it.pubDate ?? it.published ?? it.updated ?? null;

        if (!title || !link) continue;
        const text = `${title} ${desc}`;
        if (!matchesKeywords(text)) continue;

        items.push({
          id: hash(link),
          source: src.name,
          title,
          url: link.startsWith('http') ? link : new URL(link, src.base).toString(),
          teaser: desc,
          date: toISODate(dateRaw),
        });
      }
      if (items.length) return items; // good feed found; stop at first working feed
    } catch { /* try next */ }
    await sleep(400);
  }

  // 2) Fallback: scrape homepage and a few likely sections
  const candidatePaths = ['/', '/maquinarias', '/maquinaria', '/category/maquinarias', '/seccion/maquinaria', '/tag/maquinaria'];
  for (const p of candidatePaths) {
    try {
      const url = new URL(p, src.base).toString();
      const res = await get(url);
      if (res.statusCode !== 200) continue;
      const $ = cheerio.load(res.body);

      $('article, .post, .nota, .news-item, li').each((_, el) => {
        const a = $(el).find('a').first();
        const title = a.attr('title')?.trim() || a.text().trim();
        const href = a.attr('href');
        if (!title || !href) return;

        const teaser = $(el).find('p, .excerpt, .summary').first().text().trim();
        const text = `${title} ${teaser}`;
        if (!matchesKeywords(text)) return;

        let date = $(el).find('time').attr('datetime') || $(el).find('time').text().trim() || null;
        items.push({
          id: hash(href),
          source: src.name,
          title,
          url: href.startsWith('http') ? href : new URL(href, src.base).toString(),
          teaser,
          date: toISODate(date),
        });
      });
      if (items.length) break;
    } catch { /* keep trying */ }
    await sleep(400);
  }
  return items;
}

// ------------ main
async function run() {
  const all = [];
  for (const src of SOURCES) {
    const items = await fetchItemsFromSource(src);
    all.push(...items);
  }

  // Deduplicate by URL hash, keep most recent if duplicates
  const byId = new Map();
  for (const it of all) {
    const existing = byId.get(it.id);
    if (!existing) byId.set(it.id, it);
    else {
      const d1 = existing.date ? Date.parse(existing.date) : 0;
      const d2 = it.date ? Date.parse(it.date) : 0;
      if (d2 > d1) byId.set(it.id, it);
    }
  }
  const items = Array.from(byId.values())
    .sort((a, b) => (Date.parse(b.date || 0) - Date.parse(a.date || 0)));

  await mkdir('site/data', { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    sources: SOURCES.map(s => s.name),
    items
  };
  await writeFile('site/data/articles.json', JSON.stringify(payload, null, 2), 'utf8');
  console.log(`Saved ${items.length} items to site/data/articles.json`);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
