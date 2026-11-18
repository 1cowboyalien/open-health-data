"""Usage statistics and a health meter for serve_viewer.py (Python standard library only).

What is kept (in local/usage.sqlite, git-ignored, private):
- hits:   one row per request: UTC time, IP, visitor ID, method, path, status, bytes, response ms,
          user agent, referer. Paths of scan/slide files are shortened to their folder
          (/imaging/..., /pathology/...), and query strings are dropped.
- events: what the page itself reports (usage.js): page open/close, seconds on the page, which
          controls and panels were used (only their code names, e.g. "click:txHide",
          "show:mrd"), screen size. Never health values, test names, or Ask-chat text.
The visitor ID is a random cookie (ohd_vid) the server gives each browser, so the same browser
is recognised on later visits. Clearing cookies or a private window looks like a new browser.

Rows older than KEEP_DAYS are deleted, and the table is capped at MAX_ROWS.
"""
import ipaddress
import json
import os
import queue
import re
import secrets
import shutil
import socket
import sqlite3
import subprocess
import threading
import time

KEEP_DAYS = 400
MAX_ROWS = 1_000_000
PAGE_PATHS = ("/", "/labs.html")
STARTED = time.time()
EV_OK = re.compile(r"^[A-Za-z0-9_:.\-+]{0,48}$")
EV_TYPES = {"open", "close", "click", "show", "toggle", "hidden"}


def norm_path(p):
    p = p.split("?")[0].split("#")[0]
    for pre in ("/imaging/", "/pathology/"):
        if p.startswith(pre):
            return pre + "…"
    return p[:80]


def client_ip(h):
    """The visitor's address. A forwarding header is trusted only from this Mac (a local tunnel or
    proxy); then the visitor counts as outside. Returns (ip, came_through_proxy)."""
    peer = h.client_address[0]
    if peer.startswith("::ffff:"):
        peer = peer[7:]
    try:
        loop = ipaddress.ip_address(peer).is_loopback
    except ValueError:
        loop = False
    if loop:
        for k in ("Cf-Connecting-Ip", "X-Real-Ip", "X-Forwarded-For"):
            v = h.headers.get(k)
            if v:
                return v.split(",")[0].strip()[:64], True
    return peer, False


def is_lan(ip):
    try:
        a = ipaddress.ip_address(ip)
        return a.is_private or a.is_loopback or a.is_link_local
    except ValueError:
        return False


def is_local_request(h):
    ip, proxied = client_ip(h)
    return not proxied and is_lan(ip)


def visitor_id(h):
    m = re.search(r"(?:^|;\s*)ohd_vid=([A-Za-z0-9_\-]{8,32})", h.headers.get("Cookie") or "")
    return m.group(1) if m else ""


def new_visitor_id():
    return secrets.token_urlsafe(12)


def device(ua):
    """Rough device and browser from a user agent string."""
    u = ua or ""
    bots = [("ChatGPT", r"ChatGPT|GPTBot|OAI-SearchBot"), ("Claude", r"Claude|anthropic"),
            ("Google bot", r"Googlebot|Google-"), ("Bing bot", r"bingbot"), ("curl", r"^curl/"),
            ("Python script", r"python-|Python-urllib|aiohttp|httpx"), ("Go program", r"Go-http"),
            ("scanner", r"zgrab|masscan|Nmap|censys|Expanse|nuclei|InternetMeasurement|scan")]
    for name, rx in bots:
        if re.search(rx, u, re.I):
            return "bot", name
    if not u:
        return "bot", "no user agent"
    if re.search(r"bot|crawl|spider|fetch|preview", u, re.I):
        return "bot", re.sub(r"[/ ].*", "", u)[:30]
    os_ = ("iPhone" if "iPhone" in u else "iPad" if "iPad" in u else "Android" if "Android" in u
           else "Windows" if "Windows" in u else "Mac" if "Macintosh" in u else "Linux" if "Linux" in u
           else "other")
    br = ("Edge" if "Edg/" in u else "Firefox" if re.search(r"Firefox|FxiOS", u)
          else "Chrome" if re.search(r"Chrome|CriOS", u) else "Safari" if "Safari" in u else "other")
    return os_, br


class Usage:
    def __init__(self, path):
        self.path = path
        self.q = queue.Queue(maxsize=20000)
        self.dropped = 0
        db = self.connect()
        db.executescript("""
            CREATE TABLE IF NOT EXISTS hits(t REAL, ip TEXT, vid TEXT, method TEXT, path TEXT,
                status INT, bytes INT, ms REAL, ua TEXT, ref TEXT);
            CREATE INDEX IF NOT EXISTS hits_t ON hits(t);
            CREATE INDEX IF NOT EXISTS hits_vid ON hits(vid, t);
            CREATE TABLE IF NOT EXISTS events(t REAL, ip TEXT, vid TEXT, ev TEXT, detail TEXT,
                ms INT, w INT, h INT);
            CREATE INDEX IF NOT EXISTS events_t ON events(t);
        """)
        db.close()
        self.prune()
        threading.Thread(target=self.writer, daemon=True).start()
        self.net_last = None

    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.execute("PRAGMA journal_mode=WAL")
        return db

    # ---- writing (one background thread, so requests never wait on the disk) ----
    def put(self, table, row):
        try:
            self.q.put_nowait((table, row))
        except queue.Full:
            self.dropped += 1

    def hit(self, h, status, nbytes, ms, vid):
        ip, _ = client_ip(h)
        self.put("hits", (time.time(), ip, vid, h.command, norm_path(h.path), status, nbytes,
                          round(ms, 1), (h.headers.get("User-Agent") or "")[:300],
                          (h.headers.get("Referer") or "")[:200]))

    def events(self, h, vid, body):
        ip, _ = client_ip(h)
        now = time.time()
        w, ht = body.get("w"), body.get("h")
        w = int(w) if isinstance(w, (int, float)) else None
        ht = int(ht) if isinstance(ht, (int, float)) else None
        n = 0
        for e in (body.get("events") or [])[:60]:
            ev, d = str(e.get("ev", "")), str(e.get("d", ""))
            if ev not in EV_TYPES or not EV_OK.match(d):
                continue
            ms = e.get("ms")
            ms = int(ms) if isinstance(ms, (int, float)) and 0 <= ms < 7 * 86400_000 else None
            self.put("events", (now, ip, vid, ev, d, ms, w, ht))
            n += 1
        return n

    def writer(self):
        db = self.connect()
        last_prune = time.time()
        while True:
            items = [self.q.get()]
            time.sleep(0.5)
            while not self.q.empty() and len(items) < 5000:
                items.append(self.q.get_nowait())
            try:
                for table in ("hits", "events"):
                    rows = [r for t, r in items if t == table]
                    if rows:
                        db.executemany(f"INSERT INTO {table} VALUES ({','.join('?' * len(rows[0]))})", rows)
                db.commit()
            except sqlite3.Error as e:
                print("usage log write failed:", e)
            if time.time() - last_prune > 6 * 3600:
                self.prune()
                last_prune = time.time()

    def prune(self):
        db = self.connect()
        cut = time.time() - KEEP_DAYS * 86400
        for t in ("hits", "events"):
            db.execute(f"DELETE FROM {t} WHERE t < ?", (cut,))
            n = db.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
            if n > MAX_ROWS:
                db.execute(f"DELETE FROM {t} WHERE rowid IN (SELECT rowid FROM {t} ORDER BY t LIMIT ?)",
                           (n - MAX_ROWS,))
        db.commit()
        db.close()

    # ---- report ----
    def stats(self, rng="day"):
        span, step = {"hour": (3600, 300), "day": (86400, 3600), "week": (7 * 86400, 6 * 3600),
                      "month": (30 * 86400, 86400)}.get(rng, (86400, 3600))
        now = time.time()
        db = self.connect()
        db.row_factory = sqlite3.Row
        pv = "path IN ('/', '/labs.html') AND method = 'GET' AND status = 200"
        first = {r[0]: r[1] for r in db.execute(
            "SELECT vid, MIN(t) FROM hits WHERE vid != '' GROUP BY vid")}
        ip_first = {r[0]: r[1] for r in db.execute(f"SELECT ip, MIN(t) FROM hits WHERE {pv} GROUP BY ip")}

        def summary(since):
            r = db.execute(f"""SELECT COUNT(*) req, SUM({pv}) views, COALESCE(SUM(bytes),0) bytes,
                SUM(status >= 500) err5, SUM(status >= 400 AND status < 500) err4,
                COUNT(DISTINCT CASE WHEN {pv} THEN ip END) ips
                FROM hits WHERE t >= ?""", (since,)).fetchone()
            vids = [v[0] for v in db.execute(
                f"SELECT DISTINCT vid FROM hits WHERE t >= ? AND vid != '' AND {pv}", (since,))]
            new = sum(1 for v in vids if first.get(v, 0) >= since)
            tp = db.execute("SELECT COALESCE(SUM(ms),0) FROM events WHERE t >= ? AND ev IN ('close','hidden')",
                            (since,)).fetchone()[0]
            bots = db.execute(f"SELECT ua FROM hits WHERE t >= ? AND {pv}", (since,)).fetchall()
            nbot = sum(1 for (ua,) in bots if device(ua)[0] == "bot")
            return {"requests": r["req"], "views": r["views"] or 0, "bytes": r["bytes"],
                    "errors5": r["err5"] or 0, "errors4": r["err4"] or 0, "ips": r["ips"],
                    "browsers": len(vids), "newBrowsers": new, "returning": len(vids) - new,
                    "secondsOnPage": round(tp / 1000), "botViews": nbot}

        cards = {k: summary(now - s) for k, s in (("hour", 3600), ("day", 86400), ("month", 30 * 86400))}
        since = now - span
        start = since - since % step
        buckets = []
        for b0 in range(int(start), int(now) + 1, step):
            buckets.append({"t": b0, "views": 0, "browsers": 0, "requests": 0, "bytes": 0})
        idx = {b["t"]: b for b in buckets}
        for r in db.execute(f"""SELECT CAST(t / ? AS INT) * ? b, COUNT(*) n, SUM({pv}) v,
                COUNT(DISTINCT CASE WHEN {pv} AND vid != '' THEN vid END) u, SUM(bytes) nb
                FROM hits WHERE t >= ? GROUP BY b""", (step, step, start)):
            if r["b"] in idx:
                idx[r["b"]].update(requests=r["n"], views=r["v"] or 0, browsers=r["u"], bytes=r["nb"] or 0)

        feats = {}
        for r in db.execute("""SELECT ev || ':' || detail k, COUNT(*) n, COUNT(DISTINCT vid) u
                FROM events WHERE t >= ? AND ev IN ('click','show','toggle') GROUP BY k""", (since,)):
            feats[r["k"]] = [r["n"], r["u"]]
        for label, cond in (("Ask chat: questions", "path = '/ask/api/chat' AND method = 'POST'"),
                            ("MRI viewer: scan files", "path = '/imaging/…'"),
                            ("Pathology: slide photos", "path = '/pathology/…'"),
                            ("Shared edits saved", "path = '/api/edits' AND method = 'POST' AND status = 200")):
            r = db.execute(f"SELECT COUNT(*), COUNT(DISTINCT vid) FROM hits WHERE t >= ? AND {cond}",
                           (since,)).fetchone()
            if r[0]:
                feats[label] = [r[0], r[1]]
        top = sorted(feats.items(), key=lambda kv: -kv[1][0])[:30]

        screens = [list(r) for r in db.execute("""SELECT w || '×' || h s, COUNT(DISTINCT vid) FROM events
                WHERE t >= ? AND ev = 'open' AND w > 0 GROUP BY s ORDER BY 2 DESC LIMIT 8""", (since,))]

        visitors = []
        for r in db.execute(f"""SELECT CASE WHEN vid != '' THEN vid ELSE 'ip:' || ip END who,
                MAX(t) last, SUM({pv}) views, COUNT(*) req, GROUP_CONCAT(DISTINCT ip) ips,
                MAX(ua) ua, SUM(bytes) bytes
                FROM hits WHERE t >= ? GROUP BY who HAVING views > 0 ORDER BY last DESC LIMIT 60""", (since,)):
            who = r["who"]
            ips = (r["ips"] or "").split(",")
            vid = "" if who.startswith("ip:") else who
            fst = first.get(vid) if vid else ip_first.get(ips[0])
            allv = db.execute(f"SELECT COUNT(*) FROM hits WHERE {pv} AND " +
                              ("vid = ?" if vid else "ip = ?"), (vid or ips[0],)).fetchone()[0]
            secs = db.execute("SELECT COALESCE(SUM(ms),0) FROM events WHERE ev IN ('close','hidden') AND " +
                              ("vid = ?" if vid else "ip = ?") + " AND t >= ?", (vid or ips[0], since)).fetchone()[0]
            kind, br = device(r["ua"])
            visitors.append({"id": (vid[:6] if vid else "no cookie"), "ips": ips[:4],
                             "where": "LAN" if all(is_lan(i) for i in ips) else "internet",
                             "device": kind, "browser": br, "first": fst, "last": r["last"],
                             "viewsInRange": r["views"], "viewsEver": allv, "bytes": r["bytes"],
                             "secondsOnPage": round(secs / 1000), "newInRange": bool(fst and fst >= since),
                             "bot": kind == "bot"})
        db.close()
        return {"now": now, "range": rng, "span": span, "step": step, "cards": cards,
                "timeline": buckets, "features": top, "screens": screens, "visitors": visitors,
                "health": self.health()}

    # ---- health meter ----
    def health(self):
        now = time.time()
        out = {}
        cores = os.cpu_count() or 1
        l1, l5, l15 = os.getloadavg()
        out["cpu"] = {"load1": round(l1, 2), "load5": round(l5, 2), "load15": round(l15, 2), "cores": cores,
                      "pct": round(100 * l1 / cores), "level": level(l1 / cores, .7, 1.0),
                      "how": "measured: 1-minute load average ÷ CPU cores"}
        try:
            txt = subprocess.run(["memory_pressure", "-Q"], capture_output=True, text=True, timeout=5).stdout
            free = int(re.search(r"free percentage:\s*(\d+)", txt).group(1))
            total = int(subprocess.run(["sysctl", "-n", "hw.memsize"], capture_output=True, text=True,
                                       timeout=5).stdout)
            out["memory"] = {"usedPct": 100 - free, "totalGB": round(total / 2**30),
                             "level": level((100 - free) / 100, .80, .92),
                             "how": "measured: macOS memory_pressure (free percentage)"}
        except Exception:  # noqa: BLE001
            out["memory"] = {"level": "unknown"}
        disks = []
        for name, p in (("ssd70 (data)", "/Volumes/ssd70"), ("Mac disk", "/")):
            try:
                d = shutil.disk_usage(p)
                used = d.used / d.total
                disks.append({"name": name, "freeGB": round(d.free / 1e9), "totalGB": round(d.total / 1e9),
                              "usedPct": round(100 * used), "level": level(used, .85, .95)})
            except OSError:
                pass
        out["disks"] = disks
        try:
            bt = subprocess.run(["sysctl", "-n", "kern.boottime"], capture_output=True, text=True,
                                timeout=5).stdout
            boot = int(re.search(r"sec = (\d+)", bt).group(1))
        except Exception:  # noqa: BLE001
            boot = None
        out["uptime"] = {"server": round(now - STARTED), "mac": round(now - boot) if boot else None,
                         "threads": threading.active_count(), "queued": self.q.qsize(), "dropped": self.dropped}
        db = self.connect()
        rows = db.execute("SELECT ms, status, bytes, t, path FROM hits WHERE t >= ?", (now - 300,)).fetchall()
        ms = sorted(r[0] for r in rows if not r[4].startswith("/ask/"))
        n = len(rows)
        avg = sum(ms) / len(ms) if ms else 0
        p95 = ms[min(len(ms) - 1, int(.95 * len(ms)))] if ms else 0
        e5 = sum(1 for r in rows if r[1] >= 500)
        out["traffic"] = {"perMin": round(n / 5, 1), "avgMs": round(avg, 1), "p95Ms": round(p95, 1),
                          "errorPct": round(100 * e5 / n, 1) if n else 0, "bytesPerMin": sum(r[2] or 0 for r in rows) / 5,
                          "level": worst(level(p95 / 1000, .5, 2.0), level(e5 / n if n else 0, .01, .05)),
                          "how": "measured: requests in the last 5 minutes (Ask answers left out of the times)"}
        # Busiest minute of the past day = the most this connection has been seen to send.
        peak = db.execute("""SELECT MAX(s) FROM (SELECT SUM(bytes) s FROM hits WHERE t >= ?
                             GROUP BY CAST(t / 60 AS INT))""", (now - 86400,)).fetchone()[0] or 0
        db.close()
        out["connection"] = {"internetMs": tcp_ms(("1.1.1.1", 443)), "internetMs2": tcp_ms(("8.8.8.8", 53)),
                             "peakSendMbps": round(peak * 8 / 60 / 1e6, 2), **self.net_rate()}
        ims = [x for x in (out["connection"]["internetMs"], out["connection"]["internetMs2"]) if x is not None]
        im = min(ims) if ims else None
        out["connection"]["level"] = "red" if im is None else level(im / 1000, .08, .3)
        out["overall"] = worst(*(x.get("level", "green") for x in
                                 [out["cpu"], out["memory"], out["traffic"], out["connection"], *disks]))
        return out

    def net_rate(self):
        """Bytes in/out per second on the main network interface, measured between two refreshes."""
        try:
            iface = re.search(r"interface:\s*(\S+)", subprocess.run(
                ["route", "-n", "get", "default"], capture_output=True, text=True, timeout=5).stdout).group(1)
            for line in subprocess.run(["netstat", "-ibn", "-I", iface], capture_output=True, text=True,
                                       timeout=5).stdout.splitlines()[1:]:
                f = line.split()
                if len(f) >= 10 and f[2].startswith("<Link"):
                    ib, ob = int(f[6]), int(f[9])
                    break
            else:
                return {}
        except Exception:  # noqa: BLE001
            return {}
        now = time.time()
        res = {"iface": iface}
        if self.net_last and self.net_last[0] == iface and now - self.net_last[1] > 1:
            dt = now - self.net_last[1]
            res["inMbps"] = round(max(0, ib - self.net_last[2]) * 8 / dt / 1e6, 2)
            res["outMbps"] = round(max(0, ob - self.net_last[3]) * 8 / dt / 1e6, 2)
            res["overSec"] = round(dt)
        self.net_last = (iface, now, ib, ob)
        return res


def tcp_ms(addr):
    t = time.perf_counter()
    try:
        socket.create_connection(addr, timeout=2).close()
        return round((time.perf_counter() - t) * 1000, 1)
    except OSError:
        return None


def level(x, amber, red):
    return "red" if x >= red else "amber" if x >= amber else "green"


def worst(*levels):
    for lv in ("red", "amber", "green"):
        if lv in levels:
            return lv
    return "unknown"


def load_conf(path):
    try:
        return json.load(open(path))
    except (OSError, ValueError):
        return {}
