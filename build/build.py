#!/usr/bin/env python3
"""Statischer Seitenbau für vorlagenfundus24.de.

Liest build/content/*.html (JSON-Kopf in <!--meta ... meta--> + HTML-Körper) und schreibt nach docs/.
Aufruf: python3 build/build.py
"""
import html
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHOP_LINK = (ROOT / 'build' / 'shop-link.html').read_text(encoding='utf-8')
SRC = ROOT / 'build' / 'content'
OUT = ROOT / 'docs'
BASE = 'https://vorlagenfundus24.de'
STAND = '2. November 2026'
LASTMOD = '2026-11-02'
ASSETV = '2026-11-24a'  # Cache-Schlüssel für CSS/JS; bei jeder Skriptänderung erhöhen
PUB = 'ca-pub-7811071715414905'
# Google Consent Mode v2: alle Zwecke abgelehnt, bevor irgendein Google-Skript lädt. Nur die Google-CMP
# bzw. site.js (nach gemeldeter Zustimmung) heben einzelne Werte an.
CONSENT_DEFAULT = ("<script>window.dataLayer=window.dataLayer||[];window.gtag=window.gtag||function(){dataLayer.push(arguments);};"
                   "gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',"
                   "analytics_storage:'denied',wait_for_update:500});</script>")

REGISTER = [
    ('wohnen', 'Wohnen', '/wohnung-kuendigen/'),
    ('kauf', 'Kauf', '/ruecktritt-online-kauf/'),
    ('vertraege', 'Verträge', '/handyvertrag-kuendigen/'),
    ('vollmacht', 'Vollmacht', '/vollmacht-post-pakete/'),
    ('verein', 'Verein', '/verein-austritt/'),
    ('werkzeuge', 'Werkzeuge', '/fristenrechner/'),
]
NAV = [
    ('/', 'Start'),
    ('/vorlagen/', 'Alle Vorlagen'),
    ('/fristenrechner/', 'Fristenrechner'),
    ('/fristen-tabelle/', 'Fristentabelle'),
    ('/einschreiben-rueckschein-zugang/', 'Versand'),
    ('/ueber-uns/', 'Über uns'),
]

LOGO = ('<svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true" focusable="false">'
        '<rect x="3" y="7" width="30" height="27" rx="2" fill="#FBF9F4"/>'
        '<path d="M3 11h11l3-4h16" fill="none" stroke="#1A1A1A" stroke-width="3"/>'
        '<rect x="8" y="15" width="16" height="3" fill="#1A1A1A"/><rect x="8" y="21" width="20" height="2" fill="#A0A0A0"/>'
        '<rect x="8" y="25" width="14" height="2" fill="#A0A0A0"/><rect x="25" y="26" width="10" height="8" fill="#F3D9D5"/>'
        '<path d="M27 30h6" stroke="#1A1A1A" stroke-width="1.5"/></svg>')


# ---------- Eigene Daten: Fristentabelle und durchgerechnete Beispiele ----------
DATEN = ROOT / 'build' / 'daten'
FRISTEN = json.loads((DATEN / 'fristen.json').read_text(encoding='utf-8'))
BEISPIELE = {b['id']: b for b in json.loads((DATEN / 'beispiele.json').read_text(encoding='utf-8'))}
LANDNAME = {'AT': 'Österreich', 'DE': 'Deutschland', 'CH': 'Schweiz'}
MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
WOCHENTAGE = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']


def datum_lang(iso, land='DE', wochentag=True):
    import datetime
    d = datetime.date.fromisoformat(iso)
    mon = 'Jänner' if (land == 'AT' and d.month == 1) else MONATE[d.month - 1]
    t = f'{d.day}. {mon} {d.year}'
    return f'{WOCHENTAGE[d.weekday()]}, {t}' if wochentag else t


ABRUF = datum_lang(FRISTEN['abruf'], 'DE', False)


def rechner_link(f):
    r = f.get('rechner')
    if not r:
        return ''
    art = f'&r={r["r"]}' if r.get('r') else ''
    return f'/fristenrechner/#land={f["land"]}&n={r["n"]}&u={r["u"]}&v={r["v"]}{art}'


def fristen_zeile(f, kompakt):
    aktionen = []
    if rechner_link(f):
        aktionen.append(f'<a href="{rechner_link(f)}">Im Fristenrechner öffnen</a>')
    if f.get('seite') and not kompakt:
        aktionen.append(f'<a href="{f["seite"]}">Zur Vorlage</a>')
    hinweis = f'<span class="ft-hinweis">{esc(f["hinweis"])}</span>' if f.get('hinweis') else ''
    akt = f'<span class="ft-akt">{" · ".join(aktionen)}</span>' if aktionen else ''
    return (f'<tr id="f-{f["id"]}" data-land="{f["land"]}" data-bereich="{esc(f["bereich"])}">'
            f'<td data-l="Land"><span class="land" title="{LANDNAME[f["land"]]}">{f["land"]}</span></td>'
            f'<th scope="row" data-l="Worum es geht">{esc(f["titel"])}<span class="ft-bereich">{esc(f["bereich"])}</span></th>'
            f'<td data-l="Frist"><b>{esc(f["frist"])}</b></td>'
            f'<td data-l="Beginn oder Bezugspunkt">{esc(f["beginn"])}</td>'
            f'<td data-l="Fundstelle"><a href="{esc(f["url"])}" rel="noopener">{esc(f["norm"])}</a><span class="ft-fassung">{esc(f["fassung"])}</span></td>'
            f'<td data-l="Hinweis">{hinweis}{akt}</td></tr>')


def fristentabelle(zeilen, kompakt=False, titel=''):
    kopf_ = ('<thead><tr><th scope="col">Land</th><th scope="col">Worum es geht</th><th scope="col">Frist</th>'
             '<th scope="col">Beginn oder Bezugspunkt</th><th scope="col">Fundstelle</th><th scope="col">Hinweis</th></tr></thead>')
    rumpf = ''.join(fristen_zeile(f, kompakt) for f in zeilen)
    cap = f'<caption>{esc(titel)}</caption>' if titel else ''
    attr = '' if kompakt else f' data-fristentabelle data-abruf="{ABRUF}"'
    return (f'<div class="ft"{attr}><div class="tabelle ft-tab"><table>{cap}{kopf_}<tbody>{rumpf}</tbody></table></div>'
            f'<p class="ft-stand">Gesetzestexte abgerufen am {ABRUF}. Quellen: RIS (Österreich), Gesetze im Internet (Deutschland), Fedlex (Schweiz). '
            f'Gesetzliche Grundregeln – Vertrag, Statuten und Sonderregeln können abweichen. Keine Rechtsberatung.'
            f'{"" if not kompakt else " Alle Einträge: <a href=&quot;/fristen-tabelle/&quot;>Fristentabelle</a>."}</p></div>').replace('&quot;', '"')


def umbrechen(text, n=44):
    zeilen, akt = [], ''
    for w in text.split():
        if akt and len(akt) + 1 + len(w) > n:
            zeilen.append(akt); akt = w
        else:
            akt = (akt + ' ' + w).strip()
    return zeilen + ([akt] if akt else [])


def beispiel_html(bid):
    b = BEISPIELE[bid]
    land = b['land']

    def wert(k):
        if k.startswith('='):
            return k[1:]
        if isinstance(b['erwartet'], dict) and k in b['erwartet']:
            return b['erwartet'][k]
        return b['args'][k]
    y, teile = 22, []
    punkte = [(wert(k), t) for k, t in b['punkte']]
    for i, (d, t) in enumerate(punkte):
        zl = umbrechen(t)
        letzter = i == len(punkte) - 1
        hoehe = 30 + 17 * len(zl) + 10
        if not letzter:
            teile.append(f'<line class="zs-linie" x1="14" y1="{y}" x2="14" y2="{y + hoehe}"/>')
        teile.append(f'<circle class="zs-punkt{" zs-ziel" if letzter else ""}" cx="14" cy="{y}" r="7"/>')
        teile.append(f'<text class="zs-datum" x="34" y="{y + 5}">{esc(datum_lang(d, land))}</text>')
        for j, z in enumerate(zl):
            teile.append(f'<text class="zs-text" x="34" y="{y + 24 + 17 * j}">{esc(z)}</text>')
        y += hoehe
    hoehe_ges = y - 6
    label = 'Zeitstrahl: ' + '; '.join(f'{datum_lang(d, land, False)} – {t}' for d, t in punkte)
    svg = (f'<svg class="zeitstrahl" viewBox="0 0 360 {hoehe_ges}" width="360" height="{hoehe_ges}" role="img" aria-label="{esc(label)}">'
           f'{"".join(teile)}</svg>')
    text = re.sub(r'\{([^}]+)\}', lambda m: datum_lang(wert(m.group(1)), land), b['text'])
    href, linktext = b['link']
    return (f'<figure class="beispiel"><figcaption><span class="bsp-etikett">Rechenbeispiel · {LANDNAME[land]}</span>{esc(b["titel"])}</figcaption>'
            f'<div class="bsp-raster">{svg}<div><p>{text}</p>'
            f'<p class="bsp-fuss"><a class="knopf leise" href="{esc(href)}">{esc(linktext)}</a></p>'
            f'<p class="klein">Konstruiertes Beispiel mit angenommenen Daten, gerechnet mit dem Rechenkern dieser Website; ein automatischer Test vergleicht die Daten vor jeder Veröffentlichung.</p></div></div></figure>')


def daten_einfuegen(s, body):
    """<!--fristentabelle--> = ganze Tabelle; <!--fristen--> = Einträge zu dieser Seite; <!--beispiel:id--> = Rechenbeispiel;
    href="rechner:id" = Fristenrechner-Link, vorbelegt mit Land, Dauer und Einheit dieses Tabelleneintrags."""
    def rechner_ziel(m):
        f = next((f for f in FRISTEN['fristen'] if f['id'] == m.group(1)), None)
        if not f or not rechner_link(f):
            raise SystemExit(f'Kein Rechner-Eintrag {m.group(1)} auf {s["url"]}')
        return f'href="{rechner_link(f)}"'
    body = re.sub(r'href="rechner:([a-z0-9-]+)"', rechner_ziel, body)
    # Reihenfolge der großen Tabelle: je Land zuerst die Alltagsfristen, die Rechenregeln am Schluss
    alle = sorted(FRISTEN['fristen'], key=lambda f: (['AT', 'DE', 'CH'].index(f['land']), f['bereich'] == 'Rechenregel'))
    body = body.replace('<!--fristentabelle-->', fristentabelle(alle))
    if '<!--fristen-->' in body:
        eigene = [f for f in FRISTEN['fristen'] if f.get('seite') == s['url']]
        if not eigene:
            raise SystemExit('Keine Fristen für ' + s['url'])
        body = body.replace('<!--fristen-->', fristentabelle(eigene, True))
    return re.sub(r'<!--beispiel:([a-z0-9-]+)-->', lambda m: beispiel_html(m.group(1)), body)


def kurz(d, n=160):
    """Beschreibung für Suchergebnisse: hintere Zusätze nach „ – “ abschneiden, bis sie in ca. 160 Zeichen passt."""
    while len(d) > n and ' – ' in d:
        d = d.rsplit(' – ', 1)[0].rstrip('.') + '.'
    return d


def esc(s):
    return html.escape(str(s), quote=True)


def lade_seiten():
    seiten = []
    for f in sorted(SRC.glob('*.html')):
        raw = f.read_text(encoding='utf-8')
        m = re.match(r'\s*<!--meta(.*?)meta-->(.*)', raw, re.S)
        if not m:
            raise SystemExit(f'Kein Meta-Kopf in {f}')
        meta = json.loads(m.group(1))
        meta['body'] = m.group(2).strip()
        meta['quelle'] = f.name
        seiten.append(meta)
    return seiten


def anzeige(fmt):
    return (f'<aside class="anzeige" data-format="{fmt}" hidden aria-label="Anzeige">'
            f'<span class="anz-label">Anzeige</span><div class="anz-platz"></div></aside>')


def faq_aus_html(body):
    out = []
    for q, a in re.findall(r'<details>\s*<summary>(.*?)</summary>\s*<div>(.*?)</div>\s*</details>', body, re.S):
        text = re.sub(r'<[^>]+>', ' ', a)
        text = re.sub(r'\s+', ' ', html.unescape(text)).strip()
        out.append({'@type': 'Question', 'name': html.unescape(re.sub(r'<[^>]+>', '', q)).strip(),
                    'acceptedAnswer': {'@type': 'Answer', 'text': text}})
    return out


def toc_aus_html(body):
    eintraege = []
    def ersetze(m):
        text = re.sub(r'<[^>]+>', '', m.group(2))
        slug = m.group(1) or re.sub(r'[^a-z0-9]+', '-', text.lower()
                                   .replace('ä', 'ae').replace('ö', 'oe').replace('ü', 'ue').replace('ß', 'ss')).strip('-')
        eintraege.append((slug, text))
        return f'<h2 id="{slug}">{m.group(2)}</h2>'
    neu = re.sub(r'<h2(?: id="([^"]+)")?>(.*?)</h2>', ersetze, body)
    return neu, eintraege


def werbung_einfuegen(body):
    """Ersetzt <!--anzeige--> durch Medium Rectangle, <!--banner--> durch Leaderboard."""
    body = body.replace('<!--banner-->', anzeige('banner'))
    return body.replace('<!--anzeige-->', anzeige('rectangle'))


def kopf(s, canonical):
    robots = 'noindex,follow' if s.get('noindex') else 'index,follow'
    jsonld = []
    krumen = s.get('krumen', [])
    if krumen:
        items = [{'@type': 'ListItem', 'position': 1, 'name': 'Start', 'item': BASE + '/'}]
        for i, (name, url) in enumerate(krumen, start=2):
            items.append({'@type': 'ListItem', 'position': i, 'name': name, 'item': BASE + url})
        jsonld.append({'@context': 'https://schema.org', '@type': 'BreadcrumbList', 'itemListElement': items})
    faq = faq_aus_html(s['body'])
    if faq and not s.get('noindex'):
        jsonld.append({'@context': 'https://schema.org', '@type': 'FAQPage', 'mainEntity': faq})
    if s['url'] == '/':
        jsonld.append({'@context': 'https://schema.org', '@type': 'WebSite', 'name': 'Vorlagenfundus 24',
                       'url': BASE + '/', 'inLanguage': 'de',
                       'publisher': {'@type': 'Organization', 'name': 'AdStern – Agentur für digitales Marketing', 'email': 'office@adstern.com',
                                     'address': {'@type': 'PostalAddress', 'streetAddress': 'Seilerstätte 8',
                                                 'postalCode': '1010', 'addressLocality': 'Wien', 'addressCountry': 'AT'}}})
    ld = ''.join(f'<script type="application/ld+json">{json.dumps(j, ensure_ascii=False)}</script>' for j in jsonld)
    werbung = '' if s.get('ohneWerbung') else (
        f'<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client={PUB}" crossorigin="anonymous"></script>')
    return f'''<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
{CONSENT_DEFAULT}
<title>{esc(s['title'])}</title>
<meta name="description" content="{esc(kurz(s['description']))}">
{"" if s["url"] == "/404/" else f'<link rel="canonical" href="{canonical}">'}
<meta name="robots" content="{robots}">
<meta name="google-adsense-account" content="{PUB}">
<meta name="theme-color" content="#1A1A1A">
<meta property="og:type" content="website">
<meta property="og:locale" content="de_AT">
<meta property="og:site_name" content="Vorlagenfundus 24">
<meta property="og:title" content="{esc(s['title'])}">
<meta property="og:description" content="{esc(kurz(s['description']))}">
<meta property="og:url" content="{canonical}">
<meta property="og:image" content="{BASE}/assets/img/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/assets/fonts/spectral-latin-600-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/public-sans-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/css/site.css?v={ASSETV}">
{werbung}
{ld}
</head>'''


def kopfleiste(s):
    nav = ''.join(f'<li><a href="{u}"{" aria-current=\"page\"" if u == s["url"] else ""}>{esc(t)}</a></li>' for u, t in NAV)
    reg = ''.join(f'<li><a href="{u}"{" aria-current=\"page\"" if s.get("lasche") == k else ""}>{esc(t)}</a></li>' for k, t, u in REGISTER)
    return f'''<a class="skip" href="#inhalt">Zum Inhalt springen</a>
<header class="kopf">
  <div class="wrap">
    <a class="marke" href="/">{LOGO}<span><b>Vorlagenfundus 24</b><span class="unter">Briefe · Fristen · AT DE CH</span></span></a>
    <button class="nav-btn" type="button" aria-expanded="false" aria-controls="hauptnav">Menü</button>
    <nav id="hauptnav" class="hauptnav" aria-label="Hauptnavigation"><ul>{nav}</ul></nav>
  </div>
</header>
<nav class="register" aria-label="Themenregister"><div class="wrap"><ol>{reg}</ol></div></nav>'''


def stand_text(s):
    """Datum, an dem die Rechtsangaben dieser Seite geprüft wurden. Meta „stand“ ersetzt das allgemeine
    Datum (Seite vollständig neu geprüft), „standZusatz“ nennt später geprüfte Teile einer älteren Seite."""
    t = s.get('stand', STAND)
    return t + (' · ' + s['standZusatz'] if s.get('standZusatz') else '')


def fuss(s):
    return f'''<footer class="fuss">
  <div class="wrap">
    <div class="fuss-raster">
      <div>
        <h2>Vorlagenfundus 24</h2>
        <p>Brief-Assistent für Alltagsschreiben in Österreich, Deutschland und der Schweiz. Alle Eingaben bleiben in Ihrem Browser. Die Inhalte ersetzen keine Rechtsberatung.</p>
        <p>Stand der Rechtsangaben auf dieser Seite: {stand_text(s)}</p>
      </div>
      <div>
        <h2>Vorlagen</h2>
        <ul>
          <li><a href="/wohnung-kuendigen/">Wohnung kündigen</a></li>
          <li><a href="/ruecktritt-online-kauf/">Rücktritt vom Online-Kauf</a></li>
          <li><a href="/vollmacht-post-pakete/">Vollmacht Post</a></li>
          <li><a href="/fristen-tabelle/">Fristentabelle</a></li>
          <li><a href="/vorlagen/">Alle Vorlagen</a></li>
        </ul>
      </div>
      <div>
        <h2>Rechtliches</h2>
        <ul>
          <li><a href="/ueber-uns/">Über uns</a></li>
          <li><a href="/so-entsteht-eine-vorlage/">Methodik und Quellen</a></li>
          <li><a href="/impressum/">Impressum</a></li>
          <li><a href="/datenschutz/">Datenschutz</a></li>
          <li><a href="/kontakt/">Kontakt</a></li>
          <li><button type="button" class="linkknopf" data-cmp-widerruf>Datenschutz-Einstellungen</button></li>
        </ul>
        <p id="cmp-status" class="visually-hidden" role="status"></p>
      </div>
    </div>
    <p class="klein">© 2026 AdStern, Wien · Vorlagenfundus 24 ist ein unabhängiges Informationsangebot und steht in keiner Verbindung zu Behörden, Interessenvertretungen oder Postunternehmen.</p>
  </div>
{SHOP_LINK}</footer>'''


def krumen_html(s):
    k = s.get('krumen', [])
    if not k:
        return ''
    teile = ['<li><a href="/">Start</a></li>']
    for i, (name, url) in enumerate(k):
        if i == len(k) - 1:
            teile.append(f'<li aria-current="page">{esc(name)}</li>')
        else:
            teile.append(f'<li><a href="{url}">{esc(name)}</a></li>')
    return f'<nav class="krumen" aria-label="Brotkrumen"><ol>{"".join(teile)}</ol></nav>'


def werkzeug_html(s):
    w = s.get('werkzeug')
    if not w:
        return ''
    attrs = ' '.join(f'data-{k}="{esc(v)}"' for k, v in w.items() if k not in ('titel', 'unter'))
    unter = f'<p class="mono" style="margin:0;font-size:.8rem;color:var(--muted)">{esc(w.get("unter", "Läuft lokal im Browser · nichts wird gesendet"))}</p>'
    return f'''<section class="werkzeug" aria-labelledby="wz-titel">
  <div class="wz-kopf"><h2 id="wz-titel">{esc(w['titel'])}</h2>{unter}</div>
  <div {attrs}><noscript><p class="noscript">Der Assistent braucht JavaScript. Die Erklärungen und Musterformulierungen unten funktionieren auch ohne.</p></noscript><p class="status" style="padding:1.2rem">Assistent wird geladen …</p></div>
</section>'''


def quellen_html(s):
    q = s.get('quellen')
    if not q:
        return ''
    li = ''.join(f'<li><a href="{esc(u)}" rel="noopener">{esc(t)}</a></li>' for t, u in q)
    return (f'<section class="quellen" aria-labelledby="quellen"><h2 id="quellen">Quellen</h2>'
            f'<p class="stand">Stand: {STAND} · Alle Paragrafen wurden in der jeweils geltenden Fassung im amtlichen Rechtsinformationssystem gelesen.</p>'
            f'<ol>{li}</ol></section>')


def seite(s):
    url = s['url']
    canonical = BASE + url
    body, toc = toc_aus_html(daten_einfuegen(s, s['body']))
    ohne = s.get('ohneWerbung')
    if ohne:
        body = body.replace('<!--anzeige-->', '').replace('<!--banner-->', '')
    else:
        body = werbung_einfuegen(body)
    laender = ''.join(f'<span class="land">{l}</span>' for l in s.get('laender', []))
    stempel = ''
    if s.get('vorlage'):
        stempel = (f'<p class="stempel"><span>Stand: {stand_text(s)}</span><span class="laender">{laender}</span>'
                   f'<span class="rot">Keine Rechtsberatung</span></p>')
    elif laender:
        stempel = f'<p class="stempel"><span>Stand: {stand_text(s)}</span><span class="laender">{laender}</span></p>'
    disclaimer = ''
    if s.get('vorlage'):
        disclaimer = ('<div class="hinweis warn"><strong>Keine Rechtsberatung</strong><p>Prüfen Sie Vertrag, Statuten und mögliche Sonderregeln. '
                      '<a href="/so-entsteht-eine-vorlage/#beratung">Grenzen der Berechnung und persönliche Beratungsstellen</a>.</p></div>')
    toc_html = ''
    if len(toc) >= 3 and not s.get('ohneLeiste'):
        toc_html = '<nav class="toc" aria-label="Auf dieser Seite"><b>Auf dieser Seite</b><ol>' + ''.join(
            f'<li><a href="#{a}">{esc(t)}</a></li>' for a, t in toc) + '</ol></nav>'
    leiste = ''
    mit_leiste = not s.get('ohneLeiste')
    if mit_leiste:
        leiste = f'<aside class="leiste" aria-label="Seitenleiste">{toc_html}{"" if ohne else anzeige("seite")}</aside>'
    scripts = ['<script src="/assets/js/site.js?v=' + ASSETV + '" defer></script>']
    if s.get('tabelle'):
        scripts.insert(0, '<script src="/assets/js/tabelle.js?v=' + ASSETV + '" defer></script>')
    if s.get('werkzeug'):
        scripts.insert(0, '<script src="/assets/js/brief.js?v=' + ASSETV + '" defer></script>')
        scripts.insert(0, '<script src="/assets/js/fristen.js?v=' + ASSETV + '" defer></script>')
    lead = f'<p class="lead">{s["lead"]}</p>' if s.get('lead') else ''
    held = s.get('held')
    if held:
        kopfbereich = held
    else:
        kopfbereich = f'''<div class="seitenkopf">
      {krumen_html(s)}
      <h1>{esc(s['h1'])}</h1>
      {lead}
      {stempel}
    </div>'''
    return f'''{kopf(s, canonical)}
<body{' data-ohne-werbung' if ohne else ''}>
{kopfleiste(s)}
<main id="inhalt">
  <div class="wrap">
    {kopfbereich}
    {disclaimer if s.get('werkzeug') else ''}
    {werkzeug_html(s)}
    <div class="inhalt{' mit-leiste' if mit_leiste else ''}">
      <article class="text-spalte">
        {body}
        {disclaimer if (s.get('vorlage') and not s.get('werkzeug')) else ''}
        {quellen_html(s)}
      </article>
      {leiste}
    </div>
  </div>
</main>
{fuss(s)}
{''.join(scripts)}
</body>
</html>
'''


def weiterleitung(alt, ziel, titel):
    z = BASE + ziel
    return f'''<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(titel)} – Weiterleitung | Vorlagenfundus 24</title>
<meta name="robots" content="noindex,follow">
<meta name="google-adsense-account" content="{PUB}">
<link rel="canonical" href="{z}">
<meta http-equiv="refresh" content="0; url={ziel}">
<style>body{{font:1rem/1.6 system-ui,sans-serif;background:#FBF9F4;color:#1A1A1A;margin:0;padding:2rem 16px}}a{{color:#1A1A1A}}</style>
</head>
<body>
<main><h1>Diese Seite ist umgezogen</h1><p>Weiter zu <a href="{ziel}">{esc(titel)}</a>.</p></main>
</body>
</html>
'''


WEITERLEITUNGEN = [
    ('druckvorlage-pruefen.html', '/oenorm-a-1080-din-5008/', 'Briefnormen und Fensterkuvert-Prüfung'),
    ('advertise.html', '/kontakt/', 'Kontakt'),
    ('imprint.html', '/impressum/', 'Impressum'),
    ('privacy.html', '/datenschutz/', 'Datenschutz'),
    ('about.html', '/ueber-uns/', 'Über uns'),
]


def main():
    seiten = lade_seiten()
    urls = set()
    for s in seiten:
        if s['url'] in urls:
            raise SystemExit('Doppelte URL ' + s['url'])
        urls.add(s['url'])
        ziel = OUT / s['url'].strip('/') / 'index.html' if s['url'] != '/' else OUT / 'index.html'
        if s['url'] == '/404/':
            ziel = OUT / '404.html'
        ziel.parent.mkdir(parents=True, exist_ok=True)
        ziel.write_text(seite(s), encoding='utf-8')
    for alt, ziel, titel in WEITERLEITUNGEN:
        (OUT / alt).write_text(weiterleitung(alt, ziel, titel), encoding='utf-8')
    # Sitemap
    eintraege = [s for s in seiten if not s.get('noindex') and s['url'] != '/404/']
    xml = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for s in sorted(eintraege, key=lambda x: (x['url'] != '/', x['url'])):
        # "geaendert" im Meta-Kopf: Seite nach dem Stand der Rechtsangaben inhaltlich geändert
        xml.append(f'  <url><loc>{BASE}{s["url"]}</loc><lastmod>{s.get("geaendert", LASTMOD)}</lastmod></url>')
    xml.append('</urlset>')
    (OUT / 'sitemap.xml').write_text('\n'.join(xml) + '\n', encoding='utf-8')
    (OUT / 'robots.txt').write_text(f'User-agent: *\nAllow: /\n\nSitemap: {BASE}/sitemap.xml\n', encoding='utf-8')
    (OUT / 'ads.txt').write_text('google.com, pub-7811071715414905, DIRECT, f08c47fec0942fa0\n', encoding='utf-8')
    (OUT / 'CNAME').write_text('vorlagenfundus24.de', encoding='utf-8')
    (OUT / '.nojekyll').write_text('', encoding='utf-8')
    (OUT / 'favicon.svg').write_text(LOGO.replace('aria-hidden="true" focusable="false"', 'xmlns="http://www.w3.org/2000/svg"').replace('<rect x="3" y="7"', '<rect width="40" height="40" rx="6" fill="#1A1A1A"/><rect x="3" y="7"'), encoding='utf-8')
    print(f'{len(seiten)} Seiten, {len(WEITERLEITUNGEN)} Weiterleitungen gebaut.')


if __name__ == '__main__':
    main()
