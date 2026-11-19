#!/usr/bin/env python3
"""Serve the private viewer and keep its edits in one shared file, so every browser sees them.

Usage:
    python3 serve_viewer.py            # only this Mac:   http://127.0.0.1:8766/
    python3 serve_viewer.py --lan      # also other devices on the same Wi-Fi (no login!)
    python3 serve_viewer.py --port 8800

- Serves only local/labs.html (no folder listing, no other files), plus the imaging viewer's files:
  GET /imaging/<path> from local/imaging/ only, only .nii.gz (scans, outlines, dose maps) and .obj (3D lesion models).
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
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import usage

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
             "/api/conversation", "/api/review", "/api/tasks", "/api/person")


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
        if n > MAXBODY:
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
        for k in ("Content-Type", "Content-Length"):
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
        if path in ("/", "/labs.html"):
            if not os.path.exists(PAGE):
                return self.send(404, {"error": "local/labs.html not built yet: python3 make_lab_view.py"})
            html, extra = open(PAGE, "rb").read(), []
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
        if path.startswith("/pathology/"):   # pathology slide photos: inside local/pathology/, .jpg only
            rel = urllib.parse.unquote(path[len("/pathology/"):])
            base = os.path.realpath(os.path.join(LOCAL, "pathology"))
            f = os.path.realpath(os.path.join(base, rel))
            if f.startswith(base + os.sep) and f.lower().endswith(".jpg") and os.path.isfile(f):
                return self.send(200, open(f, "rb").read(), "image/jpeg", cache=True)
            if (f.startswith(base + os.sep) and os.path.basename(os.path.dirname(f)) in ("spots", "masks")
                    and f.endswith(".json") and os.path.isfile(f)):   # automatic nucleus spots / tissue maps, one file per slide
                return self.send(200, open(f, "rb").read(), "application/json")
            return self.send(404, {"error": "not found"})
        if path.startswith("/photos/"):   # photo story: website copies in local/photos/{thumb,web}/, and the stories
            return self.photos(urllib.parse.unquote(path[len("/photos/"):]))
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
    a = ap.parse_args()
    host = "0.0.0.0" if a.lan else "127.0.0.1"
    print(f"Viewer: http://127.0.0.1:{a.port}/" + ("  (also on this Mac's network address; no login)" if a.lan else ""))
    print("Edits are kept in", EDITS, "| Ctrl+C to stop")
    USAGE = usage.Usage(os.path.join(LOCAL, "usage.sqlite"))
    print(f"Usage stats: http://127.0.0.1:{a.port}/stats (this Mac and the home network only)")
    ThreadingHTTPServer((host, a.port), Handler).serve_forever()
