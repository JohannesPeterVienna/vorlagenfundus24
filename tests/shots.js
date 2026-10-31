// Screenshots: node tests/shots.js <ausgabeordner> <pfad> [<pfad> ...]
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { server } = require('./server');
(async () => {
  const out = process.argv[2]; const pfade = process.argv.slice(3);
  const srv = await server(0); const port = srv.address().port;
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  for (const p of pfade) {
    for (const [name, w, h] of [['mobil', 390, 844], ['desktop', 1366, 900]]) {
      const page = await browser.newPage({ viewport: { width: w, height: h } });
      page.on('pageerror', e => console.log('JS-Fehler', p, e.message));
      await page.route(/googlesyndication|googletagmanager|fundingchoices/, r => r.abort());
      await page.goto(`http://127.0.0.1:${port}${p}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(400);
      const f = `${out}/${p.replace(/\W+/g, '_') || 'start'}-${name}.png`;
      await page.screenshot({ path: f, fullPage: process.env.FULL === '1' });
      console.log(f);
      await page.close();
    }
  }
  await browser.close(); srv.close();
})();
