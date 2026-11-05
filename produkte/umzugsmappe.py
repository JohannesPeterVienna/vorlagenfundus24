"""Umzugsmappe (PDF, A4, ausfüllbar) – Shop-Produkt von Vorlagenfundus 24.

Aufruf: python produkte/umzugsmappe.py <Zielordner>. Nur PDF-Standardschriften. Ergebnis gehört NICHT nach docs/.
Rechtsangaben bewusst knapp und nur dort, wo sie eindeutig sind (Meldefristen AT/DE); alles andere als Erinnerung formuliert.
"""
import sys
from pathlib import Path
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.colors import Color, white
from reportlab.pdfgen import canvas

INK = Color(.1, .1, .1); MUTED = Color(.35, .35, .35); RED = Color(.639, .176, .176); LINE = Color(.75, .75, .75)
W, H = A4
STAND = "Stand November 2026"
_n = [0]


def feld(c, x, y, w, h=7 * mm, name=None, size=10):
    _n[0] += 1
    c.acroForm.textfield(name=name or f"f{_n[0]}", x=x, y=y, width=w, height=h, borderWidth=0, fillColor=white, textColor=INK,
                         fontName="Helvetica", fontSize=size, forceBorder=False)
    c.setStrokeColor(LINE); c.setLineWidth(.6); c.line(x, y, x + w, y)


def haken(c, x, y, name=None):
    _n[0] += 1
    c.acroForm.checkbox(name=name or f"c{_n[0]}", x=x, y=y, size=4.2 * mm, borderColor=INK, fillColor=white, buttonStyle="check", borderWidth=0.8)


def kopf(c, titel, unter=""):
    c.setFillColor(INK); c.setFont("Times-Bold", 22); c.drawString(20 * mm, H - 24 * mm, titel)
    if unter:
        c.setFont("Helvetica", 9.5); c.setFillColor(MUTED); c.drawString(20 * mm, H - 30 * mm, unter)
    c.setStrokeColor(INK); c.setLineWidth(1.5); c.line(20 * mm, H - 33 * mm, W - 20 * mm, H - 33 * mm)


def fuss(c, n):
    c.setFont("Helvetica", 7.5); c.setFillColor(MUTED)
    c.drawString(20 * mm, 10 * mm, "Vorlagenfundus 24 · vorlagenfundus24.de · Umzugsmappe")
    c.drawRightString(W - 20 * mm, 10 * mm, f"{STAND} · keine Rechtsberatung · Seite {n}")


def seite_deckblatt(c):
    c.setFillColor(INK); c.setFont("Times-Bold", 40); c.drawString(20 * mm, H - 70 * mm, "Umzugsmappe")
    c.setFont("Times-Roman", 20); c.drawString(20 * mm, H - 82 * mm, "Österreich · Deutschland · Schweiz")
    c.setStrokeColor(INK); c.setLineWidth(1.5); c.line(20 * mm, H - 88 * mm, W - 20 * mm, H - 88 * mm)
    c.setStrokeColor(RED); c.setLineWidth(2.5); c.rect(W - 78 * mm, H - 66 * mm, 56 * mm, 20 * mm, stroke=1, fill=0)
    c.setFillColor(RED); c.setFont("Courier-Bold", 13); c.drawCentredString(W - 50 * mm, H - 55 * mm, "NICHTS VERGESSEN"); c.setFont("Courier", 10); c.drawCentredString(W - 50 * mm, H - 61 * mm, "vom Kündigen bis zur Übergabe")
    c.setFillColor(INK); c.setFont("Helvetica", 11)
    inhalt = ["1  Zeitplan: was wann zu tun ist", "2  Kündigen und Fristen im Blick", "3  Adressänderung: wer Bescheid wissen muss",
              "4  Wohnungsübergabe-Protokoll (2 Seiten)", "5  Versand-Protokoll für wichtige Briefe"]
    y = H - 110 * mm
    for t in inhalt: c.drawString(20 * mm, y, t); y -= 8 * mm
    c.setFont("Helvetica", 9.5); c.setFillColor(MUTED)
    y -= 6 * mm
    for t in ["Alle Felder lassen sich am Computer ausfüllen (PDF-Formular) oder ausgedruckt mit Stift.",
              "Die Briefe selbst – Kündigung, Kaution zurückfordern, Mängelanzeige – erstellen Sie kostenlos mit",
              "Fristberechnung auf vorlagenfundus24.de.",
              "Diese Mappe ersetzt keine Rechtsberatung. Verträge und Hausordnungen können abweichen."]:
        c.drawString(20 * mm, y, t); y -= 5.5 * mm
    fuss(c, 1)


ZEITPLAN = [
    ("3 Monate vorher", ["Mietvertrag prüfen: Kündigungsfrist und -termin (Brief-Assistent „Wohnung kündigen“)",
                         "Kündigung schreiben und nachweisbar verschicken (Versand-Protokoll, Seite 7)",
                         "Verträge prüfen, die am Wohnort hängen: Internet, Strom, Gas, Parkplatz, Fitnessstudio"]),
    ("6–8 Wochen vorher", ["Umzugshilfe oder Umzugsfirma anfragen, Angebote vergleichen", "Urlaub bzw. Freistellung für den Umzugstag klären",
                           "Halteverbot bzw. Ladezone bei der Gemeinde oder Stadt beantragen, falls nötig", "Ausmisten: verkaufen, verschenken, Sperrmüll-Termin"]),
    ("2–4 Wochen vorher", ["Nachsendeauftrag bei der Post einrichten", "Strom, Gas, Internet am neuen Ort anmelden, am alten abmelden",
                           "Termin für die Wohnungsübergabe vereinbaren", "Kartons, Klebeband, Beschriftung besorgen"]),
    ("Umzugswoche", ["Zählerstände alt und neu fotografieren (Protokoll, Seite 5)", "Schlüssel zählen, Übergabe vorbereiten",
                     "Wichtige Unterlagen und Ausweise separat transportieren"]),
    ("Nach dem Umzug", ["Wohnsitz anmelden – Österreich: binnen 3 Tagen (Meldegesetz), Deutschland: binnen 2 Wochen (Bundesmeldegesetz), Schweiz: je nach Gemeinde, dort nachfragen",
                        "Adressänderungen durchgeben (Liste, Seite 4)", "Kaution zurückfordern, sobald die Übergabe erledigt ist (Brief-Assistent „Kaution“)"]),
]


def seite_zeitplan(c):
    kopf(c, "1  Zeitplan", "Abhaken, was erledigt ist. Die Reihenfolge ist ein Vorschlag – Ihr Vertrag kann andere Fristen haben.")
    y = H - 44 * mm
    for block, punkte in ZEITPLAN:
        c.setFont("Helvetica-Bold", 11); c.setFillColor(RED if block == "Nach dem Umzug" else INK); c.drawString(20 * mm, y, block); y -= 7 * mm
        c.setFillColor(INK); c.setFont("Helvetica", 9.8)
        for p in punkte:
            from reportlab.lib.utils import simpleSplit
            zeilen = simpleSplit(p, "Helvetica", 9.8, W - 50 * mm)
            haken(c, 21 * mm, y - 1.2 * mm)
            for i, z in enumerate(zeilen):
                c.drawString(29 * mm, y, z); y -= 5 * mm
            y -= 1.6 * mm
        y -= 3 * mm
    fuss(c, 2)


def seite_fristen(c):
    kopf(c, "2  Kündigen und Fristen", "Eintragen, was wann beim Empfänger sein muss. Die Fristen berechnet der Brief-Assistent auf vorlagenfundus24.de.")
    spalten = [("Vertrag / Empfänger", 62), ("Kündigungsfrist", 32), ("Zugang spätestens", 32), ("verschickt am", 26), ("bestätigt", 18)]
    x0, y = 20 * mm, H - 46 * mm
    c.setFont("Helvetica-Bold", 8.5); c.setFillColor(MUTED); x = x0
    for t, w in spalten: c.drawString(x, y, t); x += w * mm
    y -= 4 * mm
    vorschlag = ["Mietvertrag", "Strom", "Gas / Fernwärme", "Internet / Festnetz", "Handyvertrag", "Haushaltsversicherung", "Garage / Stellplatz", "Fitnessstudio / Verein", "", ""]
    for v in vorschlag:
        y -= 9 * mm; x = x0
        for i, (t, w) in enumerate(spalten):
            if i == 4: haken(c, x + 5 * mm, y + 1 * mm)
            else:
                feld(c, x, y, (w - 3) * mm)
                if i == 0 and v: c.setFont("Helvetica", 9); c.setFillColor(MUTED); c.drawString(x + 1, y + 7.6 * mm, v)
            x += w * mm
    y -= 14 * mm
    c.setFillColor(INK); c.setFont("Helvetica-Bold", 10); c.drawString(20 * mm, y, "Wichtig")
    c.setFont("Helvetica", 9.5); y -= 6 * mm
    for t in ["Bei Kündigungen zählt meist der Zugang beim Empfänger, nicht das Absendedatum. Postlaufzeit einplanen.",
              "Kündigungen nachweisbar verschicken (z. B. Einschreiben) und den Beleg aufheben – Versand-Protokoll, Seite 7.",
              "Um eine schriftliche Bestätigung des Vertragsendes bitten."]:
        c.drawString(20 * mm, y, "– " + t); y -= 5.5 * mm
    fuss(c, 3)


ADRESSE = ["Arbeitgeber", "Bank(en)", "Krankenversicherung", "Weitere Versicherungen", "Finanzamt / Steuerberatung", "Kfz-Zulassung bzw. Strassenverkehrsamt",
           "Rundfunkbeitrag (AT: ORF-Beitrag, DE: Rundfunkbeitrag, CH: Serafe)", "Strom- und Gasanbieter", "Internet- und Mobilfunkanbieter", "Ärztinnen und Ärzte",
           "Schule / Kindergarten", "Vereine, Abos, Zeitschriften", "Online-Shops und Lieferadressen", "Familie und Freunde", "", ""]


def seite_adressen(c):
    kopf(c, "3  Adressänderung", "Wer die neue Adresse braucht. Erledigtes abhaken und das Datum eintragen.")
    y = H - 46 * mm
    c.setFont("Helvetica-Bold", 8.5); c.setFillColor(MUTED)
    c.drawString(20 * mm, y, "Stelle"); c.drawString(118 * mm, y, "Kunden- / Vertragsnummer"); c.drawString(166 * mm, y, "erledigt am")
    for a in ADRESSE:
        y -= 9.6 * mm
        haken(c, 20 * mm, y + 1 * mm)
        if a: c.setFont("Helvetica", 9.5); c.setFillColor(INK); c.drawString(27 * mm, y + 2 * mm, a)
        else: feld(c, 27 * mm, y, 86 * mm)
        feld(c, 118 * mm, y, 44 * mm); feld(c, 166 * mm, y, 24 * mm)
    fuss(c, 4)


def seite_uebergabe1(c):
    kopf(c, "4  Wohnungsübergabe-Protokoll", "Bei der Übergabe gemeinsam ausfüllen und von beiden Seiten unterschreiben. Fotos machen und aufbewahren.")
    y = H - 46 * mm
    def zeile(label, breite=120):
        nonlocal y
        c.setFont("Helvetica", 9.5); c.setFillColor(INK); c.drawString(20 * mm, y + 1.5 * mm, label); feld(c, 70 * mm, y, breite * mm); y -= 10 * mm
    for l in ["Adresse der Wohnung", "Datum und Uhrzeit", "Vermieter / Hausverwaltung", "anwesend für die Vermieterseite", "Mieterin / Mieter", "neue Adresse der Mieterseite"]:
        zeile(l)
    y -= 2 * mm
    c.setFont("Helvetica-Bold", 11); c.drawString(20 * mm, y, "Zählerstände"); y -= 7 * mm
    c.setFont("Helvetica-Bold", 8.5); c.setFillColor(MUTED)
    for t, x in [("Zähler", 20), ("Zählernummer", 70), ("Stand", 120), ("Foto gemacht", 165)]: c.drawString(x * mm, y, t)
    for z in ["Strom", "Gas", "Wasser (kalt)", "Wasser (warm)", "Heizung / Wärmemenge"]:
        y -= 9 * mm
        c.setFont("Helvetica", 9.5); c.setFillColor(INK); c.drawString(20 * mm, y + 1.5 * mm, z)
        feld(c, 70 * mm, y, 45 * mm); feld(c, 120 * mm, y, 40 * mm); haken(c, 170 * mm, y + 1 * mm)
    y -= 12 * mm
    c.setFont("Helvetica-Bold", 11); c.drawString(20 * mm, y, "Schlüssel"); y -= 7 * mm
    c.setFont("Helvetica-Bold", 8.5); c.setFillColor(MUTED)
    for t, x in [("Art", 20), ("Anzahl übergeben", 120), ("davon nachgemacht", 160)]: c.drawString(x * mm, y, t)
    for s in ["Wohnungstür", "Haustür", "Briefkasten", "Keller / Abstellraum", "Garage / sonstige"]:
        y -= 9 * mm
        c.setFont("Helvetica", 9.5); c.setFillColor(INK); c.drawString(20 * mm, y + 1.5 * mm, s)
        feld(c, 120 * mm, y, 30 * mm); feld(c, 160 * mm, y, 30 * mm)
    fuss(c, 5)


def seite_uebergabe2(c):
    kopf(c, "4  Wohnungsübergabe-Protokoll (Fortsetzung)", "Zustand je Raum: in Ordnung oder Mangel beschreiben (Ort, Art, Größe). Bestehende Mängel nicht vergessen.")
    y = H - 46 * mm
    c.setFont("Helvetica-Bold", 8.5); c.setFillColor(MUTED)
    for t, x in [("Raum", 20), ("in Ordnung", 58), ("Mängel / Bemerkungen", 80)]: c.drawString(x * mm, y, t)
    for r in ["Vorraum / Flur", "Wohnzimmer", "Schlafzimmer", "Kinderzimmer", "Küche (inkl. Geräte)", "Bad", "WC", "Balkon / Terrasse", "Keller / Abstellraum", "Fenster und Türen", "", ""]:
        y -= 11 * mm
        if r: c.setFont("Helvetica", 9.5); c.setFillColor(INK); c.drawString(20 * mm, y + 2 * mm, r)
        else: feld(c, 20 * mm, y, 34 * mm)
        haken(c, 64 * mm, y + 1 * mm); feld(c, 80 * mm, y, 110 * mm)
    y -= 14 * mm
    c.setFont("Helvetica-Bold", 10); c.setFillColor(INK); c.drawString(20 * mm, y, "Vereinbarungen (z. B. Ausbesserungen bis …, Kaution, Nachzahlung)")
    for _ in range(3):
        y -= 9 * mm; feld(c, 20 * mm, y, 170 * mm)
    y -= 18 * mm
    for x, t in [(20, "Unterschrift Vermieterseite"), (115, "Unterschrift Mieterseite")]:
        c.setStrokeColor(INK); c.setLineWidth(.8); c.line(x * mm, y, (x + 75) * mm, y)
        c.setFont("Helvetica", 8.5); c.setFillColor(MUTED); c.drawString(x * mm, y - 4 * mm, t + " · Ort, Datum")
    fuss(c, 6)


def seite_versand(c):
    kopf(c, "5  Versand-Protokoll", "Für jede wichtige Kündigung ein Blatt. Aufgabeschein bzw. Einlieferungsbeleg anheften, Kopie des Schreibens dazulegen.")
    y = H - 50 * mm
    for l in ["Schreiben (Betreff)", "Empfänger", "Datum des Schreibens", "Frist: Zugang spätestens am", "Aufgegeben am (Datum, Uhrzeit)",
              "Versandart (Einschreiben, Einwurf, Bote …)", "Einschreibe- / Sendungsnummer", "Postfiliale bzw. Ort des Einwurfs", "Zeugin / Zeuge (Name, Anschrift)",
              "Zugang bestätigt am", "Bestätigung abgelegt (Ordner, Datei)"]:
        c.setFont("Helvetica", 9.5); c.setFillColor(RED if "Frist" in l else INK); c.drawString(20 * mm, y + 1.5 * mm, l)
        feld(c, 92 * mm, y, 98 * mm); y -= 11 * mm
    y -= 10 * mm
    c.setStrokeColor(INK); c.line(20 * mm, y, 95 * mm, y)
    c.setFont("Helvetica", 8.5); c.setFillColor(MUTED); c.drawString(20 * mm, y - 4 * mm, "Unterschrift · Ort, Datum")
    c.setFont("Helvetica", 9); c.setFillColor(INK)
    c.drawString(20 * mm, 30 * mm, "Tipp: Den Versand-Protokoll-Vordruck mit allen Daten Ihres Briefes erzeugt der Brief-Assistent auf")
    c.drawString(20 * mm, 25 * mm, "vorlagenfundus24.de automatisch – inklusive berechneter Frist und Kalenderdatei fürs Handy.")
    fuss(c, 7)


def main(target):
    target = Path(target); target.mkdir(parents=True, exist_ok=True)
    out = target / "vorlagenfundus24-umzugsmappe.pdf"
    c = canvas.Canvas(str(out), pagesize=A4); c.setTitle("Umzugsmappe – Vorlagenfundus 24"); c.setAuthor("Vorlagenfundus 24 (AdStern)")
    for f in (seite_deckblatt, seite_zeitplan, seite_fristen, seite_adressen, seite_uebergabe1, seite_uebergabe2, seite_versand):
        f(c); c.showPage()
    c.save(); print(out)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent.parent / "vf-produkte")
