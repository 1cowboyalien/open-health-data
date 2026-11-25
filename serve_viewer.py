#!/usr/bin/env python3
"""Serve the private viewer and keep its edits in one shared file, so every browser sees them.

Usage:
    python3 serve_viewer.py            # only this Mac:   http://127.0.0.1:8766/
    python3 serve_viewer.py --lan      # also other devices on the same Wi-Fi (no login!)
    python3 serve_viewer.py --port 8800

- Serves only local/labs.html (no folder listing, no other files), plus the imaging viewer's files:
  GET /imaging/<path> from local/imaging/ only, only .nii.gz (scans, outlines, dose maps) and .obj (3D lesion models).
- Phone start screen: GET /phone/model.json = local/phone/model.json (make_phone_model.py), nothing else from local/phone/.
- Pathology slide photos: GET /pathology/<path> from local/pathology/ only, only .jpg (plus <case>/spots/*.json, the automatic
  nucleus spots, and <case>/masks/*.json, the automatic tissue maps).
- Photos (photo story panels, photos_view.js): GET /photos/thumb/<id>.jpg and /photos/web/<id>.(jpg|mov|mp4) from local/photos/ only
  (website copies made by local/photos/build_web.py, with location and camera data removed). Videos answer byte ranges
  (Safari needs them to play). GET /photos/stories.json = every story in local/photos/stories/<id>.json; a story with
  "family_only": true is left out unless the visitor is this Mac or the home network.
  GET /photos/edits.json = {hidden: [ids], level: {id: level}, canEdit}; POST /photos/edits {id, hidden?, level?} changes it
  (this Mac and the home network only; local/photos/photo_edits.json, previous copy kept as photo_edits.prev.json).
  A hidden photo is shown by the Edit mode at home but is 404 for everyone else; originals are never touched.
- GET  /api/edits  -> {"rev": n, "edits": {...}}  from local/med_edits.json (the same file the
  build scripts read, so moments, medication changes and saved ranges survive reloads/rebuilds).
- POST /api/edits  {"rev": n, "edits": {...}} saves them. If someone saved in between (rev differs)
  the answer is 409 with the newest version, so nobody silently overwrites another person's change.
- Every save first copies the previous file to local/edits_history/ (the newest 300 are kept).
- /ask/<path>: passed on to the separate chat server named in local/ask.json ({"chatServer": "http://127.0.0.1:8820"}),
  so the viewer's Ask features (ask_view.js) work at whatever address the viewer is reached by. Only the chat
  server's own paths are passed on, with X-Ask-Remote = the visitor's address; answers are streamed back.
  Without local/ask.json, /ask/ is 404.
- Usage statistics (usage.py): every request is logged to local/usage.sqlite (private), each browser
  gets a random visitor cookie, and the page reports which panels were used (usage.js, injected
  when labs.html is served; code names only, never health values or Ask text).
  GET /stats is the report page with a health meter. It and /api/stats answer only this Mac and the
  home network (private addresses), unless local/usage.json has {"statsKey": "..."}: then
  /stats?key=<that key> also works from outside (and remembers it in a cookie).
- Start view: local/start_view.json {"saved": <UTC time>, "keys": {...}} is the view a new visitor lands on.
  It is put in the page as window.START_VIEW, and a small script copies it into a browser's saved settings
  (localStorage "labs.*") when that browser has none yet. start_view.js adds the "Start view" button.
  POST /api/start-view {"keys": {...}} replaces it: this Mac and the home network only (the previous one is
  kept as local/start_view.prev.json).
- Story sessions ("Tell your story", story.py + story_view.html): GET /story is the page Erica uses to talk about her
  photos; /story/api/... records her answers, turns them into text on this Mac, asks Claude for a spoken follow-up
  question (through the chat server) and saves approved stories to local/photos/stories/. All of it answers only this
  Mac and the home network (VPN included). The browser only allows the microphone on a secure page, so start the
  viewer with --https-port 8767 (certificate: python3 serve_viewer.py --make-cert) and open https://<this Mac>:8767/story.
- Review page (review.py + review_view.js): GET /pathology-review is the viewer with only the Pathology panel and a side column
  (chat, history, files) for a reviewer, for example a pathologist. Their changes are small operations kept in
  local/review/log.jsonl; POST /pathology-review/api/change | flip | undo | redo add lines to it, and GET
  /pathology-review/api/state returns
  the page data with those changes applied. The family viewer's own files and page are not touched. GET
  /pathology-review/pathology/... serves the photos as /pathology/ does, plus the tissue maps the review has changed and the
  pictures a reviewer added. POST /pathology-review/api/chat and .../upload pass on to the reviewer's chat server named in
  local/review/settings.json. On this Mac and the home network it is on when local/review/reviewers.json exists
  (?as=<id> names a reviewer). From anywhere else it opens only with a private link: /pathology-review#k=<key>, made by
  "python3 review.py link new" (review.Links: only the key's fingerprint is kept, in local/review/links.json; every
  link has an end date and an off switch). The part after # never reaches a server: a small gate page hands the key to
  POST /pathology-review/api/enter and gets a cookie that stands for it. Without one, outside visitors get that gate
  page (while a link is live) or 404, and never the page or its data.
- Consent page (consent.py + consent_view.html, at /consent): what the patient's consent to share her health information
  allows, a link to it (local/consent/consent.pdf), and a form where a doctor or scientist types their name, role,
  institution and email to get a one-page Recipient Copy as a PDF with those filled in (POST /consent/api/issue; made from
  the private local/consent/recipient_template.html by html2pdf.swift, compiled once into local/consent/bin/). Each copy is
  kept as local/consent/issued/<random id>.pdf (GET /consent/copy/<id>.pdf, so its link can be emailed) and listed in
  local/consent/issued.jsonl, which only this Mac and the home network can read (GET /consent/api/issued). Outside
  addresses may make 20 copies an hour. Off (404) until local/consent/settings.json exists.
- Slides page (slides_view.js): GET /pathology-slides is the viewer with only the Pathology panel on it, a plain link
  for showing the slide photos to someone. It has no tools, no chat and no key, and nothing can be changed on it. It is
  the same page as / with the rest hidden (not removed), so it is exactly as open as the viewer itself: whoever can
  reach / can reach this, and the other way round. It keeps its own view settings, apart from the viewer's.
There is no login: anyone who can reach the address can view, and switch the page to Edit.
Use --lan only on a private home network, and stop the server (Ctrl+C) when you're done.
Python standard library only.
"""
import urllib.parse
import http.client
import argparse
import json
import os
import re
import shutil
import threading
import hmac
import ssl
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import usage
import story
import review
import consent

HERE = os.path.dirname(os.path.abspath(__file__))
LOCAL = os.path.join(HERE, "local")
PAGE = os.path.join(LOCAL, "labs.html")
EDITS = os.path.join(LOCAL, "med_edits.json")
HIST = os.path.join(LOCAL, "edits_history")
IMG_TYPES = (".nii.gz", ".obj")
KEEP = 300
PHOTO_EDITS = os.path.join(LOCAL, "photos", "photo_edits.json")


def read_photo_edits():
    """{hidden: {id: {at}}, level: {id: level}} from local/photos/photo_edits.json (empty if missing)."""
    try:
        e = json.load(open(PHOTO_EDITS))
        return {"hidden": dict(e.get("hidden") or {}), "level": dict(e.get("level") or {})}
    except (OSError, ValueError):
        return {"hidden": {}, "level": {}}

MAXBODY = 5_000_000
lock = threading.Lock()
USAGE = None   # usage.Usage, set in __main__
USAGE_JS = os.path.join(HERE, "usage.js")
STATS_HTML = os.path.join(HERE, "stats_view.html")
USAGE_CONF = os.path.join(LOCAL, "usage.json")
NOLOG = ("/stats", "/api/stats", "/api/ping", "/usage.js", "/api/usage")
ASK_CONF = os.path.join(LOCAL, "ask.json")
START = os.path.join(LOCAL, "start_view.json")
CONSENT = consent.Consent(LOCAL, HERE)   # consent.py: the /consent page and Recipient Copies (off until local/consent/settings.json exists)
REVIEW = review.Workspace(LOCAL)   # review.py: a reviewer's changes to the Pathology panel, with their history
REVIEW_JS = os.path.join(HERE, "review_view.js")
REVIEW_AT = review.AT   # the review page's address (/pathology-review); everything of the page lives under it. /review, its first address, forwards here
REVIEW_LINKS = review.Links(LOCAL)   # private links for reviewers outside the home network (local/review/links.json)
REVIEW_COOKIE = "pathrev"            # holds a private link's key once the page has handed it over
REVIEW_TRIES = {}                    # visitor address -> times of wrong keys in the last ten minutes
REVIEW_NAME_FIRST = "Please type your name first, at the top of the side column, so your changes can be credited to you."
REVIEWERS = os.path.join(LOCAL, "review", "reviewers.json")   # who may review: [{"id", "name", "role"}]; no file = no review page
REVIEW_CONF = os.path.join(LOCAL, "review", "settings.json")  # {"chatServer": "http://127.0.0.1:8821"} for the chat and uploads
REVIEW_UPLOAD_MAX = 60_000_000
# The review page keeps its own view settings ("labsrev.*"), apart from the viewer's on the same address, and starts
# with only the Pathology panel ticked. It also adds phone=0 to its address before the viewer's scripts run, so a phone
# opens on the slide photos and not on the viewer's phone start screen (phone_view.js). And when the address carries a
# private link's key (#k=...), it hands the key over and loads the page again as that link's reviewer: this is how a
# link is tried from the home network, where the page opens without one.
REVIEW_SHIM = ("(function(){function key(){try{var k=(/[#&]k=([A-Za-z0-9_-]{30,80})/.exec(location.hash)||[])[1];if(k){"
               "fetch('" + REVIEW_AT + "/api/enter',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:k})})"
               ".then(function(r){history.replaceState(history.state,'',location.pathname+location.search);if(r.ok)location.reload()})}}catch(e){}}"
               "window.addEventListener('hashchange',key);key();"
               "try{var u=new URL(location.href);if(u.searchParams.get('phone')==null){u.searchParams.set('phone','0');"
               "history.replaceState(history.state,'',u.pathname+u.search+u.hash)}}catch(e){}"
               "try{var S=Storage.prototype,g=S.getItem,s=S.setItem,r=S.removeItem,"
               "m=function(k){k=String(k);return k.indexOf('labs.')===0?'labsrev.'+k.slice(5):k};"
               "S.getItem=function(k){return g.call(this,m(k))};S.setItem=function(k,v){return s.call(this,m(k),v)};"
               "S.removeItem=function(k){return r.call(this,m(k))};"
               "if(localStorage.getItem('labs.selected')==null){localStorage.setItem('labs.selected','[\"path:slides\"]');"
               "localStorage.setItem('labs.mode','\"compare\"')}}catch(e){}})();")
# The slides page: the viewer with only the Pathology panel on it (slides_view.js), a plain link for showing the slide
# photos. Like the review page it keeps its own view settings ("labsslides.*") and adds phone=0 to its address; unlike
# it, every visit starts with only the Pathology panel ticked and open, since the page has no Library to tick it in.
SLIDES_AT = "/pathology-slides"
# Link previews (the card Messages, WhatsApp, Slack... show when a link is sent): each page gets a real title, a one-line
# description and a picture (Open Graph / Twitter tags), right after <head> because some preview readers only read the start
# of a page and labs.html is several MB. Pictures are plain title cards with no health data (make_preview_cards.py, preview/).
PREVIEW_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "preview")
PREVIEWS = {
    "records": ("Health records timeline", "Labs, scans, treatments and notes on one shared timeline."),
    "slides": ("Pathology slides", "Microscope slide photos by hospital, slide and date."),
    "story": ("Tell your story", "Photos, memories and the records from that time."),
}
SLIDES_JS = os.path.join(HERE, "slides_view.js")
SLIDES_SHIM = ("(function(){try{var u=new URL(location.href);if(u.searchParams.get('phone')==null){u.searchParams.set('phone','0');"
               "history.replaceState(history.state,'',u.pathname+u.search+u.hash)}}catch(e){}"
               "try{var S=Storage.prototype,g=S.getItem,s=S.setItem,r=S.removeItem,"
               "m=function(k){k=String(k);return k.indexOf('labs.')===0?'labsslides.'+k.slice(5):k};"
               "S.getItem=function(k){return g.call(this,m(k))};S.setItem=function(k,v){return s.call(this,m(k),v)};"
               "S.removeItem=function(k){return r.call(this,m(k))};"
               "localStorage.setItem('labs.selected','[\"path:slides\"]');localStorage.setItem('labs.mode','\"compare\"');"
               "localStorage.removeItem('labs.mins')}catch(e){}})();")
# What an outside visitor without a link's cookie gets at the page's address: no data, only the hand-over of the key.
REVIEW_GATE = """<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer"><title>Pathology review</title>
<style>body{font:16px/1.5 -apple-system,system-ui,sans-serif;max-width:34em;margin:14vh auto;padding:0 22px;color:#1f2430;background:#f6f7f9}
h1{font-size:21px;margin:0 0 8px}p{margin:8px 0}.s{color:#667085;font-size:14px}</style></head>
<body><h1>Pathology review</h1><p id="m">Opening your link…</p><p class="s">A teaching review, not a pathology report.</p>
<script>(function(){var m=document.getElementById('m');function go(){var k=(/[#&]k=([A-Za-z0-9_-]{30,80})/.exec(location.hash)||[])[1];
if(!k){m.textContent='This page opens with the private link you were sent. If you came here with that link, it has ended or been switched off: please ask for a new one.';return}
m.textContent='Opening your link…';
fetch('__AT__/api/enter',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:k})}).then(function(r){
if(r.ok){history.replaceState(null,'',location.pathname+location.search);location.reload()}
else m.textContent=r.status===429?'Too many tries from this address. Please wait ten minutes and open the link again.':'This link has ended or been switched off. Please ask for a new one.'})
.catch(function(){m.textContent='The page could not be reached. Please try again in a moment.'})}
window.addEventListener('hashchange',go);go()})();</script></body></html>""".replace("__AT__", REVIEW_AT)
START_JS = os.path.join(HERE, "start_view.js")
START_SKIP = {"txedits", "txdirty", "open"}   # medication edits are shared separately; "open" is not used any more
START_MAX = 2_000_000
# Runs before the viewer's own script. A browser with no saved view settings gets the start view; so does one where
# "Put this browser back" left the startview.reset marker (the old settings are cleared first, including any the
# previous page wrote while closing). Medication edits and the page's own "open" key don't count and are kept.
START_SEED = ("(function(){try{var L=localStorage,skip={'labs.txedits':1,'labs.txdirty':1,'labs.open':1},"
              "reset=L.getItem('startview.reset'),ks=[],i,k;L.removeItem('startview.reset');"
              "for(i=0;i<L.length;i++){k=L.key(i);if(k.indexOf('labs.')===0&&!skip[k])ks.push(k)}"
              "if(ks.length&&!reset)return;for(i=0;i<ks.length;i++)L.removeItem(ks[i]);"
              "var S=window.START_VIEW;if(!S||!S.keys)return;for(k in S.keys)L.setItem('labs.'+k,JSON.stringify(S.keys[k]))"
              "}catch(e){}})();")


def read_start():
    try:
        s = json.load(open(START))
        return s if isinstance(s, dict) and isinstance(s.get("keys"), dict) else None
    except (OSError, ValueError):
        return None


def start_tag(can_save):
    data = json.dumps(read_start()).replace("</", "<\\/")
    return (f"<script>window.START_VIEW={data};window.START_VIEW_CAN_SAVE={'true' if can_save else 'false'};"
            + START_SEED + "</script>").encode()
ASK_PATHS = ("/", "/review", "/file", "/api/quick-asks", "/api/chat", "/api/conversations",
             "/api/conversation", "/api/review", "/api/tasks", "/api/person",
             "/sandbox", "/api/sandbox/list", "/api/sandbox/item", "/api/sandbox/raw",
             "/api/sandbox/new", "/api/sandbox/file")
ASK_UPLOAD_MAX = 50_000_000  # /ask/api/sandbox/file: one uploaded file (the chat server checks the real limits)


def read_edits():
    if not os.path.exists(EDITS):
        return 0, None
    e = json.load(open(EDITS))
    return int(e.pop("rev", 0) or 0), e


def write_edits(rev, edits):
    if os.path.exists(EDITS):
        os.makedirs(HIST, exist_ok=True)
        shutil.copy2(EDITS, os.path.join(HIST, time.strftime("med_edits-%Y%m%dT%H%M%SZ", time.gmtime())
                                         + f"-r{rev - 1}.json"))
        old = sorted(os.listdir(HIST))
        for f in old[:-KEEP]:
            os.remove(os.path.join(HIST, f))
    tmp = EDITS + ".tmp"
    with open(tmp, "w") as f:
        json.dump(dict(edits, rev=rev), f, indent=1)
    os.replace(tmp, EDITS)


class Handler(BaseHTTPRequestHandler):
    def send(self, code, body, ctype="application/json", cache=False, headers=()):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "private, max-age=86400" if cache else "no-store")
        for k, v in headers:
            self.send_header(k, v)
        self.end_headers()
        self._bytes = getattr(self, "_bytes", 0) + len(data)
        self.wfile.write(data)

    def send_response(self, code, message=None):
        self._status = code
        super().send_response(code, message)

    # ---- usage logging around every request ----
    def logged(self, fn):
        t0 = time.perf_counter()
        self._status, self._bytes = 0, 0
        self._vid = usage.visitor_id(self) if USAGE else ""
        try:
            fn()
        except (BrokenPipeError, ConnectionResetError):
            self._status = self._status or 499
        finally:
            if USAGE and self.path.split("?")[0] not in NOLOG:
                USAGE.hit(self, self._status, self._bytes, (time.perf_counter() - t0) * 1000, self._vid)

    def stats_allowed(self):
        """Stats only for this Mac and the home network, or with the key from local/usage.json."""
        if usage.is_local_request(self):
            return True, ()
        key = str(usage.load_conf(USAGE_CONF).get("statsKey") or "")
        if len(key) < 12:
            return False, ()
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get("key", [""])[0]
        c = re.search(r"(?:^|;\s*)ohd_sk=([^;]+)", self.headers.get("Cookie") or "")
        for given in (q, c.group(1) if c else ""):
            if given and hmac.compare_digest(given.encode(), key.encode()):
                return True, (("Set-Cookie", f"ohd_sk={key}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Strict"),)
        return False, ()

    def ask_proxy(self):
        """Pass /ask/... on to the chat server and stream its answer back."""
        try:
            target = urllib.parse.urlparse(json.load(open(ASK_CONF))["chatServer"])
        except (OSError, ValueError, KeyError):
            return self.send(404, {"error": "Ask is not set up"})
        sub = self.path[len("/ask"):] or "/"
        if sub.split("?")[0] not in ASK_PATHS:
            return self.send(404, {"error": "not found"})
        n = int(self.headers.get("Content-Length") or 0)
        if n > (ASK_UPLOAD_MAX if sub.split("?")[0] == "/api/sandbox/file" else MAXBODY):
            return self.send(413, {"error": "too large"})
        body = self.rfile.read(n) if n else None
        headers = {"X-Ask-Remote": self.client_address[0]}
        if self.headers.get("Content-Type"):
            headers["Content-Type"] = self.headers["Content-Type"]
        try:
            conn = http.client.HTTPConnection(target.hostname, target.port or 80, timeout=900)
            conn.request(self.command, sub, body=body, headers=headers)
            r = conn.getresponse()
        except OSError:
            return self.send(502, {"error": "the chat server isn't running"})
        self.send_response(r.status)
        self._bytes = 0
        for k in ("Content-Type", "Content-Length", "X-Content-Type-Options", "Content-Security-Policy"):
            if r.getheader(k):
                self.send_header(k, r.getheader(k))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            while True:
                chunk = r.read1(65536) if hasattr(r, "read1") else r.read(65536)
                if not chunk:
                    break
                self.wfile.write(chunk)
                self.wfile.flush()
                self._bytes += len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            conn.close()

    def photos(self, rel):
        base = os.path.realpath(os.path.join(LOCAL, "photos"))
        if rel == "edits.json":
            e = read_photo_edits()
            return self.send(200, {"hidden": sorted(e["hidden"]), "level": e["level"], "canEdit": usage.is_local_request(self)})
        if rel == "stories.json":
            home = usage.is_local_request(self)
            out = {}
            sd = os.path.join(base, "stories")
            for f in sorted(os.listdir(sd)) if os.path.isdir(sd) else []:
                if not f.endswith(".json"):
                    continue
                try:
                    st = json.load(open(os.path.join(sd, f)))
                except (OSError, ValueError):
                    continue
                keep = [x for x in st.get("stories", []) if home or not x.get("family_only")]
                if keep:
                    out[f[:-5]] = keep
            return self.send(200, {"stories": out, "home": home})
        sub, _, name = rel.partition("/")
        if os.path.splitext(name)[0] in read_photo_edits()["hidden"] and not usage.is_local_request(self):
            return self.send(404, {"error": "not found"})   # hidden from the website: only the home Edit mode still sees it
        f = os.path.realpath(os.path.join(base, rel))
        ok = (sub in ("thumb", "web") and "/" not in name and f.startswith(os.path.join(base, sub) + os.sep)
              and os.path.isfile(f))
        types = {".jpg": "image/jpeg", ".mov": "video/quicktime", ".mp4": "video/mp4"}
        ext = os.path.splitext(f)[1].lower()
        if not ok or ext not in types or (sub == "thumb" and ext != ".jpg"):
            return self.send(404, {"error": "not found"})
        if ext == ".jpg":
            return self.send(200, open(f, "rb").read(), "image/jpeg", cache=True)
        size = os.path.getsize(f)
        m = re.match(r"bytes=(\d*)-(\d*)$", self.headers.get("Range") or "")
        a, b = 0, size - 1
        if m and (m.group(1) or m.group(2)):
            if m.group(1):
                a = int(m.group(1)); b = min(int(m.group(2)), size - 1) if m.group(2) else size - 1
            else:
                a = max(0, size - int(m.group(2)))
            if a > b:
                self.send_response(416); self.send_header("Content-Range", f"bytes */{size}"); self.end_headers(); return
        self.send_response(206 if m else 200)
        self.send_header("Content-Type", types[ext])
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(b - a + 1))
        if m:
            self.send_header("Content-Range", f"bytes {a}-{b}/{size}")
        self.send_header("Cache-Control", "private, max-age=86400")
        self.end_headers()
        with open(f, "rb") as fh:
            fh.seek(a); left = b - a + 1
            while left > 0:
                chunk = fh.read(min(262144, left))
                if not chunk:
                    break
                self.wfile.write(chunk); left -= len(chunk); self._bytes += len(chunk)

    def do_GET(self):
        self.logged(self.get)

    def do_POST(self):
        self.logged(self.post)

    def get(self):
        path = self.path.split("?")[0]
        if path == "/ask" or path.startswith("/ask/"):
            return self.ask_proxy()
        if path in ("/favicon.ico", "/apple-touch-icon.png") or re.fullmatch(r"/preview/[a-z0-9-]+\.png", path):   # link-preview cards and the site icon
            f = {"/favicon.ico": "icon-32.png", "/apple-touch-icon.png": "icon-180.png"}.get(path) or path.rsplit("/", 1)[1]
            fp = os.path.join(PREVIEW_DIR, f)
            if not os.path.isfile(fp):
                return self.send(404, {"error": "not found"})
            return self.send(200, open(fp, "rb").read(), "image/png", cache=True)
        if path in ("/", "/labs.html"):
            if not os.path.exists(PAGE):
                return self.send(404, {"error": "local/labs.html not built yet: python3 make_lab_view.py"})
            html, extra = self.with_preview(open(PAGE, "rb").read(), "records", path), []
            i = html.find(b"<script")   # before the viewer's first script, so the start view is in place when it reads its settings
            tag = start_tag(usage.is_local_request(self))
            html = html[:i] + tag + html[i:] if i >= 0 else tag + html
            i = html.rfind(b"</body>")
            tag = b'<script src="/start_view.js" defer></script>'
            html = html[:i] + tag + html[i:] if i >= 0 else html + tag
            if USAGE:
                if not self._vid:
                    self._vid = usage.new_visitor_id()
                    extra.append(("Set-Cookie", f"ohd_vid={self._vid}; Path=/; Max-Age=63072000; SameSite=Lax"))
                i = html.rfind(b"</body>")
                tag = b'<script src="/usage.js" defer></script>'
                html = html[:i] + tag + html[i:] if i >= 0 else html + tag
            return self.send(200, html, "text/html; charset=utf-8", headers=extra)
        if path == "/start_view.js":
            return self.send(200, open(START_JS, "rb").read(), "text/javascript; charset=utf-8")
        if path == "/usage.js":
            return self.send(200, open(USAGE_JS, "rb").read(), "text/javascript; charset=utf-8")
        if path in ("/stats", "/api/stats", "/api/ping"):
            ok, cookie = self.stats_allowed()
            if not ok or not USAGE:
                return self.send(404, {"error": "not found"})
            if path == "/api/ping":
                return self.send(200, {"t": time.time()})
            if path == "/api/stats":
                rng = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get("r", ["day"])[0]
                return self.send(200, USAGE.stats(rng), headers=cookie)
            return self.send(200, open(STATS_HTML, "rb").read(), "text/html; charset=utf-8", headers=cookie)
        if path.startswith("/imaging/"):   # imaging viewer files: inside local/imaging/, scan/model types only
            rel = urllib.parse.unquote(path[len("/imaging/"):])
            base = os.path.realpath(os.path.join(LOCAL, "imaging"))
            f = os.path.realpath(os.path.join(base, rel))
            if (f.startswith(base + os.sep) and f.endswith(IMG_TYPES) and os.path.isfile(f)):
                return self.send(200, open(f, "rb").read(), "application/octet-stream")
            return self.send(404, {"error": "not found"})
        if path == "/phone/model.json":   # phone start screen 3D model (make_phone_model.py), the one file in local/phone/
            f = os.path.join(LOCAL, "phone", "model.json")
            if os.path.isfile(f):
                return self.send(200, open(f, "rb").read(), "application/json")
            return self.send(404, {"error": "not found"})
        if path.startswith("/pathology/"):   # pathology slide photos: inside local/pathology/, .jpg only
            return self.pathology_file(urllib.parse.unquote(path[len("/pathology/"):]))
        if path == REVIEW_AT or path.startswith(REVIEW_AT + "/"):
            return self.review_get(path[len(REVIEW_AT):])
        if path == consent.AT or path.startswith(consent.AT + "/"):
            return consent.handle_get(self, path[len(consent.AT):], CONSENT, usage.is_local_request(self))
        if path in (SLIDES_AT, SLIDES_AT + "/"):   # the viewer with only the Pathology panel on it
            return self.slides_page()
        if path == SLIDES_AT + "/slides_view.js":
            return self.send(200, open(SLIDES_JS, "rb").read(), "text/javascript; charset=utf-8")
        if path in ("/review", "/review/"):   # the review page's first address
            return self.review_moved()
        if path.startswith("/photos/"):   # photo story: website copies in local/photos/{thumb,web}/, and the stories
            return self.photos(urllib.parse.unquote(path[len("/photos/"):]))
        if path == "/story" or path.startswith("/story/"):
            return self.story_get(path)
        if path == "/api/edits":
            with lock:
                rev, edits = read_edits()
            return self.send(200, {"rev": rev, "edits": edits})
        self.send(404, {"error": "not found"})

    def post(self):
        if self.path.split("?")[0].startswith("/ask/"):
            return self.ask_proxy()
        if self.path.split("?")[0] == "/api/usage":
            n = int(self.headers.get("Content-Length") or 0)
            if not USAGE or n <= 0 or n > 16000:
                return self.send(400, {"error": "bad"})
            try:
                body = json.loads(self.rfile.read(n))
                assert isinstance(body, dict)
            except Exception:  # noqa: BLE001
                return self.send(400, {"error": "bad"})
            return self.send(200, {"ok": USAGE.events(self, self._vid, body)})
        if self.path.split("?")[0] == "/api/start-view":
            return self.save_start()
        if self.path.split("?")[0] == "/photos/edits":
            return self.save_photo_edit()
        if self.path.split("?")[0].startswith("/story/api/"):
            return self.story_post(self.path.split("?")[0][len("/story/api/"):])
        if self.path.split("?")[0].startswith(consent.AT + "/"):
            return consent.handle_post(self, self.path.split("?")[0][len(consent.AT):], CONSENT, usage.is_local_request(self),
                                       usage.client_ip(self)[0], self.consent_base())
        if self.path.split("?")[0].startswith(REVIEW_AT + "/api/"):
            return self.review_post(self.path.split("?")[0][len(REVIEW_AT + "/api/"):])
        if self.path.split("?")[0] != "/api/edits":
            return self.send(404, {"error": "not found"})
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > MAXBODY:
            return self.send(413, {"error": "empty or too large"})
        try:
            body = json.loads(self.rfile.read(n))
            base, edits = int(body["rev"]), body["edits"]
            if not isinstance(edits, dict) or edits.get("version") != 1:
                raise ValueError("not a med_edits object")
        except Exception as e:  # noqa: BLE001 - any bad input is a 400
            return self.send(400, {"error": str(e)})
        with lock:
            rev, cur = read_edits()
            if base != rev:
                return self.send(409, {"rev": rev, "edits": cur})
            write_edits(rev + 1, edits)
        self.send(200, {"rev": rev + 1})

    def consent_base(self):
        """The site address to print on a Recipient Copy: publicBase from local/consent/settings.json, else the address
        the visitor used."""
        s = CONSENT.settings() or {}
        if s.get("publicBase"):
            return s["publicBase"].rstrip("/")
        host = re.sub(r"[^A-Za-z0-9.:\[\]-]", "", self.headers.get("Host") or "") or "127.0.0.1"
        return ("https://" if isinstance(self.connection, ssl.SSLSocket) else "http://") + host

    def pathology_file(self, rel):
        base = os.path.realpath(os.path.join(LOCAL, "pathology"))
        f = os.path.realpath(os.path.join(base, rel))
        if f.startswith(base + os.sep) and f.lower().endswith(".jpg") and os.path.isfile(f):
            return self.send(200, open(f, "rb").read(), "image/jpeg", cache=True)
        if (f.startswith(base + os.sep) and os.path.basename(os.path.dirname(f)) in ("spots", "masks")
                and f.endswith(".json") and os.path.isfile(f)):   # automatic nucleus spots / tissue maps, one file per slide
            return self.send(200, open(f, "rb").read(), "application/json")
        return self.send(404, {"error": "not found"})

    # ---- review page (review.py): this Mac and the home network, or a private link from anywhere ----
    def review_link(self):
        """The live private link this browser came in with (its cookie), or None."""
        m = re.search(r"(?:^|;\s*)" + REVIEW_COOKIE + r"=([A-Za-z0-9_-]{30,80})(?:;|$)", self.headers.get("Cookie") or "")
        return REVIEW_LINKS.find(m.group(1)) if m else None

    def review_https(self):
        if isinstance(self.connection, ssl.SSLSocket):
            return True
        # otherwise a tunnel or proxy on this Mac says how the visitor reached it
        return usage.client_ip(self)[1] and ((self.headers.get("X-Forwarded-Proto") or "").lower() == "https" or '"https"' in (self.headers.get("Cf-Visitor") or ""))

    def review_who(self, body=None):
        """Who is reviewing, or None when the page is not for this visitor.

        Someone who came in with a private link is that link's reviewer, wherever they are. On this Mac and the home network
        the reviewers in local/review/reviewers.json can also be named with ?as=<id> (or "as" in the request); without a link
        and without a name it is the first of them. From outside, "as" is never trusted."""
        if not REVIEW.ready():
            return None
        want = (body or {}).get("as") or urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get("as", [""])[0]
        link, home = self.review_link(), usage.is_local_request(self)
        me = review.Links.person(link) if link else None
        if me and (not home or not want or want == me["id"]):
            return me
        if not home:
            return None
        try:
            people = json.load(open(REVIEWERS))
        except (OSError, ValueError):
            return None
        ok = [p for p in people if isinstance(p, dict) and re.fullmatch(r"[a-z0-9-]{1,40}", str(p.get("id", ""))) and p.get("name")] if isinstance(people, list) else []
        hit = next((p for p in ok if p["id"] == want), ok[0] if ok and not want else None)
        return {"id": hit["id"], "name": str(hit["name"])[:80], "role": str(hit.get("role") or "")[:40]} if hit else None

    def review_enter(self, n):
        """The page hands over a private link's key: answer with the cookie that stands for it from then on."""
        ip, at = usage.client_ip(self)[0], time.time()
        if len(REVIEW_TRIES) > 5000:
            REVIEW_TRIES.clear()
        tries = REVIEW_TRIES[ip] = [x for x in REVIEW_TRIES.get(ip, []) if at - x < 600]
        if len(tries) >= 10:
            return self.send(429, {"error": "too many tries"})
        try:
            body = json.loads(self.rfile.read(n)) if 0 < n <= 2000 else {}
        except ValueError:
            body = {}
        row = REVIEW_LINKS.find(body.get("key")) if isinstance(body, dict) and REVIEW.ready() else None
        if not row:
            tries.append(at)
            return self.send(403, {"error": "This link has ended or been switched off."})
        cookie = "%s=%s; Path=%s; Max-Age=%d; HttpOnly; SameSite=Strict%s" % (
            REVIEW_COOKIE, body["key"], REVIEW_AT, max(60, int(row["until"] - at)), "; Secure" if self.review_https() else "")
        return self.send(200, {"ok": True}, headers=(("Set-Cookie", cookie),))

    def review_conf(self):
        try:
            c = json.load(open(REVIEW_CONF))
            return c if isinstance(c, dict) else {}
        except (OSError, ValueError):
            return {}

    def review_state(self, who):
        return dict(REVIEW.state(), reviewer=who, chat=bool(self.review_conf().get("chatServer")))

    def review_moved(self):
        """/review was the page's first address: forward to the new one, for the same people only."""
        if not (usage.is_local_request(self) and self.review_who()):
            return self.send(404, {"error": "not found"})
        q = urllib.parse.urlparse(self.path).query
        return self.send(302, b"", "text/plain", headers=(("Location", REVIEW_AT + ("?" + q if q else "")),))

    def with_preview(self, html, kind, path):
        """html (bytes) with its <title> set and the link-preview tags put right after <head>"""
        title, desc = PREVIEWS[kind]
        host = self.headers.get("Host") or "127.0.0.1:8766"
        base = ("https://" if isinstance(self.connection, ssl.SSLSocket) else "http://") + host
        e = lambda t: t.replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;")
        tags = (f'<meta property="og:type" content="website"><meta property="og:title" content="{e(title)}">'
                f'<meta property="og:description" content="{e(desc)}"><meta name="description" content="{e(desc)}">'
                f'<meta property="og:url" content="{e(base + path)}"><meta property="og:image" content="{base}/preview/{kind}.png">'
                f'<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">'
                f'<meta property="og:image:alt" content="{e(title)}"><meta name="twitter:card" content="summary_large_image">'
                f'<link rel="icon" type="image/png" sizes="32x32" href="/preview/icon-32.png">'
                f'<link rel="apple-touch-icon" href="/preview/icon-180.png">').encode()
        html = re.sub(rb"<title>[^<]*</title>", ("<title>" + e(title) + "</title>").encode(), html, count=1)
        m = re.search(rb"<head[^>]*>", html[:4096])
        i = m.end() if m else 0
        return html[:i] + tags + html[i:]

    def slides_page(self):
        """The viewer's own page, set up to show only the Pathology panel. No data is added or taken away."""
        if not os.path.exists(PAGE):
            return self.send(404, {"error": "local/labs.html not built yet: python3 make_lab_view.py"})
        html = self.with_preview(open(PAGE, "rb").read(), "slides", SLIDES_AT)
        tag = ("<script>" + SLIDES_SHIM + "</script>").encode()
        i = html.find(b"<script")   # before the viewer's first script: it reads its saved settings as it starts
        html = html[:i] + tag + html[i:] if i >= 0 else tag + html
        i = html.rfind(b"</body>")
        tag = ('<script src="' + SLIDES_AT + '/slides_view.js"></script>').encode()
        html = html[:i] + tag + html[i:] if i >= 0 else html + tag
        return self.send(200, html, "text/html; charset=utf-8", headers=(("X-Robots-Tag", "noindex, nofollow"),))

    def review_get(self, path):
        """path = what follows the page's address: "" for the page itself, /api/state, /pathology/<file>, ..."""
        who = self.review_who()
        if not who:
            if path in ("", "/") and not usage.is_local_request(self) and REVIEW.ready() and REVIEW_LINKS.any_live():
                return self.send(200, REVIEW_GATE.encode(), "text/html; charset=utf-8")   # no data: it only hands a link's key over
            return self.send(404, {"error": "not found"})
        if path in ("", "/"):
            if not os.path.exists(PAGE):
                return self.send(404, {"error": "local/labs.html not built yet: python3 make_lab_view.py"})
            html = open(PAGE, "rb").read()
            cfg = json.dumps({"reviewer": who, "api": REVIEW_AT + "/api", "base": REVIEW_AT + "/pathology/"}).replace("</", "<\\/")
            tag = ("<script>" + REVIEW_SHIM + "window.REVIEW=" + cfg + ";</script>").encode()
            i = html.find(b"<script")   # before the viewer's first script: it reads its saved settings as it starts
            html = html[:i] + tag + html[i:] if i >= 0 else tag + html
            i = html.rfind(b"</body>")
            tag = ('<script src="' + REVIEW_AT + '/review_view.js"></script>').encode()
            html = html[:i] + tag + html[i:] if i >= 0 else html + tag
            return self.send(200, html, "text/html; charset=utf-8")
        if path == "/review_view.js":
            return self.send(200, open(REVIEW_JS, "rb").read(), "text/javascript; charset=utf-8")
        if path == "/api/state":
            w = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get("without", [""])[0]
            if w.isdigit():   # "Before / after": the review without one change; nothing is saved
                return self.send(200, dict(REVIEW.state(int(w)), reviewer=who))
            return self.send(200, self.review_state(who))
        if path == "/api/version":
            return self.send(200, {"version": len(REVIEW.records())})
        pk = re.match(r"/pathology(?:~(\d{1,9}))?/", path)
        if pk:
            rel = urllib.parse.unquote(path[pk.end():])
            m = re.fullmatch(r"([^/]+)/masks/([^/]+)\.json", rel)
            built = REVIEW.without(int(pk.group(1))) if pk.group(1) else REVIEW.build()
            hit = built["masks"].get(m.group(1) + "/" + m.group(2)) if m else None
            if hit:   # a tissue map this review has changed
                return self.send(200, hit)
            m = re.fullmatch(r"review-files/(u\d{1,6})\.jpg", rel)
            if m:   # a picture the reviewer added
                f = os.path.join(REVIEW.files, m.group(1) + ".jpg")
                return self.send(200, open(f, "rb").read(), "image/jpeg", cache=True) if os.path.isfile(f) else self.send(404, {"error": "not found"})
            return self.pathology_file(rel)
        return self.send(404, {"error": "not found"})

    def review_post(self, sub):
        n = int(self.headers.get("Content-Length") or 0)
        if sub == "enter":
            return self.review_enter(n)
        if sub == "upload":
            return self.review_upload(n)
        if n <= 0 or n > MAXBODY:
            return self.send(413, {"error": "empty or too large"})
        try:
            body = json.loads(self.rfile.read(n))
            assert isinstance(body, dict)
        except Exception:  # noqa: BLE001 - any bad input is a 400
            return self.send(400, {"error": "bad request"})
        who = self.review_who(body)
        if not who:
            return self.send(404, {"error": "not found"})
        if sub == "name":   # a reviewer with a private link says how their changes are to be signed
            if not who.get("link"):
                return self.send(404, {"error": "not found"})
            try:
                who = review.Links.person(REVIEW_LINKS.change(who["link"], name=body.get("name")))
            except review.Bad as e:
                return self.send(422, {"error": str(e)})
            return self.send(200, self.review_state(who))
        if not who["name"]:
            return self.send(422, dict(self.review_state(who), error=REVIEW_NAME_FIRST))
        made = None
        try:
            with lock:
                if sub == "change":
                    made = REVIEW.add(who, body.get("op"), "tool", body.get("words") or "")["id"]
                elif sub == "flip":
                    REVIEW.flip(who, body.get("id"), bool(body.get("on")))
                elif sub == "undo":
                    made = REVIEW.undo(who)["id"]
                elif sub == "redo":
                    made = REVIEW.redo(who)["id"]
                elif sub != "chat":
                    return self.send(404, {"error": "not found"})
        except review.Bad as e:
            return self.send(422, dict(self.review_state(who), error=str(e)))
        if sub == "chat":
            return self.review_chat(who, body)
        return self.send(200, dict(self.review_state(who), made=made))

    def review_upload(self, n):
        """A file or picture the reviewer adds: passed to the reviewer's chat server, which keeps it outside this folder."""
        who, chat = self.review_who(), self.review_conf().get("chatServer")
        if not who:
            return self.send(404, {"error": "not found"})
        if not who["name"]:
            return self.send(422, {"error": REVIEW_NAME_FIRST})
        if not chat:
            return self.send(503, {"error": "The reviewer's chat is not running, so files cannot be added yet."})
        if n <= 0 or n > REVIEW_UPLOAD_MAX:
            return self.send(413, {"error": "The file is empty or larger than 60 MB."})
        name = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get("name", [""])[0][:200]
        data, t, conn = self.rfile.read(n), urllib.parse.urlparse(chat), None
        try:
            conn = http.client.HTTPConnection(t.hostname, t.port or 80, timeout=300)
            conn.request("POST", "/api/review-upload?" + urllib.parse.urlencode({"name": name, "by": who["id"]}), body=data,
                         headers={"Content-Type": "application/octet-stream"})
            r = conn.getresponse()
            out = json.loads(r.read() or b"{}")
        except (OSError, ValueError):
            return self.send(502, {"error": "The reviewer's chat is not running, so files cannot be added yet."})
        finally:
            if conn:
                conn.close()
        if r.status != 200 or not isinstance(out, dict) or not review.FID.match(str(out.get("fid", ""))):
            return self.send(r.status if r.status != 200 else 502, {"error": (out.get("error") if isinstance(out, dict) else None) or "The file could not be added."})
        meta = {k: out[k] for k in ("fid", "name", "kind", "bytes", "web", "read", "pages") if k in out}
        meta.update(at=review.now(), by=who["id"], who=who["name"])
        REVIEW.record_upload(meta)
        return self.send(200, {k: v for k, v in meta.items() if k != "read"})

    def review_chat(self, who, body):
        """One message to the reviewer's Claude. Its steps are passed on as they come; the changes it asks for are applied at the end."""
        chat = self.review_conf().get("chatServer")
        if not chat:
            return self.send(503, {"error": "The reviewer's chat is not running."})
        words = str(body.get("text") or "")[:6000]
        try:
            prompt, att = REVIEW.chat_prompt(who, words, body.get("attach"), body.get("view"))
        except review.Bad as e:
            return self.send(422, {"error": str(e)})
        if not words.strip() and not att:
            return self.send(400, {"error": "empty message"})
        sid = body.get("sessionId")
        req = json.dumps({"prompt": prompt, "guide": review.OPS_GUIDE, "reviewer": who,
                          "sessionId": sid if isinstance(sid, str) and re.fullmatch(r"[0-9a-f-]{36}", sid) else None}).encode()
        t = urllib.parse.urlparse(chat)
        try:
            conn = http.client.HTTPConnection(t.hostname, t.port or 80, timeout=900)
            conn.request("POST", "/api/review-chat", body=req, headers={"Content-Type": "application/json"})
            r = conn.getresponse()
        except OSError:
            return self.send(502, {"error": "The reviewer's chat is not running."})
        if r.status != 200:
            msg = r.read()[:600].decode("utf-8", "replace")
            conn.close()
            return self.send(r.status, {"error": msg or "The chat could not answer."})
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        gone, done = False, None

        def out(o):
            nonlocal gone
            if gone:
                return
            try:
                self.wfile.write((json.dumps(o) + "\n").encode())
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                gone = True   # the page was closed; the answer is still finished and its changes still go into the history

        try:
            for raw in r:
                try:
                    ev = json.loads(raw.decode("utf-8", "replace"))
                except ValueError:
                    continue
                if ev.get("type") == "done":
                    done = ev
                elif ev.get("type") in ("step", "text"):
                    out({"type": ev["type"], "text": str(ev.get("text", ""))[:4000]})
        except OSError:
            pass
        finally:
            conn.close()
        res = {"type": "reply", "text": "", "made": [], "failed": [], "sessionId": None}
        if not done or done.get("error"):
            res["error"] = str((done or {}).get("error") or "The chat stopped before it answered.")[:600]
            res["sessionId"] = (done or {}).get("sessionId")
        else:
            clean, ops, problem = REVIEW.parse_reply(done.get("text") or "")
            res.update(text=clean, sessionId=done.get("sessionId"))
            if problem:
                res["failed"].append({"why": problem})
            for op in ops:
                try:
                    with lock:
                        rec = REVIEW.add(who, REVIEW.resolve(op, att), "chat", words)
                    res["made"].append({"id": rec["id"], "sum": rec["sum"], "info": rec.get("info"), "where": rec.get("where")})
                except review.Bad as e:
                    res["failed"].append({"what": str(op.get("op"))[:40], "why": str(e)})
        res["state"] = self.review_state(who)
        out(res)

    # ---- story sessions (story.py): this Mac and the home network only ----
    def story_get(self, path):
        if not usage.is_local_request(self):
            return self.send(404, {"error": "not found"})
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        try:
            if path in ("/story", "/story/"):
                return self.send(200, self.with_preview(open(os.path.join(HERE, "story_view.html"), "rb").read(), "story", "/story"), "text/html; charset=utf-8")
            if path == "/story/api/photos":
                return self.send(200, story.photo_data())
            if path == "/story/api/sessions":
                return self.send(200, {"sessions": story.sessions(), "settings": story.settings(), "voice": story.voice_name()})
            if path == "/story/api/voice":   # a fixed line in Claude's voice, to try the speakers
                line = story.LINES.get(q.get("line", ["hello"])[0], story.LINES["hello"])
                who = q.get("name", [""])[0]
                if line == story.LINES["hello"] and who in [t["name"] for t in story.tellers()]:
                    line = "Hi %s. I'm ready when you are." % who
                return self.send(200, {"audio": "cache/" + story.cached_line(line), "text": line})
            if path == "/story/api/health":   # the ready check, home Mac side
                h = story.health()
                h["onHomeMac"] = self.client_address[0] in ("127.0.0.1", "::1") or self.client_address[0] == self.connection.getsockname()[0]
                return self.send(200, h)
            if path == "/story/api/tellers":
                return self.send(200, {"tellers": story.tellers()})
            if path == "/story/api/stories":   # every saved story, and drafts waiting in sessions
                return self.send(200, story.stories_list())
            if path == "/story/api/story":   # one story to edit: ?photo=&index= (saved) or ?photo=&session= (a draft)
                return self.send(200, story.story_get(q.get("photo", [""])[0], q.get("index", [None])[0], q.get("session", [None])[0]))
            if path == "/story/api/session":
                return self.send(200, {"session": story.load(q.get("id", [""])[0])})
            if path == "/story/api/markers.csv":
                sid = q.get("id", [""])[0]
                return self.send(200, story.markers_csv(sid), "text/csv; charset=utf-8",
                                 headers=(("Content-Disposition", f'attachment; filename="{sid}-markers.csv"'),))
            if path.startswith("/story/audio/"):
                f = story.audio_file(urllib.parse.unquote(path[len("/story/audio/"):]))
                if not f:
                    return self.send(404, {"error": "not found"})
                return self.send(200, open(f, "rb").read(), "audio/wav" if f.endswith(".wav") else "audio/mp4", cache=True)
        except (KeyError, IndexError) as e:
            return self.send(404, {"error": str(e)})
        except (ValueError, TypeError) as e:
            return self.send(400, {"error": str(e)})
        self.send(404, {"error": "not found"})

    def story_post(self, sub):
        if not usage.is_local_request(self):
            return self.send(403, {"error": "only from this Mac or the home network"})
        n = int(self.headers.get("Content-Length") or 0)
        if n < 0 or n > 200_000_000:
            return self.send(413, {"error": "too large"})
        data = self.rfile.read(n) if n else b""
        q = {k: v[0] for k, v in urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).items()}
        try:
            if sub == "take":   # body = WAV
                return self.send(200, story.take(q.get("id", ""), q.get("photo", ""), data,
                                                 {"client": q.get("client"), "rate": q.get("rate"), "question": int(q["question"]) if q.get("question", "").isdigit() else None,
                                                  "correction": q.get("correction") == "1"}))
            if sub == "practice":   # body = WAV: a practice run through speech to text and Claude
                return self.send(200, story.practice(data, q.get("rate")))
            if sub == "speedtest":   # body = throwaway bytes, to time the upload from her computer
                return self.send(200, {"bytes": len(data)})
            if sub == "continuous":   # body = a slice of the whole-sitting recording
                return self.send(200, story.continuous(q.get("id", ""), q.get("part", "0"), data, q.get("ext", "webm")))
            b = json.loads(data or b"{}")
            if sub == "open-setting":
                return self.send(200, story.open_setting(json.loads(data or b"{}")))
            fn = {"context": story.context, "take-delete": story.take_delete, "tellers": story.teller_save, "story-save": story.story_save, "story-delete": story.story_delete,
                  "sessions": story.create, "session": story.act, "log": story.client_log, "ask": story.ask,
                  "drafts": story.drafts, "approve": story.approve}.get(sub)
            if not fn:
                return self.send(404, {"error": "not found"})
            return self.send(200, fn(b))
        except (KeyError, IndexError) as e:
            return self.send(404, {"error": str(e)})
        except (ValueError, TypeError) as e:
            return self.send(400, {"error": str(e)})
        except OSError as e:   # chat server down, say/afconvert failed, ...
            return self.send(502, {"error": str(e)})

    def save_photo_edit(self):
        """Hide/restore one photo or change its label (this Mac and the home network only)."""
        if not usage.is_local_request(self):
            return self.send(403, {"error": "only from this Mac or the home network"})
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > 4000:
            return self.send(413, {"error": "empty or too large"})
        try:
            b = json.loads(self.rfile.read(n))
            pid = str(b["id"])
            if not re.fullmatch(r"[A-Za-z0-9_\-]{1,120}", pid) or not os.path.exists(os.path.join(LOCAL, "photos", "thumb", pid + ".jpg")):
                raise ValueError("unknown photo")
            if "level" in b and b["level"] not in ("everyday", "medical", "graphic", None):
                raise ValueError("bad level")
        except Exception as e:  # noqa: BLE001
            return self.send(400, {"error": str(e)})
        with lock:
            e = read_photo_edits()
            if "hidden" in b:
                if b["hidden"]:
                    e["hidden"][pid] = {"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
                else:
                    e["hidden"].pop(pid, None)
            if "level" in b:
                if b["level"]:
                    e["level"][pid] = b["level"]
                else:
                    e["level"].pop(pid, None)
            if os.path.exists(PHOTO_EDITS):
                shutil.copy2(PHOTO_EDITS, PHOTO_EDITS.replace(".json", ".prev.json"))
            tmp = PHOTO_EDITS + ".tmp"
            with open(tmp, "w") as f:
                json.dump(e, f, indent=1)
            os.replace(tmp, PHOTO_EDITS)
        self.send(200, {"hidden": sorted(e["hidden"]), "level": e["level"], "canEdit": True})

    def save_start(self):
        """Replace the start view (this Mac and the home network only)."""
        if not usage.is_local_request(self):
            return self.send(403, {"error": "only from this Mac or the home network"})
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > START_MAX:
            return self.send(413, {"error": "empty or too large"})
        try:
            keys = json.loads(self.rfile.read(n))["keys"]
            if not isinstance(keys, dict) or not keys:
                raise ValueError("no settings to save")
            keys = {k: v for k, v in keys.items() if k not in START_SKIP}
            if not all(re.fullmatch(r"[A-Za-z0-9_.]{1,40}", k) for k in keys):
                raise ValueError("bad setting name")
        except Exception as e:  # noqa: BLE001 - any bad input is a 400
            return self.send(400, {"error": str(e)})
        new = {"saved": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "keys": keys}
        with lock:
            if os.path.exists(START):
                shutil.copy2(START, os.path.join(LOCAL, "start_view.prev.json"))
            tmp = START + ".tmp"
            with open(tmp, "w") as f:
                json.dump(new, f, indent=1)
            os.replace(tmp, START)
        print(time.strftime("%H:%M:%S"), self.client_address[0], "saved the start view,", len(keys), "settings")
        self.send(200, new)

    def log_message(self, fmt, *args):  # one short line per save, nothing for page loads
        if self.command == "POST" and self.path.split("?")[0] == "/api/edits":
            print(time.strftime("%H:%M:%S"), self.client_address[0], "saved edits", args[1] if len(args) > 1 else "")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--lan", action="store_true", help="listen on all network interfaces (home Wi-Fi only)")
    ap.add_argument("--port", type=int, default=8766)
    ap.add_argument("--https-port", type=int, help="also serve https here (needed for the story page's microphone)")
    ap.add_argument("--make-cert", action="store_true", help="make a self-signed certificate in local/tls/ and stop")
    a = ap.parse_args()
    TLS = os.path.join(LOCAL, "tls")
    if a.make_cert:
        import subprocess
        os.makedirs(TLS, exist_ok=True)
        ips = {"127.0.0.1"}
        for dev in ("en0", "en1", "en2"):
            r = subprocess.run(["ipconfig", "getifaddr", dev], capture_output=True, text=True)
            if r.stdout.strip():
                ips.add(r.stdout.strip())
        cnf = os.path.join(TLS, "openssl.cnf")
        open(cnf, "w").write("[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=erica-viewer\n[ext]\n"
                             "subjectAltName=" + ",".join(["DNS:localhost"] + ["IP:" + i for i in sorted(ips)]) + "\n")
        subprocess.check_call(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "825", "-keyout",
                               os.path.join(TLS, "key.pem"), "-out", os.path.join(TLS, "cert.pem"), "-config", cnf])
        os.chmod(os.path.join(TLS, "key.pem"), 0o600)
        raise SystemExit("certificate for " + ", ".join(sorted(ips)) + " in " + TLS)
    host = "0.0.0.0" if a.lan else "127.0.0.1"
    print(f"Viewer: http://127.0.0.1:{a.port}/" + ("  (also on this Mac's network address; no login)" if a.lan else ""))
    print("Edits are kept in", EDITS, "| Ctrl+C to stop")
    USAGE = usage.Usage(os.path.join(LOCAL, "usage.sqlite"))
    print(f"Usage stats: http://127.0.0.1:{a.port}/stats (this Mac and the home network only)")
    if a.https_port:
        import ssl
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.minimum_version = ssl.TLSVersion.TLSv1_2
        ctx.load_cert_chain(os.path.join(TLS, "cert.pem"), os.path.join(TLS, "key.pem"))
        hs = ThreadingHTTPServer((host, a.https_port), Handler)
        hs.socket = ctx.wrap_socket(hs.socket, server_side=True, do_handshake_on_connect=False)
        threading.Thread(target=hs.serve_forever, daemon=True).start()
        print(f"Also https on port {a.https_port}: story page https://127.0.0.1:{a.https_port}/story")
    ThreadingHTTPServer((host, a.port), Handler).serve_forever()
