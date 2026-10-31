// Prüft alle Seiten unter docs/: Pflichtangaben, Wortzahl, interne Links, Werbeplätze, Überlauf bei 360/390 px.
// Start: node tests/site-check.js
const fs = require('fs'); const path = require('path');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { server } = require('./server');
const ROOT = path.join(__dirname, '..', 'docs');
const BASE = 'https://vorlagenfundus24.de';
const PFLICHT = ['/impressum/', '/datenschutz/', '/kontakt/', '/404.html'];
const MIN_WORTE = 800;

function seiten() {
  const out = [];
  (function walk(d) {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) { if (f !== 'assets') walk(p); }
      else if (f.endsWith('.html')) out.push('/' + path.relative(ROOT, p).replace(/index\.html$/, ''));
    }
  })(ROOT);
  return out.sort();
}

(async () => {
  const fehler = []; const bericht = [];
  const srv = await server(0); const port = srv.address().port;
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const alle = seiten(); const titel = new Map(); const desc = new Map(); const links = new Set();
  for (const url of alle) {
    const roh = fs.readFileSync(path.join(ROOT, url.endsWith('/') ? url + 'index.html' : url), 'utf8');
    if (/http-equiv="refresh"/.test(roh)) { // Weiterleitungsseite statisch prüfen
      if (!/name="robots" content="noindex/.test(roh)) fehler.push(url + ': Weiterleitung ohne noindex');
      const c = (roh.match(/rel="canonical" href="([^"]+)"/) || [])[1] || '';
      const z = (roh.match(/url=([^"]+)"/) || [])[1] || '';
      if (!c.startsWith(BASE) || c !== BASE + z) fehler.push(url + ': Canonical/Ziel passen nicht');
      if (!/google-adsense-account/.test(roh)) fehler.push(url + ': AdSense-Meta fehlt');
      let zp = path.join(ROOT, z); if (z.endsWith('/')) zp = path.join(zp, 'index.html');
      if (!fs.existsSync(zp)) fehler.push(url + ': Weiterleitungsziel fehlt');
      bericht.push(`${url.padEnd(42)} Weiterleitung -> ${z}`);
      continue;
    }
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const jsFehler = [];
    page.on('pageerror', e => jsFehler.push(e.message));
    await page.route(/googlesyndication|googletagmanager|fundingchoices/, r => r.abort());
    await page.goto(`http://127.0.0.1:${port}${url}`, { waitUntil: 'networkidle' });
    const d = await page.evaluate(() => {
      const q = s => document.querySelector(s);
      const robots = (q('meta[name=robots]') || {}).content || '';
      const main = q('main') ? q('main').cloneNode(true) : document.body.cloneNode(true);
      main.querySelectorAll('nav,script,style,.werkzeug,noscript,.krumen').forEach(n => n.remove());
      const text = main.textContent.replace(/\s+/g, ' ').trim();
      return {
        title: document.title, desc: (q('meta[name=description]') || {}).content || '',
        canonical: (q('link[rel=canonical]') || {}).href || '', robots,
        h1: document.querySelectorAll('h1').length, lang: document.documentElement.lang,
        adsMeta: (q('meta[name="google-adsense-account"]') || {}).content || '',
        adsScript: !!q('script[src*="adsbygoogle.js"]'), anzeigen: document.querySelectorAll('.anzeige').length,
        worte: text.split(' ').filter(w => /[A-Za-zÄÖÜäöüß0-9]/.test(w)).length,
        refresh: !!q('meta[http-equiv=refresh]'),
        links: [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')),
        breite: document.documentElement.scrollWidth,
        ldOk: [...document.querySelectorAll('script[type="application/ld+json"]')].every(s => { try { JSON.parse(s.textContent); return true; } catch (e) { return false; } }),
        unlabeled: [...document.querySelectorAll('input:not([type=hidden]),select,textarea')].filter(e => !(e.labels && e.labels.length) && !e.getAttribute('aria-label') && !e.closest('label')).length
      };
    });
    // Überlauf auch bei 360 px
    await page.setViewportSize({ width: 360, height: 800 }); await page.waitForTimeout(150);
    const breite360 = await page.evaluate(() => document.documentElement.scrollWidth);
    await page.close();
    const f = m => fehler.push(`${url}: ${m}`);
    if (jsFehler.length) f('JS-Fehler ' + jsFehler.join(' | '));
    if (d.lang !== 'de') f('lang fehlt');
    if (d.adsMeta !== 'ca-pub-7811071715414905') f('AdSense-Meta fehlt');
    if (d.breite > 390) f('Überlauf 390 px: ' + d.breite);
    if (breite360 > 360) f('Überlauf 360 px: ' + breite360);
    if (!d.ldOk) f('JSON-LD ungültig');
    if (d.unlabeled) f(d.unlabeled + ' Formularfelder ohne Label');
    if (d.refresh) { // Weiterleitung
      if (!/noindex/.test(d.robots)) f('Weiterleitung ohne noindex');
      if (!d.canonical.startsWith(BASE)) f('Weiterleitung ohne Canonical');
      continue;
    }
    const pflicht = PFLICHT.includes(url);
    if (pflicht && (d.anzeigen || d.adsScript)) f('Werbung auf Pflichtseite');
    if (!d.title || !d.desc) f('Title/Description fehlt');
    if (d.h1 !== 1) f('H1-Anzahl ' + d.h1);
    if (url !== '/404.html') {
      if (d.canonical !== BASE + url) f('Canonical falsch: ' + d.canonical);
      if (titel.has(d.title)) f('Title doppelt mit ' + titel.get(d.title)); titel.set(d.title, url);
      if (desc.has(d.desc)) f('Description doppelt'); desc.set(d.desc, url);
      if (!pflicht && !['/', '/ueber-uns/', '/vorlagen/'].includes(url) && d.worte < MIN_WORTE) f('nur ' + d.worte + ' Wörter');
      if (!pflicht && !d.adsScript) f('AdSense-Skript fehlt');
    }
    d.links.filter(h => h.startsWith('/') && !h.startsWith('//')).forEach(h => links.add(h.split('#')[0]));
    bericht.push(`${url.padEnd(42)} ${String(d.worte).padStart(5)} Wörter  Anzeigenplätze: ${d.anzeigen}`);
  }
  for (const l of links) {
    let p = path.join(ROOT, l); if (l.endsWith('/')) p = path.join(p, 'index.html');
    if (!fs.existsSync(p)) fehler.push('Toter interner Link: ' + l);
  }
  // Sitemap
  const sm = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  for (const m of sm.matchAll(/<loc>(.*?)<\/loc>/g)) {
    const u = m[1].replace(BASE, ''); let p = path.join(ROOT, u); if (u.endsWith('/')) p = path.join(p, 'index.html');
    if (!fs.existsSync(p)) fehler.push('Sitemap verweist ins Leere: ' + u);
  }
  for (const f of ['CNAME', '.nojekyll', 'ads.txt', 'robots.txt', '404.html']) if (!fs.existsSync(path.join(ROOT, f))) fehler.push('Fehlt: ' + f);
  if (fs.readFileSync(path.join(ROOT, 'ads.txt'), 'utf8').trim() !== 'google.com, pub-7811071715414905, DIRECT, f08c47fec0942fa0') fehler.push('ads.txt falsch');
  await browser.close(); srv.close();
  console.log(bericht.join('\n'));
  console.log(`\n${alle.length} HTML-Dateien geprüft, ${links.size} interne Links.`);
  if (fehler.length) { console.log('\nFEHLER:\n' + fehler.join('\n')); process.exit(1); }
  console.log('Alle Prüfungen bestanden.');
})();
