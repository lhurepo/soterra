# Generates the Soterra "Tide Table" iOS mockups as self-contained HTML (one per frame) plus an index.
import pathlib

OUT = pathlib.Path(__file__).resolve().parent

ICON = {
 "phone": '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
 "flame": '<path d="M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 0-3-1-5 1-8.5z"/>',
 "home": '<path d="M4 11 12 4l8 7v9h-5v-6H9v6H4z"/>',
 "bell": '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20h4"/>',
 "map": '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14"/>',
 "people": '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6M16 5.5a3 3 0 0 1 0 5.5M18 14c2 .8 3 3 3 6"/>',
 "more": '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
 "chev": '<path d="m9 5 7 7-7 7"/>',
 "down": '<path d="m6 9 6 6 6-6"/>',
 "back": '<path d="m15 5-7 7 7 7"/>',
 "chat": '<path d="M4 5h16v11H9l-5 4z"/>',
 "shelter": '<path d="M3 11 12 4l9 7M6 9v11h12V9M10 20v-5h4v5"/>',
 "warn": '<path d="M12 3 2 20h20zM12 10v4M12 17v.5"/>',
 "check": '<path d="m5 12 4.5 4.5L19 7"/>',
 "wifioff": '<path d="M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5-2.7M14 10.3A10 10 0 0 1 19 13M12 20v.5"/>',
 "clock": '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
 "pin": '<path d="M12 21s7-6.2 7-11.5a7 7 0 0 0-14 0C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
 "list": '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.5M3.5 12h.5M3.5 18h.5"/>',
 "gear": '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
 "mic": '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
 "send": '<path d="M4 12 20 4l-6 16-3-7z"/>',
 "search": '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
 "road": '<path d="M7 3 4 21M17 3l3 18M12 4v3M12 11v3M12 18v3"/>',
 "info": '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 7.5v.5"/>',
 "lock": '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
 "globe": '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c3 3.5 3 13.5 0 17M12 3.5c-3 3.5-3 13.5 0 17"/>',
 "box": '<path d="M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10"/>',
}

def ic(name, size=22, color="currentColor", sw=2):
    return (f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="{color}" '
            f'stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round">{ICON[name]}</svg>')

DARK = dict(bg="#041421", surf="#042630", surf2="#0A3340", line="#143A44", text="#D0D6D6", muted="#8FA6A6",
            accent="#86B9B0", onaccent="#041421", plate="#D0D6D6", ontplate="#041421", platemuted="#3C5557",
            tab="#06192A", chipink="#1D0E02", warn="#E2C044")
LIGHT = dict(bg="#E4E9E9", surf="#FFFFFF", surf2="#F1F4F4", line="#C9D2D2", text="#041421", muted="#4A6466",
             accent="#2F5557", onaccent="#FFFFFF", plate="#041421", ontplate="#D0D6D6", platemuted="#9FB5B5",
             tab="#F4F6F6", chipink="#1D0E02", warn="#8A5A00")
DARK["name"], LIGHT["name"] = "dark", "light"
# Severity: high = red, medium = orange, low = yellow.
SEV = {"Extreme": "#E5484D", "Severe": "#E8833A", "Moderate": "#E2C044", "Minor": "#E2C044", "Unknown": "#8FA6A6"}
LEVEL = {"Extreme": "high", "Severe": "medium", "Moderate": "low", "Minor": "low"}

# Tinted card tones per theme: top/bottom of a soft vertical gradient, border, heading, secondary text,
# divider, chip ink. Alerts stay dark in dark mode and light in light mode; never an inverted plate.
TINT = {
 "dark": {
  "high":    dict(top="#3A1720", bot="#220F16", border="#8E3540", head="#F6E3E4", muted="#DDAAAE", line="#5C2730", ink="#1A0507", note="#FF8E93"),
  "medium":  dict(top="#3A2413", bot="#23160C", border="#93582A", head="#F6E8DA", muted="#E0B793", line="#5E3D20", ink="#1D0E02", note="#F2A766"),
  "low":     dict(top="#332B14", bot="#1F1B0D", border="#80702A", head="#F4EDD3", muted="#D6C789", line="#53491D", ink="#1A1503", note="#E9CF6A"),
  "calm":    dict(top="#0E3A3B", bot="#08282C", border="#2F6662", head="#DCE6E4", muted="#9CC5BE", line="#1F4E4D", ink="#041421", note="#86B9B0"),
  "neutral": dict(top="#0C3442", bot="#062A35", border="#1B4A56", head="#D0D6D6", muted="#9AB2B3", line="#1B4A56", ink="#041421", note="#86B9B0"),
 },
 "light": {
  "high":    dict(top="#FDEFF0", bot="#FAE2E4", border="#E9A4A9", head="#3B0D12", muted="#8A3138", line="#F0C4C8", ink="#1A0507", note="#B3262B"),
  "medium":  dict(top="#FEF4EA", bot="#FCE8D6", border="#EDB98F", head="#3A1E08", muted="#8A4A14", line="#F2D4B9", ink="#1D0E02", note="#A85314"),
  "low":     dict(top="#FCF8E6", bot="#F8F0CF", border="#E2CD78", head="#2E2604", muted="#6E5A0E", line="#EDE1AA", ink="#1A1503", note="#7A6410"),
  "calm":    dict(top="#EAF4F2", bot="#DCEDE9", border="#A9CEC7", head="#041421", muted="#2F5557", line="#C2DDD8", ink="#041421", note="#2F5557"),
  "neutral": dict(top="#FFFFFF", bot="#F4F7F7", border="#C9D2D2", head="#041421", muted="#4A6466", line="#DCE3E3", ink="#041421", note="#2F5557"),
 },
}

def tone(theme, level):
    t = TINT[theme["name"]][level]
    return (f"--ptop:{t['top']};--pbot:{t['bot']};--pborder:{t['border']};--ph:{t['head']};"
            f"--pm:{t['muted']};--pl:{t['line']};--pnote:{t['note']};")

def css(t):
    return f"""
:root{{--bg:{t['bg']};--surf:{t['surf']};--surf2:{t['surf2']};--line:{t['line']};--text:{t['text']};--muted:{t['muted']};
--accent:{t['accent']};--onaccent:{t['onaccent']};--plate:{t['plate']};--onplate:{t['ontplate']};--platemuted:{t['platemuted']};--tab:{t['tab']};
--red:#E5484D;--sev:#E8833A;--amber:{t['warn']}}}
*{{box-sizing:border-box;margin:0;padding:0}}
body{{width:390px;height:844px;overflow:hidden;position:relative;background:var(--bg);color:var(--text);
font:400 17px/1.3 Inter,-apple-system,sans-serif;font-variant-numeric:tabular-nums;letter-spacing:-.01em}}
.sb{{height:50px;display:flex;justify-content:space-between;align-items:flex-end;padding:0 30px 8px;font-weight:600;font-size:16px}}
.nav{{height:44px;display:flex;justify-content:space-between;align-items:center;padding:0 16px}}
.loc{{display:flex;align-items:center;gap:4px;color:var(--accent);font-weight:500;font-size:17px}}
.navback{{display:flex;align-items:center;gap:2px;color:var(--accent);font-size:17px}}
.pill{{background:var(--red);color:#fff;font-weight:700;font-size:15px;height:34px;padding:0 14px;border-radius:17px;display:flex;gap:6px;align-items:center}}
.title{{font:600 34px/1.1 Outfit,Inter,sans-serif;letter-spacing:-.02em;padding:4px 16px 12px}}
.inline-title{{font-weight:600;font-size:17px}}
.chip{{display:inline-flex;gap:5px;align-items:center;font-weight:700;font-size:13px;height:26px;padding:0 10px;border-radius:13px;color:#1D0E02}}
.plate{{margin:0 16px;background:linear-gradient(180deg,var(--ptop),var(--pbot));color:var(--ph);border:1px solid var(--pborder);border-radius:16px;padding:16px}}
.plate h2{{font:600 24px/1.15 Outfit,Inter,sans-serif;letter-spacing:-.01em;margin:10px 0 4px}}
.plate .sub{{font-size:15px;color:var(--pm)}}
.spine{{display:flex;margin-top:14px;border-top:1px solid var(--pl);padding-top:8px}}
.spine div{{flex:1;font-size:12px;color:var(--pm)}}
.spine b{{display:block;font-size:16px;color:var(--ph);font-weight:600;margin-top:1px}}
.src{{margin-top:10px;font-size:12px;color:var(--pm);display:flex;align-items:center;gap:6px}}
.badge{{font-size:11px;font-weight:600;padding:2px 6px;border-radius:4px;border:1px solid currentColor}}
.row2{{display:flex;gap:8px;margin-top:14px}}
.btn{{flex:1;height:48px;border-radius:12px;display:flex;align-items:center;justify-content:center;gap:8px;font-weight:600;font-size:17px}}
.btn-p{{background:var(--accent);color:var(--onaccent)}}
.btn-o{{color:var(--accent);border:1.5px solid var(--accent)}}
.plate .btn-o{{color:var(--ph);border-color:var(--pborder)}}
.tiles{{display:flex;gap:8px;margin:12px 16px 0}}
.tile{{flex:1;background:var(--surf);border-radius:14px;padding:12px;min-height:76px}}
.tile .h{{display:flex;align-items:center;gap:8px;font-weight:600;font-size:16px;color:var(--text)}}
.tile .h svg{{color:var(--accent)}}
.tile p{{font-size:13px;color:var(--muted);margin-top:6px}}
.tile p.warn{{color:var(--amber)}}
.sect{{display:flex;justify-content:space-between;align-items:baseline;padding:20px 16px 8px}}
.sect span:first-child{{font-size:20px;font-weight:600}}
.sect a{{font-size:15px;color:var(--accent);text-decoration:none}}
.tbl{{margin:0 16px;border-top:1px solid var(--line)}}
.tr{{display:flex;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)}}
.tr .t{{width:68px;flex:none;font-weight:600;color:var(--accent);font-size:15px}}
.tr p{{font-size:15px}}
.tr small{{display:block;color:var(--muted);font-size:12px;margin-top:2px}}
.callbar{{position:absolute;left:0;right:0;bottom:83px;padding:10px 16px;background:var(--surf);display:flex;gap:8px;border-top:1px solid var(--line)}}
.tabs{{position:absolute;left:0;right:0;bottom:0;height:83px;background:var(--tab);border-top:1px solid var(--line);display:flex;padding-top:7px}}
.tabs div{{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;font-size:10px;font-weight:500;color:var(--muted)}}
.tabs .on{{color:var(--accent)}}
.foot{{font-size:12px;color:var(--muted);padding:14px 16px;text-align:center}}
.card{{background:var(--surf);border-radius:14px;margin:0 16px;padding:14px}}
.list{{margin:0 16px;background:var(--surf);border-radius:14px;overflow:hidden}}
.li{{display:flex;align-items:center;gap:12px;padding:0 16px;min-height:52px;border-bottom:1px solid var(--line)}}
.li:last-child{{border-bottom:0}}
.li .grow{{flex:1}}
.li small{{display:block;font-size:13px;color:var(--muted)}}
.li .ico{{color:var(--accent);display:flex}}
.li .chev{{color:var(--muted);display:flex}}
.cnt{{background:var(--accent);color:var(--onaccent);font-size:13px;font-weight:700;border-radius:10px;padding:1px 8px}}
.banner{{margin:0 16px 12px;padding:10px 12px;border-radius:12px;display:flex;align-items:center;gap:10px;font-size:15px}}
"""

def page(title, theme, body):
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=390">
<title>{title}</title>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@500;600&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>{css(theme)}</style>
<script src="https://mcp.figma.com/mcp/html-to-design/capture.js" async></script></head><body>
{body}
</body></html>"""

def status(t='2:22'): return f'<div class="sb"><span>{t}</span><span>5G&nbsp;&nbsp;41%</span></div>'
def nav(left=None):
    left = left or f'<span class="loc">Sonoma County, CA {ic("down",16)}</span>'
    return f'<div class="nav">{left}<span class="pill">{ic("phone",16,"#fff",2.2)}911</span></div>'
def back(label): return f'<span class="navback">{ic("back",22)}{label}</span>'
def tabs(on="Home"):
    items = [("Home","home"),("Alerts","bell"),("Map","map"),("Household","people"),("More","more")]
    return '<div class="tabs">' + "".join(
        f'<div class="{"on" if n==on else ""}">{ic(i,26,sw=1.8)}{n}</div>' for n,i in items) + '</div>'
def callbar():
    return (f'<div class="callbar"><span class="btn btn-p">{ic("phone",18)}Call Soterra</span>'
            f'<span class="btn btn-o">{ic("chat",18)}Ask Soterra</span></div>')
def chip(sev, label=None):
    ink = TINT["dark"][LEVEL.get(sev, "low")]["ink"]
    return f'<span class="chip" style="background:{SEV[sev]};color:{ink}">{ic("warn",14,ink,2.4)}{label or sev}</span>'

def plate(theme, sev, chiplabel, head, sub, times, src, extra_style="", note=""):
    sp = "".join(f'<div>{a}<b>{b}</b></div>' for a,b in times)
    return f"""<section class="plate" style="{tone(theme, LEVEL[sev])}{extra_style}">
  {chip(sev, chiplabel)}
  {note}
  <h2>{head}</h2>
  <p class="sub">{sub}</p>
  <div class="spine">{sp}</div>
  <p class="src">{src} <span class="badge">Official</span></p>
  <div class="row2"><span class="btn btn-p">What to do</span><span class="btn btn-o">Ask about this</span></div>
</section>"""

def today(rows, theme=DARK):
    def dot(sev):
        ink = SEV[sev] if theme["name"] == "dark" else TINT["light"][LEVEL[sev]]["note"]
        return (f'<span style="flex:none;display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;'
                f'color:{ink};margin-top:2px"><span style="width:8px;height:8px;border-radius:4px;background:{SEV[sev]}"></span>'
                f'{ {"high":"High","medium":"Med","low":"Low"}[LEVEL[sev]] }</span>')
    return '<div class="tbl">' + "".join(
        f'<div class="tr"><span class="t">{t}</span><p style="flex:1">{p}<small>{s}</small></p>{dot(v)}</div>' for t,p,s,v in rows) + '</div>'

SRC_EM = "Sonoma County Emergency Management (Demo)"
TODAY = [("2:10 PM","Fire about 1,200 acres, 10% contained","Sonoma County Fire Information (Demo)","Severe"),
         ("12:05 PM","Ridgeview Rd closed, Hwy 12 to Bennett Valley Rd","Caltrans District 4 (Demo)","Moderate")]

def tiles(hh="Leo hasn&#8217;t checked in &middot; 45 min", warn=True):
    return f"""<div class="tiles">
  <div class="tile"><div class="h">{ic("shelter",20)}Find a shelter</div><p>2 open &middot; checked 2:30 PM</p></div>
  <div class="tile"><div class="h">{ic("people",20)}Household</div><p class="{"warn" if warn else ""}">{hh}</p></div>
</div>"""

def home_crisis(theme):
    return status() + nav() + '<div class="title">Ridgeview Fire</div>' + plate(
        theme, "Severe", "Severe &middot; Warning", "Evacuation Warning. Be ready to leave.",
        "Zones SON-3A and SON-3B, east of Santa Rosa",
        [("Issued","1:40 PM"),("Updated","2:10 PM"),("Now","2:22 PM")], SRC_EM) + tiles() + \
        '<div class="sect"><span>Today</span><a>Following &middot; 2 new</a></div>' + today(TODAY, theme) + callbar() + tabs()

def home_order():
    note = (f'<p style="margin-top:10px;font-size:13px;font-weight:600;color:var(--pnote);display:flex;gap:6px;align-items:center">'
            f'{ic("clock",15)}Changed from Warning at 2:31 PM</p>')
    body = status("2:33") + nav() + '<div class="title">Ridgeview Fire</div>' + plate(
        DARK, "Extreme", "Extreme &middot; Order", "Evacuation Order. Leave now.",
        "Zone SON-3A. SON-3B remains under a Warning.",
        [("Issued","1:40 PM"),("Changed","2:31 PM"),("Now","2:33 PM")], SRC_EM,
        extra_style="border:1.5px solid #E5484D;box-shadow:0 0 0 4px rgba(229,72,77,.22), 0 8px 28px rgba(229,72,77,.18)", note=note)
    body += tiles("Daniel is at the meeting point", warn=False)
    body += '<div class="sect"><span>Today</span><a>Following &middot; 3 new</a></div>'
    body += today([("2:31 PM","Evacuation Order for zone SON-3A","Sonoma County Emergency Management (Demo)","Extreme")] + TODAY[:1])
    return body + callbar() + tabs()

def home_calm():
    body = status() + nav() + '<div class="title">Home</div>'
    body += f"""<section class="plate" style="{tone(DARK, 'calm')}">
  <span class="chip" style="background:#86B9B0;color:#041421">{ic("check",14,"#041421",2.6)}No active alerts</span>
  <h2>No active official alerts for Sonoma County.</h2>
  <div class="spine"><div>Last checked<b>2:14 PM</b></div><div>Sources<b>4 official</b></div><div>Now<b>2:22 PM</b></div></div>
  <p class="src">National Weather Service &middot; Sonoma County EM &middot; Caltrans D4 &middot; CAL FIRE</p>
</section>"""
    body += '<div class="sect"><span>Following</span><a>Manage</a></div>'
    body += f"""<div class="list">
  <div class="li"><span class="ico">{ic("flame",20)}</span><div class="grow">Red Flag Warning season<small>Checked 2:14 PM</small></div><span class="chev">{ic("chev",18)}</span></div>
  <div class="li"><span class="ico">{ic("road",20)}</span><div class="grow">Highway 12 conditions<small>Checked 2:14 PM</small></div><span class="chev">{ic("chev",18)}</span></div>
</div>"""
    body += '<div class="sect"><span>Recent calls</span><a>See all</a></div>'
    body += f"""<div class="list">
  <div class="li"><span class="ico">{ic("phone",20)}</span><div class="grow">Shelters near Santa Rosa<small>Oct 22 &middot; 3 min &middot; English</small></div><span class="chev">{ic("chev",18)}</span></div>
</div>"""
    body += '<p class="foot">Soterra shares official information. It does not replace emergency services.</p>'
    return body + callbar() + tabs()

def home_offline():
    body = status()
    body += (f'<div style="background:#2A3A40;color:#D0D6D6;display:flex;align-items:center;gap:10px;padding:10px 16px;font-size:15px">'
             f'{ic("wifioff",18)}<span style="flex:1">Offline &mdash; showing info from 2:14 PM</span>'
             f'<span style="color:#86B9B0;font-weight:600">Retry</span></div>')
    body += nav() + '<div class="title">Ridgeview Fire</div>' + plate(
        DARK, "Severe", "Severe &middot; Warning", "Evacuation Warning. Be ready to leave.",
        "Zones SON-3A and SON-3B, east of Santa Rosa",
        [("Issued","1:40 PM"),("Updated","2:10 PM"),("Saved","2:14 PM")], SRC_EM).replace(
        '<div class="spine">', '<div class="spine" style="opacity:.85">')
    body += f"""<div class="card" style="margin-top:12px;display:flex;gap:12px;align-items:center">
  <span style="color:var(--accent)">{ic("phone",24)}</span>
  <div style="flex:1"><b style="font-size:16px">Calling still works offline</b><p style="font-size:13px;color:var(--muted)">Soterra by phone: +1 804 606 6867. English &middot; Espa&ntilde;ol &middot; 24/7</p></div>
</div>"""
    body += '<div class="sect"><span>Saved at 2:14 PM</span></div>' + today(TODAY)
    return body + (f'<div class="callbar"><span class="btn btn-p">{ic("phone",18)}Call Soterra</span>'
                   f'<span class="btn btn-o" style="opacity:.45">{ic("chat",18)}Ask (needs signal)</span></div>') + tabs()

def alert_detail():
    body = status() + nav(back("Home")) + '<div class="title" style="font-size:28px">Evacuation Warning</div>'
    body += f"""<div style="padding:0 16px">{chip("Severe","Severe &middot; Warning")}</div>
<section class="plate" style="{tone(DARK, 'medium')}margin-top:12px">
  <h2 style="margin-top:0">Be ready to leave.</h2>
  <p class="sub">Zones SON-3A and SON-3B near the Ridgeview Fire, east of Santa Rosa.</p>
  <div class="spine"><div>Issued<b>1:40 PM</b></div><div>Updated<b>2:10 PM</b></div><div>Now<b>2:22 PM</b></div></div>
</section>
<div class="sect"><span>What to do</span></div>
<div class="list">
  <div class="li"><span class="ico">{ic("box",20)}</span><div class="grow">Pack medicine, documents, chargers</div></div>
  <div class="li"><span class="ico">{ic("people",20)}</span><div class="grow">Agree on a meeting point</div></div>
  <div class="li"><span class="ico">{ic("road",20)}</span><div class="grow">Avoid Ridgeview Rd (closed)</div></div>
</div>
<div class="sect"><span>Your zone</span></div>
<div class="card" style="font-size:15px">Soterra can&#8217;t tell you if an address is inside a zone. <span style="color:var(--accent);font-weight:600">Open the official zone lookup</span></div>
<div class="sect"><span>Source</span></div>
<div class="list"><div class="li"><span class="ico">{ic("info",20)}</span><div class="grow">{SRC_EM}<small>Official source &middot; page updated 2:10 PM</small></div><span class="chev">{ic("chev",18)}</span></div></div>"""
    body += (f'<div class="callbar"><span class="btn btn-p">{ic("bell",18)}Follow updates</span>'
             f'<span class="btn btn-o">{ic("map",18)}Show on map</span></div>')
    return body + tabs("Alerts")

def danger():
    body = '<div style="position:absolute;inset:0;filter:blur(0)">' + status() + nav() + \
           '<div class="title" style="opacity:.35">Ridgeview Fire</div></div>'
    body += '<div style="position:absolute;inset:0;background:rgba(2,8,14,.72)"></div>'
    body += f"""<div style="position:absolute;left:0;right:0;bottom:0;top:120px;background:var(--surf);border-radius:22px 22px 0 0;padding:10px 20px 34px;display:flex;flex-direction:column">
  <div style="width:40px;height:5px;border-radius:3px;background:var(--line);margin:0 auto 22px"></div>
  <div style="color:#E5484D">{ic("warn",40,"#E5484D",2)}</div>
  <h1 style="font:600 30px/1.15 Outfit,Inter,sans-serif;margin-top:14px;letter-spacing:-.02em">If you are in immediate danger, call 911 now.</h1>
  <p style="margin-top:12px;color:var(--muted);font-size:17px">Soterra can&#8217;t send help or contact emergency services for you.</p>
  <div style="flex:1"></div>
  <span class="btn" style="background:#E5484D;color:#fff;height:64px;font-size:22px;flex:none">{ic("phone",24,"#fff")}Call 911</span>
  <span class="btn btn-o" style="height:52px;flex:none;margin-top:12px">I&#8217;m safe &mdash; show information</span>
  <p style="margin-top:16px;font-size:13px;color:var(--muted);text-align:center">Text 911 where available if you can&#8217;t speak.</p>
</div>"""
    return body

def bubble_user(t):
    return (f'<div style="display:flex;justify-content:flex-end;margin:0 16px 12px"><div style="max-width:78%;'
            f'background:var(--accent);color:var(--onaccent);padding:10px 14px;border-radius:18px 18px 4px 18px;font-size:16px">{t}</div></div>')

def assistant_head():
    return status() + nav(back("Home")) + f"""<div style="display:flex;align-items:center;gap:10px;padding:2px 16px 14px">
  <div style="width:36px;height:36px;border-radius:18px;background:var(--surf2);display:flex;align-items:center;justify-content:center;color:var(--accent)">{ic("chat",18)}</div>
  <div><div class="inline-title">Soterra</div><div style="font-size:13px;color:var(--muted)">Answers only from official sources</div></div>
</div>"""

def composer():
    return f"""<div style="position:absolute;left:0;right:0;bottom:0;padding:10px 16px 34px;background:var(--tab);border-top:1px solid var(--line);display:flex;gap:10px;align-items:center">
  <div style="flex:1;height:44px;border-radius:22px;background:var(--surf);display:flex;align-items:center;padding:0 16px;color:var(--muted);font-size:16px">Ask about the emergency</div>
  <div style="width:44px;height:44px;border-radius:22px;background:var(--surf);display:flex;align-items:center;justify-content:center;color:var(--accent)">{ic("mic",20)}</div>
  <div style="width:44px;height:44px;border-radius:22px;background:var(--accent);display:flex;align-items:center;justify-content:center;color:var(--onaccent)">{ic("send",20)}</div>
</div>"""

def assistant_answer():
    body = assistant_head() + bubble_user("What&#8217;s going on with the Ridgeview Fire?")
    body += f"""<div style="margin:0 16px;background:var(--surf);border-radius:18px 18px 18px 4px;padding:14px;max-width:92%">
  <p style="font-size:16px">The Ridgeview Fire is about <b>1,200 acres</b> and <b>10% contained</b>. Zones SON-3A and SON-3B are under an Evacuation Warning: be ready to leave.</p>
  <div style="display:flex;gap:16px;margin-top:12px;padding-top:8px;border-top:1px solid var(--line);font-size:12px;color:var(--muted)">
    <div>Updated<b style="display:block;color:var(--text);font-size:15px">2:10 PM</b></div>
    <div>Source<b style="display:block;color:var(--text);font-size:15px">Fire Information (Demo)</b></div>
  </div>
  <div style="display:flex;gap:8px;margin-top:12px">
    <span style="font-size:14px;font-weight:600;color:var(--accent);border:1.5px solid var(--accent);border-radius:16px;padding:6px 12px">{ic("bell",14)} Follow changes</span>
    <span style="font-size:14px;font-weight:600;color:var(--accent);border:1.5px solid var(--accent);border-radius:16px;padding:6px 12px">Open source</span>
  </div>
</div>
<div style="margin:16px 16px 0;display:flex;gap:8px;flex-wrap:wrap">
  <span style="font-size:14px;background:var(--surf2);border-radius:16px;padding:8px 12px">Where are shelters?</span>
  <span style="font-size:14px;background:var(--surf2);border-radius:16px;padding:8px 12px">Which roads are closed?</span>
</div>"""
    return body + composer()

def assistant_unknown():
    body = assistant_head() + bubble_user("Is Hillcrest Elementary open as a shelter?")
    body += f"""<div style="margin:0 16px;background:var(--surf);border-radius:18px 18px 18px 4px;padding:14px;max-width:92%">
  <div style="display:flex;gap:8px;align-items:center;color:var(--accent);font-weight:600;font-size:15px">{ic("clock",18)}I don&#8217;t know yet</div>
  <p style="font-size:16px;margin-top:8px">No official source has said whether Hillcrest Elementary is open. I&#8217;ve saved your question. We&#8217;ll update you when officials answer.</p>
  <div style="display:flex;gap:8px;margin-top:12px">
    <span class="btn btn-p" style="height:40px;font-size:15px">{ic("bell",16)}Tell me when answered</span>
  </div>
  <p style="font-size:13px;color:var(--muted);margin-top:10px">Open shelters right now: Ridgeview Community Center, 500 Elm Street (pets in crates). Checked 2:30 PM.</p>
</div>"""
    body += bubble_user("Call me when you know.")
    body += f"""<div style="margin:0 16px;background:var(--surf);border-radius:18px 18px 18px 4px;padding:12px 14px;max-width:92%;display:flex;gap:10px;align-items:center">
  <span style="color:var(--accent)">{ic("check",20)}</span><p style="font-size:15px">Saved. I&#8217;ll call +1 (707) 555-0148 when officials answer. Say &#8220;stop updates&#8221; anytime.</p></div>"""
    return body + composer()

def map_screen():
    body = status() + nav() + '<div class="title">Map</div>'
    body += f"""<div style="margin:0 16px;height:44px;border-radius:12px;background:var(--surf);display:flex;align-items:center;gap:8px;padding:0 12px;color:var(--muted)">{ic("search",18)}Search places</div>
<div style="display:flex;gap:8px;padding:10px 16px;font-size:14px;font-weight:600">
  <span style="background:var(--accent);color:var(--onaccent);border-radius:16px;padding:7px 12px">Shelters</span>
  <span style="background:var(--accent);color:var(--onaccent);border-radius:16px;padding:7px 12px">Pet-friendly</span>
  <span style="background:var(--surf);border-radius:16px;padding:7px 12px">Zones</span>
  <span style="background:var(--surf);border-radius:16px;padding:7px 12px">Roads</span>
</div>
<svg width="390" height="330" viewBox="0 0 390 330" style="display:block">
  <rect width="390" height="330" fill="#0B2530"/>
  <path d="M0 220 C80 200 120 240 200 215 S320 170 390 190 V330 H0Z" fill="#0E2E38"/>
  <path d="M0 80 C60 95 130 60 190 85 S300 120 390 95" stroke="#1C4651" stroke-width="2" fill="none"/>
  <path d="M0 140 C90 150 170 120 250 150 S340 175 390 160" stroke="#1C4651" stroke-width="2" fill="none"/>
  <path d="M40 0 L120 330" stroke="#2A5560" stroke-width="5"/>
  <path d="M0 260 L390 230" stroke="#2A5560" stroke-width="5"/>
  <path d="M200 40 L340 30 L360 140 L230 160Z" fill="#E8833A" fill-opacity=".18" stroke="#E8833A" stroke-width="2"/>
  <path d="M200 160 L360 140 L370 210 L215 225Z" fill="#E5484D" fill-opacity=".2" stroke="#E5484D" stroke-width="2"/>
  <text x="260" y="95" fill="#E8833A" font-family="Inter, Helvetica, sans-serif" font-size="13" font-weight="700">SON-3B</text>
  <text x="272" y="190" fill="#E5484D" font-family="Inter, Helvetica, sans-serif" font-size="13" font-weight="700">SON-3A</text>
  <path d="M330 60 c10-10 30-4 34 10 s-6 26-22 24 s-22-22-12-34z" fill="#E5484D" fill-opacity=".55"/>
  <path d="M112 175 L250 255" stroke="#E5484D" stroke-width="5" stroke-dasharray="8 6"/>
  <circle cx="90" cy="250" r="16" fill="#86B9B0"/><path d="M83 252 L90 245 L97 252 M85 251 V257 H95 V251" stroke="#041421" stroke-width="2" fill="none"/>
  <text x="300" y="52" fill="#E5484D" font-family="Inter, Helvetica, sans-serif" font-size="12" font-weight="700">Ridgeview Fire</text>
  <text x="120" y="168" fill="#E5484D" font-family="Inter, Helvetica, sans-serif" font-size="11" font-weight="600" transform="rotate(30 120 168)">Closed</text>
  <text x="66" y="282" fill="#D0D6D6" font-family="Inter, Helvetica, sans-serif" font-size="12" font-weight="600">Ridgeview CC</text>
</svg>
<div style="position:absolute;left:0;right:0;bottom:83px;background:var(--surf);border-radius:20px 20px 0 0;padding:8px 16px 14px">
  <div style="width:36px;height:5px;border-radius:3px;background:var(--line);margin:0 auto 10px"></div>
  <div style="display:flex;justify-content:space-between;align-items:flex-start">
    <div><b style="font-size:19px">Ridgeview Community Center</b><p style="font-size:14px;color:var(--muted)">500 Elm Street &middot; Shelter &middot; Pets in crates</p></div>
    <span class="chip" style="background:#86B9B0">Open</span>
  </div>
  <p style="font-size:13px;color:var(--amber);margin-top:8px;display:flex;gap:6px;align-items:center">{ic("clock",15)}Checked 2:30 PM &mdash; capacity needs reconfirming</p>
  <div class="row2" style="margin-top:10px"><span class="btn btn-p" style="height:44px">Directions</span><span class="btn btn-o" style="height:44px">Set meeting point</span></div>
</div>"""
    return body + tabs("Map")

def household():
    body = status() + nav() + '<div class="title">Household</div>'
    body += f"""<section class="plate" style="{tone(DARK, 'neutral')}">
  <div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:17px">2 of 4 checked in</b><span style="font-size:13px;color:var(--pm)">Updated 2:20 PM</span></div>
  <div style="display:flex;gap:4px;margin-top:10px"><div style="flex:1;height:8px;border-radius:4px;background:#86B9B0"></div><div style="flex:1;height:8px;border-radius:4px;background:#86B9B0"></div><div style="flex:1;height:8px;border-radius:4px;background:#4C7273"></div><div style="flex:1;height:8px;border-radius:4px;background:#E2C044"></div></div>
  <div class="spine" style="margin-top:12px"><div>Meeting point<b>Ridgeview Community Center</b></div></div>
</section>
<div class="sect"><span>Members</span><a>Add</a></div>
<div class="list">
  <div class="li"><div class="grow">Maya (you)<small>Parent</small></div><span style="font-size:14px;font-weight:600;color:var(--accent)">On my way</span></div>
  <div class="li"><div class="grow">Daniel<small>Parent &middot; 2:05 PM</small></div><span style="font-size:14px;font-weight:600;color:var(--accent)">At meeting point</span></div>
  <div class="li"><div class="grow">Rosa<small>Grandparent</small></div><span style="font-size:14px;color:var(--muted)">Checking in</span></div>
  <div class="li"><div class="grow">Leo<small>Child &middot; last 45 min ago</small></div><span style="font-size:14px;font-weight:600;color:#E2C044;display:flex;gap:4px;align-items:center">{ic("warn",15,"#E2C044")}Awaiting</span></div>
</div>
<div class="sect"><span>Message preview</span></div>
<div class="card" style="font-size:15px;color:var(--muted)">&#8220;Maya is on the way to Ridgeview Community Center, 500 Elm St. Leo, please check in.&#8221;</div>"""
    body += (f'<div class="callbar"><span class="btn btn-p">Update my status</span>'
             f'<span class="btn btn-o">Share</span></div>')
    return body + tabs("Household")

def more():
    body = status() + nav() + '<div class="title">More</div>'
    def li(i, t, s="", right=""):
        return (f'<div class="li"><span class="ico">{ic(i,20)}</span><div class="grow">{t}'
                f'{f"<small>{s}</small>" if s else ""}</div>{right}<span class="chev">{ic("chev",18)}</span></div>')
    body += '<div class="list">' + li("bell","Activity","Evacuation Order for SON-3A &middot; 2:31 PM",'<span class="cnt">3</span>') + \
            li("phone","Call history","Last call Oct 22") + li("list","Updates I&#8217;m following","2 active &middot; end in 24 h") + \
            li("check","Preparedness checklist","5 of 12 done") + '</div>'
    body += '<div style="height:20px"></div><div class="list">' + li("globe","Language","English") + \
            li("lock","Privacy","Transcripts off &middot; Delete my data") + li("gear","Settings") + li("info","About Soterra") + '</div>'
    body += f"""<div class="card" style="margin-top:20px;display:flex;gap:12px;align-items:center">
  <span style="color:var(--accent)">{ic("phone",24)}</span><div><b>+1 804 606 6867</b><p style="font-size:13px;color:var(--muted)">Soterra hotline &middot; English &middot; Espa&ntilde;ol &middot; 24/7</p></div></div>
<p class="foot">Soterra shares official information. It does not replace emergency services.</p>"""
    return body + tabs("More")

FRAMES = [
 ("01-home-crisis-dark", "Home · Crisis · Dark", DARK, home_crisis(DARK)),
 ("02-home-order-dark", "Home · Escalated to Order · Dark", DARK, home_order()),
 ("03-home-calm-dark", "Home · Calm · Dark", DARK, home_calm()),
 ("04-home-offline-dark", "Home · Offline · Dark", DARK, home_offline()),
 ("05-home-crisis-light", "Home · Crisis · Light", LIGHT, home_crisis(LIGHT)),
 ("06-alert-detail-dark", "Alert detail · Dark", DARK, alert_detail()),
 ("07-danger-sheet-dark", "Danger sheet (911) · Dark", DARK, danger()),
 ("08-assistant-answer-dark", "Assistant · Sourced answer · Dark", DARK, assistant_answer()),
 ("09-assistant-unknown-dark", "Assistant · I don't know yet · Dark", DARK, assistant_unknown()),
 ("10-map-dark", "Map · Shelters · Dark", DARK, map_screen()),
 ("11-household-dark", "Household · Dark", DARK, household()),
 ("12-more-dark", "More · Dark", DARK, more()),
]

for slug, title, theme, body in FRAMES:
    (OUT / f"{slug}.html").write_text(page(f"Soterra — {title}", theme, body))

# One board with every frame side by side, for a single import.
cells = "".join(
    f'<div style="flex:none"><p style="font:600 20px Inter;color:#D0D6D6;margin:0 0 12px">{t}</p>'
    f'<iframe src="{s}.html" width="390" height="844" style="border:0;border-radius:44px;display:block"></iframe></div>'
    for s,t,_,_ in FRAMES)
(OUT / "index.html").write_text(f"""<!doctype html><html><head><meta charset="utf-8"><title>Soterra iOS mockups</title></head>
<body style="margin:0;background:#020B12;padding:48px;display:flex;flex-wrap:wrap;gap:48px;width:{4*390+3*48}px">{cells}</body></html>""")
print("wrote", len(FRAMES), "frames")
