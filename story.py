"""The "Tell your story" sessions (Erica first, and anyone else with a story about her journey: each session has a storyteller): the server side of story_view.html (served by serve_viewer.py at /story).

Everything here answers only this Mac and the home network (VPN included); serve_viewer.py checks that first.
Private files, all under local/story/ (never in git):
    settings.json            {"voice": "Samantha", "claudeSeesPhoto": false, "model": "sonnet", "maxQuestions": 3}
    Story Transcribe.app     on-device speech to text (story/build_transcribe.sh); first use asks for permission
    voice_cache/             spoken lines that are always the same ("Tell me about this one.")
    sessions/<sid>/session.json   the sitting: photo queue, place, takes, questions, drafts, who has it open
                  takes/NNN.wav       each answer, as recorded (48 kHz mono WAV, kept for the narrated video)
                  questions/NNN.m4a   each spoken question
                  continuous-NN.webm  the whole sitting, one file per stretch between pauses (for syncing phone video)
                  log.jsonl           every event, with the laptop's clock and this Mac's clock
Approved stories go to local/photos/stories/<photo id>.json, which the gallery shows (family-only ones only at home).
Claude's questions come from the chat server (chat/serve_chat.py, POST /api/interview), which runs Claude on this Mac.
Python standard library plus macOS tools (say, afconvert, open).
"""
import datetime
import json
import os
import re
import secrets
import subprocess
import tempfile
import threading
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
LOCAL = os.path.join(HERE, "local")
BASE = os.path.join(LOCAL, "story")
SESS = os.path.join(BASE, "sessions")
PHOTOS = os.path.join(LOCAL, "photos")
STORIES = os.path.join(PHOTOS, "stories")
APP = os.path.join(BASE, "Story Transcribe.app")
ASK_CONF = os.path.join(LOCAL, "ask.json")
LIVE_SECONDS = 30          # a device that hasn't checked in for this long has let go of the session
lock = threading.Lock()
SID = re.compile(r"s-\d{8}-\d{6}-[a-z0-9]{4}$")
PID = re.compile(r"[A-Za-z0-9_\-]{1,120}$")
LINES = {"hello": "Hi. I'm ready when you are.",
         "wrong": "Sorry, I didn't get that right. Tell me again, in your own words.",
         "more": "Take your time. Tell me more."}
OPENERS = ["Tell me about this one.", "What's happening here?", "What do you remember about this one?",
           "Tell me the story of this one.", "What comes to mind when you see this?"]


def now():
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime())


DEFAULT_TELLERS = [{"name": "Erica", "about": "Erica herself, whose story this is"},
                   {"name": "Nina", "about": "Erica's identical twin sister"},
                   {"name": "Dan", "about": ""}, {"name": "Kyle", "about": ""}]


def tellers():
    """Who can tell stories: local/story/tellers.json (Erica first), else the defaults."""
    try:
        t = json.load(open(os.path.join(BASE, "tellers.json")))
        if isinstance(t, list) and t:
            return t
    except (OSError, ValueError):
        pass
    return list(DEFAULT_TELLERS)


def teller_save(b):
    """Add a storyteller, or change how they know Erica."""
    name = re.sub(r"\s+", " ", str(b.get("name") or "")).strip()[:40]
    if not re.fullmatch(r"[A-Za-z][A-Za-z .'\-]{0,39}", name):
        raise ValueError("a name, letters only")
    about = str(b.get("about") or "").strip()[:120]
    with lock:
        t = tellers()
        cur = next((x for x in t if x["name"].lower() == name.lower()), None)
        if cur:
            if "about" in b:
                cur["about"] = about
        else:
            t.append({"name": name, "about": about})
        json.dump(t, open(os.path.join(BASE, "tellers.json"), "w"), indent=1, ensure_ascii=False)
    return {"tellers": t}


def teller_of(s):
    return (s or {}).get("teller") or "Erica"


def teller_line(name):
    """How Claude should think of the person talking, from tellers.json."""
    t = next((x for x in tellers() if x["name"] == name), {"name": name, "about": ""})
    return "%s%s" % (name, (" (" + t["about"] + ")") if t.get("about") else " (how they know Erica isn't recorded; you may ask)")


def settings():
    s = {"voice": "", "claudeSeesPhoto": False, "model": "sonnet", "maxQuestions": 3}
    try:
        s.update(json.load(open(os.path.join(BASE, "settings.json"))))
    except (OSError, ValueError):
        pass
    return s


# ---------------- photos and what was happening ----------------
def photo_data():
    """The gallery's items (website copies), minus hidden photos, with the chapters and a slim timeline."""
    try:
        v = json.load(open(os.path.join(PHOTOS, "photos_view.json")))
    except (OSError, ValueError):
        return {"items": [], "chapters": [], "timeline": []}
    try:
        hidden = set(json.load(open(os.path.join(PHOTOS, "photo_edits.json"))).get("hidden") or {})
    except (OSError, ValueError):
        hidden = set()
    told, by = {}, {}
    for f in os.listdir(STORIES) if os.path.isdir(STORIES) else []:
        if f.endswith(".json"):
            try:
                st = json.load(open(os.path.join(STORIES, f))).get("stories") or []
                told[f[:-5]] = len(st)
                by[f[:-5]] = sorted({x.get("teller") or "Erica" for x in st})
            except (OSError, ValueError):
                pass
    items = [dict(i, told=told.get(i["id"], 0), tellers=by.get(i["id"], [])) for i in v.get("items", []) if i["id"] not in hidden]
    return {"title": v.get("title"), "teller": v.get("teller") or "Erica", "items": items,
            "chapters": v.get("chapters", []), "timeline": timeline()}


def timeline():
    """Procedures, hospital stays and radiation courses, as [{from, to?, text, kind}] for the strip under the photo."""
    try:
        p = json.load(open(os.path.join(LOCAL, "procedures", "procedures.json")))
    except (OSError, ValueError):
        return []
    out = []
    for e in p.get("events", []):
        if e.get("date"):
            out.append({"from": e["date"], "text": e.get("short") or e.get("procedure") or "", "kind": "event"})
    for s in p.get("stays", []):
        site = s.get("site") or ""
        out.append({"from": str(s.get("from", ""))[:10], "to": str(s.get("to") or s.get("from", ""))[:10],
                    "text": ("ER visit" if s.get("kind") == "er" else "In hospital") + (" (" + site.title() + ")" if site else ""),
                    "kind": "stay"})
    for r in p.get("rt_courses", []):
        out.append({"from": r.get("from"), "to": r.get("to"), "text": "Radiation: " + (r.get("label") or ""), "kind": "radiation"})
    return sorted(out, key=lambda x: x["from"] or "")


def nearby(t, days=21):
    """Timeline entries within `days` of the date t (YYYY-MM-DD...), as short lines for Claude."""
    date, gap = datetime.date, datetime.timedelta(days=days)
    try:
        d0 = date.fromisoformat(t[:10])
    except (TypeError, ValueError):
        return []
    out = []
    for e in timeline():
        try:
            a = date.fromisoformat(e["from"][:10]); b = date.fromisoformat((e.get("to") or e["from"])[:10])
        except (TypeError, ValueError):
            continue
        if a - d0 > gap or d0 - b > gap:
            continue
        rel = "during" if a <= d0 <= b else ("%d days before the photo" % (d0 - b).days if b < d0 else "%d days after the photo" % (a - d0).days)
        out.append("%s%s: %s (%s)" % (e["from"], (" to " + e["to"]) if e.get("to") and e["to"] != e["from"] else "", e["text"], rel))
    return out


# ---------------- sessions ----------------
def path(sid, *p):
    return os.path.join(SESS, sid, *p)


def load(sid):
    if not SID.match(sid or "") or not os.path.exists(path(sid, "session.json")):
        raise KeyError("no such session")
    return json.load(open(path(sid, "session.json")))


def save(s):
    tmp = path(s["id"], "session.json.tmp")
    with open(tmp, "w") as f:
        json.dump(s, f, indent=1, ensure_ascii=False)
    os.replace(tmp, path(s["id"], "session.json"))


def log(sid, ev):
    ev = dict(ev, server=now())
    with open(path(sid, "log.jsonl"), "a") as f:
        f.write(json.dumps(ev, ensure_ascii=False) + "\n")


def public(s):
    """What the page needs (everything; the session is only ever shown at home)."""
    return s


def sessions():
    out = []
    for sid in sorted(os.listdir(SESS), reverse=True) if os.path.isdir(SESS) else []:
        try:
            s = load(sid)
        except (KeyError, OSError, ValueError):
            continue
        drafts = s.get("drafts") or {}
        out.append({"id": sid, "title": s["title"], "created": s["created"], "status": s["status"], "teller": teller_of(s),
                    "updated": s.get("updated"), "pos": s["pos"], "firstPhoto": s["photos"][min(s["pos"], len(s["photos"]) - 1)] if s["photos"] else None, "count": len(s["photos"]), "done": len(s.get("done") or []),
                    "toReview": sum(1 for d in drafts.values() if d.get("status") != "approved")
                                + sum(1 for p in s.get("done") or [] if p not in drafts and any(t["photo"] == p and t.get("text") for t in s["takes"])),
                    "live": s.get("live")})
    return out


def create(b):
    ids = [str(x) for x in b.get("photos") or [] if PID.match(str(x))]
    known = {i["id"] for i in photo_data()["items"]}
    ids = [i for i in ids if i in known]
    if not ids and not b.get("free"):
        raise ValueError("no photos chosen")
    sid = time.strftime("s-%Y%m%d-%H%M%S-") + secrets.token_hex(2)
    os.makedirs(path(sid, "takes")); os.makedirs(path(sid, "questions"))
    names = [x["name"] for x in tellers()]
    teller = str(b.get("teller") or "Erica")
    if teller not in names:
        raise ValueError("unknown storyteller: add them first")
    s = {"id": sid, "title": str(b.get("title") or "Story session")[:120], "created": now(), "updated": now(), "teller": teller,
         "status": "new", "photos": ids, "pos": 0, "done": [], "takes": [], "questions": [], "drafts": {},
         "claude": None, "parts": 0, "live": None, "free": bool(b.get("free"))}
    save(s)
    log(sid, {"ev": "created", "photos": len(ids)})
    return s


def act(b):
    """claim / heartbeat / goto / pause / resume / end / done (a photo finished)."""
    sid, a, dev = str(b.get("id")), b.get("action"), str(b.get("device") or "")[:60]
    with lock:
        s = load(sid)
        live, t = s.get("live"), time.time()
        mine = live and live.get("device") == dev
        free = not live or t - live.get("t", 0) > LIVE_SECONDS
        if a == "claim":
            if not (mine or free or b.get("force")):
                return {"session": s, "busy": live}
            if live and not mine:
                log(sid, {"ev": "taken over", "from": live.get("device"), "device": dev})
            s["live"] = {"device": dev, "t": t, "name": str(b.get("deviceName") or "")[:60]}
            s["status"] = "active"
            s["parts"] = s.get("parts", 0) + 1   # each stretch between pauses gets its own whole-sitting recording
        elif not mine:
            return {"session": s, "lost": True, "live": live}   # another device has it now
        elif a == "heartbeat":
            s["live"]["t"] = t
        elif a == "newpart":   # the microphone changed: the whole-sitting recording starts a new file
            s["parts"] = s.get("parts", 0) + 1
        elif a == "goto":
            s["pos"] = max(0, min(max(0, len(s["photos"]) - 1), int(b.get("pos", s["pos"]))))
        elif a == "done":
            p = str(b.get("photo"))
            if p in s["photos"] and p not in s["done"]:
                s["done"].append(p)
        elif a in ("pause", "end"):
            s["status"] = "paused" if a == "pause" else "ended"
            s["live"] = None
        s["updated"] = now()
        save(s)
    if a not in ("heartbeat",):
        log(sid, {"ev": a, "device": dev, "pos": s["pos"], "client": b.get("client")})
    return {"session": s}


def client_log(b):
    sid = str(b.get("id"))
    load(sid)
    for e in (b.get("events") or [])[:200]:
        if isinstance(e, dict):
            log(sid, {k: e[k] for k in list(e)[:12]})
    return {"ok": True}


def continuous(sid, part, data, ext="webm"):
    """Append a chunk of the whole-sitting recording (MediaRecorder slices joined back into one file)."""
    load(sid)
    part = int(part)
    if not 0 < part < 1000 or ext not in ("webm", "mp4", "ogg"):
        raise ValueError("bad part")
    with lock:
        with open(path(sid, "continuous-%02d.%s" % (part, ext)), "ab") as f:
            f.write(data)
    return {"ok": True}


# ---------------- speech to text ----------------
def split_at_pauses(wav, out_dir, pause=0.7, longest=25.0):
    """Cut a 16-bit mono WAV into pieces at its pauses (Apple's recognizer starts over after a pause and keeps only the
    last stretch, so each piece is turned into words on its own). Returns [(file, start seconds)], quiet pieces left out."""
    import array, wave
    w = wave.open(wav, "rb")
    rate, n = w.getframerate(), w.getnframes()
    if w.getsampwidth() != 2 or w.getnchannels() != 1:
        return [(wav, 0.0)]
    x = array.array("h", w.readframes(n)); w.close()
    hop = int(rate * 0.05)   # 50 ms frames
    rms = []
    for i in range(0, len(x), hop):
        f = x[i:i + hop]
        rms.append((sum(v * v for v in f) / max(1, len(f))) ** 0.5 if f else 0)
    if not rms:
        return []
    srt = sorted(rms)
    floor, peak = srt[len(srt) // 5], srt[-1]
    thr = max(floor * 3, peak * 0.04, 60)
    loud = [r > thr for r in rms]
    if not any(loud):
        return []
    # pieces: runs of sound, split where the quiet lasts at least `pause`
    need, pieces, start, quiet = int(pause / 0.05), [], None, 0
    for i, l in enumerate(loud + [False] * (need + 1)):
        if l:
            if start is None:
                start = i
            quiet = 0
        elif start is not None:
            quiet += 1
            if quiet >= need:
                pieces.append([start, i - quiet + 1]); start, quiet = None, 0
    # a piece longer than `longest`: split it at its quietest frame
    out, maxf = [], int(longest / 0.05)
    while pieces:
        a, b = pieces.pop(0)
        if b - a > maxf:
            lo, hi = a + maxf // 2, a + maxf
            cut = min(range(lo, hi), key=lambda k: rms[k])
            pieces[:0] = [[a, cut], [cut, b]]
            continue
        out.append((a, b))
    files = []
    pad = int(0.25 / 0.05)
    for k, (a, b) in enumerate(out):
        a2, b2 = max(0, a - pad), min(len(rms), b + pad)
        f = os.path.join(out_dir, "piece-%02d.wav" % k)
        o = wave.open(f, "wb"); o.setnchannels(1); o.setsampwidth(2); o.setframerate(rate)
        o.writeframes(x[a2 * hop:b2 * hop].tobytes()); o.close()
        files.append((f, a2 * 0.05))
    return files


def transcribe(wav):
    """On-device speech to text, piece by piece between pauses; {"text", "segments"} or {"error"}."""
    if os.environ.get("STORY_FAKE_STT"):   # testing the page without the transcriber
        return {"text": os.environ["STORY_FAKE_STT"], "segments": []}
    d = tempfile.mkdtemp()
    try:
        try:
            pieces = split_at_pauses(wav, d)
        except Exception:   # not a plain WAV: send it whole
            pieces = [(wav, 0.0)]
        if not pieces:
            return {"text": "", "segments": []}
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=4) as pool:   # several pieces at once: each runs in its own copy of the app
            results = list(pool.map(lambda p: transcribe_one(p[0]), pieces))
        texts, segs = [], []
        for (f, t0), r in zip(pieces, results):
            if r.get("error"):
                return r
            if (r.get("text") or "").strip():
                texts.append(r["text"].strip())
            for g in r.get("segments") or []:
                segs.append(dict(g, t=round(g.get("t", 0) + t0, 2)))
        return {"text": " ".join(texts), "segments": segs, "pieces": len(pieces)}
    finally:
        __import__("shutil").rmtree(d, ignore_errors=True)


def transcribe_one(wav):
    """On-device speech to text of one short piece with Story Transcribe.app; {"text", "segments"} or {"error"}."""
    if not os.path.isdir(APP):
        return {"error": "the transcriber isn't built (story/build_transcribe.sh)"}
    fd, out = tempfile.mkstemp(suffix=".json"); os.close(fd); os.remove(out)
    try:   # start the app, then wait for its result file (open -W can't always wait on a background app)
        subprocess.run(["open", "-n", "-g", "-j", APP, "--args", wav, out], timeout=30,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        t0 = time.time()
        while time.time() - t0 < 180:
            if os.path.exists(out) and os.path.getsize(out):
                time.sleep(0.05)
                r = json.load(open(out))
                if "Dictation" in str(r.get("error", "")):
                    r["error"] = "Dictation is turned off on the home Mac (System Settings, Keyboard, Dictation)"
                return r
            time.sleep(0.2)
        return {"error": "speech to text took too long"}
    except (OSError, ValueError, subprocess.SubprocessError) as e:
        return {"error": "speech to text failed: %s" % e}
    finally:
        for f in (out, out + ".log"):
            if os.path.exists(f):
                os.remove(f)


def take(sid, photo, data, meta):
    """Save one answer (WAV), turn it into text, and add it to the session."""
    if photo and not PID.match(photo):
        raise ValueError("bad photo")
    if data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise ValueError("not a WAV recording")
    with lock:
        s = load(sid)
        n = len(s["takes"]) + 1
        name = "%03d.wav" % n
        open(path(sid, "takes", name), "wb").write(data)
        s["takes"].append({"n": n, "photo": photo, "file": name, "at": now(), "client": meta.get("client"),
                           "seconds": round((len(data) - 44) / 2 / max(1, int(meta.get("rate") or 48000)), 1),
                           "question": meta.get("question") or None, "text": None, "correction": bool(meta.get("correction"))})
        save(s)
    r = transcribe(path(sid, "takes", name))
    with lock:
        s = load(sid)
        t = next(x for x in s["takes"] if x["n"] == n)
        t["text"] = r.get("text") if "text" in r else None
        t["segments"] = r.get("segments")
        if r.get("error"):
            t["error"] = r["error"]
        save(s)
    log(sid, {"ev": "take", "n": n, "photo": photo, "seconds": t["seconds"], "client": meta.get("client")})
    return {"take": t}


# ---------------- Claude (via the chat server) and Claude's voice ----------------
def chat_server():
    if os.environ.get("STORY_CHAT"):   # a test chat server
        return os.environ["STORY_CHAT"].rstrip("/")
    try:
        return json.load(open(ASK_CONF))["chatServer"].rstrip("/")
    except (OSError, ValueError, KeyError):
        return "http://127.0.0.1:8820"


def claude(prompt, sid=None, image=None, timeout=120):
    st = settings()
    body = json.dumps({"prompt": prompt, "sessionId": sid, "image": image if st["claudeSeesPhoto"] else None,
                       "model": st["model"]}).encode()
    req = urllib.request.Request(chat_server() + "/api/interview", data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def voice_name():
    v = settings().get("voice")
    if v:
        return v
    try:
        names = subprocess.run(["say", "-v", "?"], capture_output=True, text=True, timeout=10).stdout
    except (OSError, subprocess.SubprocessError):
        return ""
    for pat in (r"^(.+?\((?:Premium|Enhanced)\))\s+en_US", r"^(.+?\((?:Premium|Enhanced)\))\s+en_", r"^(Samantha)\s+en_US"):
        m = re.search(pat, names, re.M)
        if m:
            return m.group(1).strip()
    return ""


def speak(text, out):
    """Text to speech with the Mac's voice, saved as .m4a."""
    tmp = out + ".aiff"
    v = voice_name()
    subprocess.run(["say"] + (["-v", v] if v else []) + ["-o", tmp, text], check=True, timeout=60)
    subprocess.run(["afconvert", "-f", "m4af", "-d", "aac", tmp, out], check=True, timeout=60)
    os.remove(tmp)


def cached_line(text):
    d = os.path.join(BASE, "voice_cache")
    os.makedirs(d, exist_ok=True)
    name = re.sub(r"[^a-z0-9]+", "-", (voice_name() + "-" + text).lower()).strip("-")[:90] + ".m4a"
    f = os.path.join(d, name)
    if not os.path.exists(f):
        speak(text, f)
    return name


TOPICS = ("photos", "mri", "labs", "signatera", "procedures", "pathology")


def overview():
    """The whole story in dates, for Claude to find an event she talks about: procedures, stays, radiation,
    brain MRIs, Signatera results and how many photos there are each month."""
    out = ["Medical timeline (from the records):"]
    for e in timeline():
        out.append("- %s%s: %s" % (e["from"], (" to " + e["to"]) if e.get("to") and e["to"] != e["from"] else "", e["text"]))
    try:
        for r in json.load(open(os.path.join(LOCAL, "imaging", "imaging.json")))["brain_mri"]:
            out.append("- %s: brain MRI at %s (%s)" % (r["date"], r.get("hospital", ""), r.get("finding", "")))
    except (OSError, ValueError, KeyError):
        pass
    try:
        for line in open(os.path.join(LOCAL, "mrd_tests.tsv")).read().splitlines()[1:]:
            f = line.split("\t")
            out.append("- %s: Signatera blood test, %s" % (f[3], f[6]))
    except (OSError, IndexError):
        pass
    by = {}
    for i in photo_data()["items"]:
        if i.get("t"):
            by[i["t"][:7]] = by.get(i["t"][:7], 0) + 1
    out.append("Photos per month: " + ", ".join("%s: %d" % kv for kv in sorted(by.items())))
    return "\n".join([out[0]] + sorted(out[1:-1]) + [out[-1]])


def photo_context(s, photo):
    if not photo:
        return "No photo on screen yet: the storyteller is choosing what to talk about.", {}
    it = next((i for i in photo_data()["items"] if i["id"] == photo), {})
    lines = ["Photo date: %s (%s)" % ((it.get("t") or "unknown")[:16].replace("T", " "),
                                       "exact, from the camera" if it.get("sure") == "exact" else "date: " + str(it.get("sure") or "unsure")),
             "Chapter: %s" % it.get("chapter", "")]
    if it.get("kind") == "video":
        lines.append("This is a video, %s seconds long." % (it.get("seconds") or "?"))
    if it.get("note"):
        lines.append("Family's note on it: %s" % it["note"])
    if it.get("session"):
        same = [i for i in s["photos"] if i != photo and next((x for x in photo_data()["items"] if x["id"] == i), {}).get("session") == it["session"]]
        if same:
            lines.append("It's part of a series of %d photos from the same moment." % (len(same) + 1))
    nb = nearby(it.get("t") or "")
    if nb:
        lines.append("What the medical records show around then:\n- " + "\n- ".join(nb))
    return "\n".join(lines), it


def parse_reply(text):
    """Claude answers with JSON {say, show?, photos?, next?}; plain text counts as just 'say'."""
    m = re.search(r"\{.*\}", text or "", re.S)
    if m:
        try:
            j = json.loads(m.group(0))
            if isinstance(j, dict) and ("say" in j or "next" in j):
                return j
        except ValueError:
            pass
    t = (text or "").strip().strip('"')
    return {"next": True} if t.upper().startswith("NEXT") else {"say": t}


def date_ok(x):
    return isinstance(x, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", x) is not None


def jump(s, rng, after_take):
    """Put the photos in a date range next in the session and move there. Returns how many were added."""
    a, b = rng.get("from"), rng.get("to") or rng.get("from")
    if not (date_ok(a) and date_ok(b)):
        return 0
    if b < a:
        a, b = b, a
    ids = [i["id"] for i in sorted(photo_data()["items"], key=lambda i: i.get("t") or "") if a <= (i.get("t") or "")[:10] <= b][:40]
    if not ids:
        return 0
    cur = s["photos"][s["pos"]] if s["photos"] else None
    rest = [p for p in s["photos"] if p not in ids]
    at = rest.index(cur) + 1 if cur in rest else (rest.index(cur) if cur in rest else min(s["pos"], len(rest)))
    s["photos"] = rest[:at] + ids + rest[at:]
    s["pos"] = at
    if after_take:
        after_take["led_to"] = ids[0]   # what she said that led here goes with these photos' stories
    return len(ids)


def ask(b):
    """After a take (or at a new photo): Claude's next spoken line. Claude may also choose records to show
    (show: {what, from, to}) and photos to jump to (photos: {from, to}). Returns {question, audio, kind, show?, session?, next?}"""
    sid, photo = str(b.get("id")), str(b.get("photo") or "")
    s = load(sid)
    if photo and photo not in s["photos"]:
        raise ValueError("photo not in this session")
    takes = [t for t in s["takes"] if t["photo"] == photo]
    asked = [q for q in s["questions"] if q["photo"] == photo and q.get("kind") == "followup"]
    maxq = int(settings()["maxQuestions"])
    if not takes:   # a new photo (or the start of an Erica-led talk): a short opener, no wait for Claude
        text = OPENERS[s["pos"] % len(OPENERS)] if photo else "What would you like to talk about? Tell me about a day, a moment, anything."
        return {"question": text, "audio": "cache/" + cached_line(text), "kind": "opener"}
    last = takes[-1]
    words = re.sub(r"[^a-z ]", "", (last.get("text") or "").lower()).strip()
    if photo and words in ("next", "next photo", "next one", "skip", "skip this one", "skip it", "lets move on", "move on"):
        return {"next": True, "kind": "command", "said": words}
    if last.get("error") and not (last.get("text") or "").strip():   # it failed before (e.g. Dictation was off): try the saved recording again
        r = transcribe(path(sid, "takes", last["file"]))
        with lock:
            s = load(sid)
            t = next(x for x in s["takes"] if x["n"] == last["n"])
            t["text"], t["segments"] = r.get("text"), r.get("segments")
            if r.get("error"):
                t["error"] = r["error"]
            else:
                t.pop("error", None)
            save(s)
        last = t
        takes = [x for x in s["takes"] if x["photo"] == photo]
    if not (last.get("text") or "").strip():
        if last.get("error"):
            return {"question": "", "error": last["error"], "kind": "error"}
        text = "I didn't catch that. Could you say it again?"
        return {"question": text, "audio": "cache/" + cached_line(text), "kind": "repeat"}
    ctx, it = photo_context(s, photo)
    who = teller_of(s)
    convo = []
    qs = {q["n"]: q for q in s["questions"]}
    for t in [t for t in s["takes"] if t["photo"] == photo or (not t["photo"] and t.get("led_to") == photo)]:
        if t.get("question") and t["question"] in qs:
            q = qs[t["question"]]
            if q.get("recap"):
                convo.append("Claude (recap): " + q["recap"])
            convo.append("Claude: " + q["text"])
        if t.get("correction"):
            convo.append("[%s said the recap was wrong, and corrects it:]" % who)
        convo.append(who + ": " + (t.get("text") or "(nothing heard)"))
    limit = ("This photo has had %d follow-up questions; at most %d, so if this is the last one, set next instead." % (len(asked), maxq)
             if photo else "No photo yet: help her find the moment.")
    prompt = ("[Storyteller: %s]\n[%s]\n%s\n\n[%s]\n\n[The conversation so far]\n%s\n\n[%s]"
              % (teller_line(who), "Photo %d of %d in this sitting" % (s["pos"] + 1, len(s["photos"])) if photo else "The storyteller leads",
                 ctx, overview(), "\n".join(convo), limit))
    image = None
    if photo:
        image = os.path.join(PHOTOS, "web", photo + ".jpg") if it.get("kind") == "photo" else os.path.join(PHOTOS, "thumb", photo + ".jpg")
    r = claude(prompt, s.get("claude"), image)
    j = parse_reply(r.get("text"))
    text = str(j.get("say") or "").strip()
    recap = str(j.get("recap") or "").strip()
    show = j.get("show") if isinstance(j.get("show"), dict) else None
    if show and not (str(show.get("what", "")).split(":")[0] in TOPICS and date_ok(show.get("from")) and date_ok(show.get("to") or show.get("from"))):
        show = None
    out = {"kind": "followup"}
    with lock:
        s = load(sid)
        if r.get("sessionId"):
            s["claude"] = r["sessionId"]
        if isinstance(j.get("photos"), dict):
            t = next((x for x in s["takes"] if x["n"] == last["n"]), None)
            n_added = jump(s, j["photos"], t if t is not None and not photo else None)
            if n_added:
                out.update(session=s, jumped=n_added)
                log(sid, {"ev": "jump", "from": j["photos"].get("from"), "to": j["photos"].get("to"), "photos": n_added})
        if (j.get("next") and photo and "session" not in out) or (not text and photo):
            save(s)
            text = "Thank you. Let's look at the next one."
            return dict(out, question=text, recap=recap, audio="cache/" + cached_line(text), next=True, kind="closing", show=show)
        if not text:
            text = "Tell me more."
        n = len(s["questions"]) + 1
        name = "%03d.m4a" % n
        s["questions"].append({"n": n, "photo": photo, "text": text, "recap": recap, "file": name, "at": now(), "kind": "followup",
                               "seconds": r.get("seconds"), "show": show})
        save(s)
        if "session" in out:
            out["session"] = s
    speak((recap + " ... " + text) if recap else text, path(sid, "questions", name))   # the recap is said first
    log(sid, {"ev": "question", "n": n, "photo": photo, "text": text, "recap": recap, "show": show})
    return dict(out, question=text, recap=recap, audio="%s/questions/%s" % (sid, name), n=n, show=show)


def drafts(b):
    """End of the sitting: Claude drafts a title and caption for each photo she talked about, from her own words."""
    sid = str(b.get("id"))
    s = load(sid)
    todo = [p for p in s["photos"] if any(t["photo"] == p and (t.get("text") or "").strip() for t in s["takes"])
            and (s["drafts"].get(p) or {}).get("status") not in ("approved",)
            and not (s["drafts"].get(p) or {}).get("caption")]
    if todo:
        qs = {q["n"]: q for q in s["questions"]}
        parts = []
        for p in todo:
            lines = []
            for t in [t for t in s["takes"] if t["photo"] == p or (not t["photo"] and t.get("led_to") == p)]:
                if t.get("question") in qs:
                    lines.append("Claude: " + qs[t["question"]]["text"])
                lines.append(teller_of(s) + ": " + (t.get("text") or ""))
            parts.append("PHOTO %s\n%s" % (p, "\n".join(lines)))
        prompt = ("[End of the sitting. The storyteller was %s. For each photo below, write a short title (at most 8 words, sentence case) "
                  "and a caption of 1 to 4 sentences in %s's own first-person words: take their sentences, drop filler (um, like, you know), "
                  "and do not add facts, feelings or names they didn't say. Reply with JSON only: " % (teller_of(s), teller_of(s)) +
                  '{"<photo id>": {"title": "...", "caption": "..."}, ...}]\n\n' + "\n\n".join(parts))
        r = claude(prompt, s.get("claude"), None, timeout=240)
        m = re.search(r"\{.*\}", r.get("text") or "", re.S)
        got = {}
        try:
            got = json.loads(m.group(0)) if m else {}
        except ValueError:
            pass
        with lock:
            s = load(sid)
            if r.get("sessionId"):
                s["claude"] = r["sessionId"]
            for p in todo:
                g = got.get(p) or {}
                s["drafts"][p] = {"title": str(g.get("title") or "")[:120], "caption": str(g.get("caption") or "")[:3000],
                                  "status": "draft", "audience": "everyone"}
            save(s)
    return {"session": load(sid)}


def approve(b):
    """Save one photo's story to the gallery (or keep it for later)."""
    sid, photo = str(b.get("id")), str(b.get("photo"))
    with lock:
        s = load(sid)
        if photo not in s["photos"]:
            raise ValueError("photo not in this session")
        d = s["drafts"].setdefault(photo, {})
        d.update({"title": str(b.get("title") or d.get("title") or "")[:120],
                  "caption": str(b.get("caption") or d.get("caption") or "")[:3000],
                  "audience": "family" if b.get("audience") == "family" else "everyone"})
        if b.get("status") in ("later", "draft"):   # keep for later, or just save the text without approving
            d["status"] = "later" if b["status"] == "later" else (d.get("status") if d.get("status") not in (None, "approved") else "draft")
            save(s)
            return {"session": s}
        qs = {q["n"]: q for q in s["questions"]}
        turns = []
        for t in [t for t in s["takes"] if t["photo"] == photo or (not t["photo"] and t.get("led_to") == photo)]:
            if t.get("question") in qs:
                turns.append({"who": "Claude", "text": qs[t["question"]]["text"]})
            words = (d.get("turn_text") or {}).get(str(t["n"]), t.get("text") or "")
            if words.strip():
                turns.append({"who": teller_of(s), "text": words, "audio": "%s/takes/%s" % (sid, t["file"])})
        story = {"title": d["title"], "caption": d["caption"], "told": time.strftime("%-m/%-d/%Y"),
                 "family_only": d["audience"] == "family", "session": sid, "turns": turns, "teller": teller_of(s),
                 "links": d.get("links") or [], "photos": d.get("photos") or []}
        os.makedirs(STORIES, exist_ok=True)
        f = os.path.join(STORIES, photo + ".json")
        try:
            cur = json.load(open(f))
        except (OSError, ValueError):
            cur = {"stories": []}
        cur["stories"] = [x for x in cur.get("stories", []) if x.get("session") != sid] + [story]
        tmp = f + ".tmp"
        json.dump(cur, open(tmp, "w"), indent=1, ensure_ascii=False)
        os.replace(tmp, f)
        d["status"] = "approved"
        d["approved"] = now()
        save(s)
    log(sid, {"ev": "approved", "photo": photo, "audience": d["audience"]})
    return {"session": s}


def markers_csv(sid):
    """The session log as markers for video editing: laptop clock time, event, photo, words."""
    load(sid)
    rows = ["clock,event,photo,text"]
    for line in open(path(sid, "log.jsonl")):
        try:
            e = json.loads(line)
        except ValueError:
            continue
        c = e.get("client") or (e.get("server") or "").replace("T", " ")
        if isinstance(c, (int, float)):
            c = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(c / 1000)) + ".%03d" % (c % 1000)
        q = lambda x: '"' + str(x or "").replace('"', '""') + '"'
        rows.append(",".join([q(c), q(e.get("ev")), q(e.get("photo")), q(e.get("text"))]))
    return ("\n".join(rows) + "\n").encode()


def audio_file(rel):
    """local/story/sessions/<sid>/(takes|questions)/NNN.(wav|m4a) or voice_cache/<name>.m4a, or None."""
    m = re.fullmatch(r"(s-\d{8}-\d{6}-[a-z0-9]{4})/(takes|questions)/(\d{3}\.(?:wav|m4a))", rel)
    if m:
        f = path(m.group(1), m.group(2), m.group(3))
    else:
        m = re.fullmatch(r"cache/([a-z0-9\-]{1,100}\.m4a)", rel)
        f = os.path.join(BASE, "voice_cache", m.group(1)) if m else None
        if rel.split("?")[0] == "check/practice.m4a":
            f = os.path.join(BASE, "check", "practice.m4a")
    return f if f and os.path.isfile(f) else None


# ---------------- ready check: is everything on the home Mac set up? ----------------
FIX_DICTATION = "On the home Mac: System Settings > Keyboard > Dictation > turn it on (choose English). Then run the check again."
FIX_SPEECH = "On the home Mac: System Settings > Privacy & Security > Speech Recognition > turn on Story Transcribe."


# System Settings panes on the home Mac that fix a check (opened there by POST /story/api/open-setting; opening a pane
# changes nothing by itself: the person still flips the switch).
SETTINGS = {
    "dictation": ("x-apple.systempreferences:com.apple.Keyboard-Settings.extension", "Open Keyboard settings (Dictation is near the bottom)"),
    "speech": ("x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition", "Open Privacy settings: Speech Recognition"),
    "voices": ("x-apple.systempreferences:com.apple.preference.universalaccess?SpeakableItems", "Open Accessibility settings: Spoken Content"),
    "storage": ("x-apple.systempreferences:com.apple.settings.Storage", "Open Storage settings"),
}


def open_setting(b):
    """Open a System Settings pane on the home Mac's screen."""
    key = str(b.get("key"))
    if key not in SETTINGS:
        raise ValueError("unknown setting")
    subprocess.run(["open", SETTINGS[key][0]], timeout=20, check=True)
    return {"opened": key, "where": "home Mac"}


def check_dir():
    d = os.path.join(BASE, "check")
    os.makedirs(d, exist_ok=True)
    return d


def sample_wav():
    """A short spoken sentence (the Mac's own voice), to test speech to text without anyone talking."""
    f = os.path.join(check_dir(), "sample.wav")
    if not os.path.exists(f):
        aiff = f[:-4] + ".aiff"
        subprocess.run(["say", "-o", aiff, "Testing the story page, one two three."], check=True, timeout=60)
        subprocess.run(["afconvert", "-f", "WAVE", "-d", "LEI16@48000", "-c", "1", aiff, f], check=True, timeout=60)
        os.remove(aiff)
    return f


def health():
    """Checks of the home Mac's side, each {key, label, ok (True/False/None = a warning), detail, fix}."""
    out = []
    add = lambda key, label, ok, detail="", fix="": out.append({"key": key, "label": label, "ok": ok, "detail": detail, "fix": fix})
    # the drive with the photos and recordings
    try:
        os.makedirs(SESS, exist_ok=True)
        probe = os.path.join(SESS, ".write-test")
        open(probe, "w").write("ok"); os.remove(probe)
        free = __import__("shutil").disk_usage(SESS).free / 1e9
        add("drive", "Drive for recordings", free > 2, "%.0f GB free on the drive that keeps the recordings" % free,
            "" if free > 2 else "Free some space on the drive (an hour of recording needs about 1 GB).")
    except OSError as e:
        add("drive", "Drive for recordings", False, "can't write recordings: %s" % e, "Check that the external drive (ssd70) is plugged in and mounted.")
    n = len(photo_data()["items"])
    add("photos", "Photos", n > 0, "%d photos and videos ready" % n, "" if n else "The photo copies are missing: run local/photos/build_web.py.")
    # speech to text, end to end, on a sample sentence
    t0 = time.time()
    try:
        r = transcribe(sample_wav())
    except (OSError, subprocess.SubprocessError) as e:
        r = {"error": str(e)}
    secs = round(time.time() - t0, 1)
    if r.get("error"):
        e = r["error"]
        fix = FIX_DICTATION if "Dictation" in e else FIX_SPEECH if "permission" in e.lower() else "See the error; rebuild with story/build_transcribe.sh if the app is missing."
        add("speech", "Speech to text (on the home Mac)", False, e, fix)
    else:
        heard = (r.get("text") or "").strip()
        ok = "test" in heard.lower()
        add("speech", "Speech to text (on the home Mac)", ok, 'heard "%s" in %s s' % (heard, secs),
            "" if ok else "It ran but didn't hear the test sentence; try again, and check Dictation's language is English.")
    # Claude's voice
    try:
        cached_line(LINES["hello"])
        v = voice_name() or "the Mac's default voice"
        premium = "(Premium)" in v or "(Enhanced)" in v
        add("voice", "Claude's voice", True if premium else None, "speaking with %s" % v,
            "" if premium else "Works. For a more natural voice, download a Premium voice on the home Mac (System Settings > Accessibility > Spoken Content > System voice > Manage Voices) and put its name in local/story/settings.json.")
    except (OSError, subprocess.SubprocessError) as e:
        add("voice", "Claude's voice", False, str(e), "The Mac's 'say' command failed; restart the Mac if this persists.")
    # Claude itself, through the chat server
    t0 = time.time()
    try:
        urllib.request.urlopen(chat_server() + "/api/quick-asks", timeout=5).read()
        add("claude", "Claude (the chat server)", True, "running (answered in %.1f s)" % (time.time() - t0))
    except OSError as e:
        add("claude", "Claude (the chat server)", False, "not answering: %s" % e,
            "Start it on the home Mac: cd /Volumes/ssd70/Cancer && env -u CLAUDECODE python3 -I chat/serve_chat.py")
    # the secure address's certificate
    cert = os.path.join(LOCAL, "tls", "cert.pem")
    if os.path.exists(cert):
        try:
            end = subprocess.run(["openssl", "x509", "-enddate", "-noout", "-in", cert], capture_output=True, text=True, timeout=10).stdout.strip().split("=", 1)[-1]
            days = (datetime.datetime.strptime(end, "%b %d %H:%M:%S %Y %Z") - datetime.datetime.utcnow()).days
            add("cert", "Secure address (for the microphone)", days > 14, "certificate good for %d more days" % days,
                "" if days > 14 else "Make a new one: python3 serve_viewer.py --make-cert, then restart the viewer.")
        except (OSError, ValueError, subprocess.SubprocessError):
            add("cert", "Secure address (for the microphone)", None, "couldn't read the certificate's date")
    else:
        add("cert", "Secure address (for the microphone)", False, "no certificate", "python3 serve_viewer.py --make-cert, then restart the viewer with --https-port 8767.")
    # how to fix each one that isn't a green check: open the right System Settings pane, or copy the command to run
    cmds = {"claude": "cd /Volumes/ssd70/Cancer && env -u CLAUDECODE python3 -I chat/serve_chat.py",
            "cert": "cd /Volumes/ssd70/Cancer/open-health-data && python3 serve_viewer.py --make-cert",
            "photos": "cd /Volumes/ssd70/Cancer/open-health-data/local/photos && python3 -I build_web.py"}
    for c in out:
        if c["ok"] is True:
            continue
        k = c["key"]
        if k == "speech":
            sk = "dictation" if "Dictation" in c["detail"] else "speech"
            c["action"] = {"type": "open", "key": sk, "label": SETTINGS[sk][1]}
        elif k == "voice":
            c["action"] = {"type": "open", "key": "voices", "label": SETTINGS["voices"][1]}
        elif k == "drive" and "free" in c["detail"]:
            c["action"] = {"type": "open", "key": "storage", "label": SETTINGS["storage"][1]}
        elif k in cmds:
            c["action"] = {"type": "copy", "text": cmds[k], "label": "Copy the command to run on the home Mac"}
    return {"checks": out, "ok": all(c["ok"] is not False for c in out), "at": now()}


def practice(data, rate):
    """A practice run: her test sentence -> text -> Claude's recap and question, spoken. Nothing is kept in any session."""
    if data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise ValueError("not a WAV recording")
    d = check_dir()
    f = os.path.join(d, "practice.wav")
    open(f, "wb").write(data)
    timing = {"seconds": round((len(data) - 44) / 2 / max(1, int(rate or 48000)), 1)}
    t0 = time.time()
    r = transcribe(f)
    timing["speech"] = round(time.time() - t0, 1)
    if r.get("error"):
        k = "dictation" if "Dictation" in r["error"] else "speech"
        return {"error": r["error"], "fix": FIX_DICTATION if k == "dictation" else FIX_SPEECH, "timing": timing,
                "action": {"type": "open", "key": k, "label": SETTINGS[k][1]}}
    text = (r.get("text") or "").strip()
    if not text:
        return {"text": "", "error": "no words heard", "fix": "Check the microphone is the right one and close enough, then try again.", "timing": timing}
    t0 = time.time()
    try:
        c = claude("[This is a practice run of the story page, to check everything works. Someone said the sentence below. "
                   "Recap it and ask one short, light question back, as you would in a real session.]\nStoryteller: " + text)
        j = parse_reply(c.get("text"))
    except OSError as e:
        return {"text": text, "error": "Claude didn't answer: %s" % e, "fix": "Start the chat server on the home Mac.", "timing": timing}
    timing["claude"] = round(time.time() - t0, 1)
    say = str(j.get("say") or "").strip() or "That worked."
    recap = str(j.get("recap") or "").strip()
    t0 = time.time()
    speak((recap + " ... " + say) if recap else say, os.path.join(d, "practice.m4a"))
    timing["voice"] = round(time.time() - t0, 1)
    return {"text": text, "recap": recap, "question": say, "audio": "check/practice.m4a?t=%d" % time.time(), "timing": timing}


# ---------------- your stories: list, edit, delete ----------------
def read_stories(photo):
    f = os.path.join(STORIES, photo + ".json")
    try:
        return json.load(open(f))
    except (OSError, ValueError):
        return {"stories": []}


def write_stories(photo, cur):
    os.makedirs(STORIES, exist_ok=True)
    f = os.path.join(STORIES, photo + ".json")
    if os.path.exists(f):   # keep the previous version
        __import__("shutil").copy2(f, os.path.join(check_dir(), "last-" + photo + ".json"))
    if not cur.get("stories"):
        if os.path.exists(f):
            os.remove(f)
        return
    tmp = f + ".tmp"
    json.dump(cur, open(tmp, "w"), indent=1, ensure_ascii=False)
    os.replace(tmp, f)


def stories_list():
    """Every saved story (what the gallery shows), newest first, plus drafts still waiting in sessions."""
    out = []
    for f in sorted(os.listdir(STORIES)) if os.path.isdir(STORIES) else []:
        if not f.endswith(".json"):
            continue
        p = f[:-5]
        for i, st in enumerate(read_stories(p).get("stories", [])):
            out.append({"photo": p, "index": i, "teller": st.get("teller") or "Erica", "title": st.get("title"), "caption": st.get("caption") or st.get("text"),
                        "family_only": bool(st.get("family_only")), "told": st.get("told"), "session": st.get("session"),
                        "turns": len(st.get("turns") or []), "links": len(st.get("links") or []), "photos": len(st.get("photos") or [])})
    drafts = []
    for sm in sessions():
        try:
            s = load(sm["id"])
        except (KeyError, OSError, ValueError):
            continue
        for p in s["photos"]:
            d = s["drafts"].get(p) or {}
            talked = any((t["photo"] == p or t.get("led_to") == p) and (t.get("text") or "").strip() for t in s["takes"])
            if talked and d.get("status") != "approved":
                drafts.append({"session": s["id"], "sessionTitle": s["title"], "teller": teller_of(s), "photo": p, "title": d.get("title"),
                               "caption": d.get("caption"), "status": d.get("status") or "not reviewed"})
    return {"stories": sorted(out, key=lambda x: x.get("told") or "", reverse=True), "drafts": drafts}


def clean_links(links):
    out = []
    for l in (links or [])[:30]:
        url, label = str((l or {}).get("url") or "").strip(), str((l or {}).get("label") or "").strip()[:120]
        if re.match(r"^(https?://|/)[^\s<>\"']{1,1000}$", url):
            out.append({"label": label or url, "url": url})
    return out


def clean_photos(ids, main):
    known = {i["id"] for i in photo_data()["items"]}
    return [p for p in dict.fromkeys(str(x) for x in (ids or [])) if p in known and p != main][:40]


def story_get(photo, index=None, sid=None):
    """One story to edit: a saved one (photo + index) or a session's draft (sid + photo), with its turns."""
    if sid:
        s = load(sid)
        d = s["drafts"].get(photo) or {}
        qs = {q["n"]: q for q in s["questions"]}
        turns = []
        for t in [t for t in s["takes"] if t["photo"] == photo or (not t["photo"] and t.get("led_to") == photo)]:
            if t.get("question") in qs:
                turns.append({"who": "Claude", "text": qs[t["question"]]["text"]})
            turns.append({"who": teller_of(s), "text": (d.get("turn_text") or {}).get(str(t["n"]), t.get("text") or ""),
                          "audio": "%s/takes/%s" % (sid, t["file"]), "n": t["n"]})
        return {"kind": "draft", "session": sid, "photo": photo, "teller": teller_of(s), "title": d.get("title", ""), "caption": d.get("caption", ""),
                "family_only": d.get("audience") == "family", "turns": turns, "links": d.get("links") or [],
                "photos": d.get("photos") or [], "status": d.get("status") or "draft"}
    st = read_stories(photo)["stories"][int(index)]
    return dict(st, kind="story", photo=photo, index=int(index), links=st.get("links") or [], photos=st.get("photos") or [],
                teller=st.get("teller") or "Erica")


def story_save(b):
    """Save an edit: title, caption, who sees it, fixed words in her answers, links, extra photos."""
    photo = str(b.get("photo"))
    if not PID.match(photo):
        raise ValueError("bad photo")
    links, photos = clean_links(b.get("links")), clean_photos(b.get("photos"), photo)
    texts = [str(x)[:20000] for x in (b.get("turnTexts") or [])]
    if b.get("kind") == "draft":
        sid = str(b.get("session"))
        with lock:
            s = load(sid)
            d = s["drafts"].setdefault(photo, {"status": "draft"})
            d.update(title=str(b.get("title") or "")[:120], caption=str(b.get("caption") or "")[:3000],
                     audience="family" if b.get("family_only") else "everyone", links=links, photos=photos)
            ns = [t["n"] for t in s["takes"] if t["photo"] == photo or (not t["photo"] and t.get("led_to") == photo)]
            if len(texts) == len(ns):
                d["turn_text"] = {str(n): x for n, x in zip(ns, texts)}
            save(s)
        log(sid, {"ev": "draft edited", "photo": photo})
        return story_get(photo, sid=sid)
    with lock:
        cur = read_stories(photo)
        i = int(b.get("index"))
        st = cur["stories"][i]
        st.update(title=str(b.get("title") or "")[:120], caption=str(b.get("caption") or "")[:3000],
                  family_only=bool(b.get("family_only")), links=links, photos=photos, edited=now())
        er = [t for t in st.get("turns") or [] if t.get("who") != "Claude"]
        if len(texts) == len(er):
            for t, x in zip(er, texts):
                t["text"] = x
        write_stories(photo, cur)
    return story_get(photo, i)


def story_delete(b):
    """Take a saved story off the gallery. It is kept in local/story/check/deleted-stories.jsonl, and its recordings stay."""
    photo, i = str(b.get("photo")), int(b.get("index"))
    with lock:
        cur = read_stories(photo)
        st = cur["stories"].pop(i)
        with open(os.path.join(check_dir(), "deleted-stories.jsonl"), "a") as f:
            f.write(json.dumps({"photo": photo, "deleted": now(), "story": st}, ensure_ascii=False) + "\n")
        write_stories(photo, cur)
        if st.get("session"):   # its draft goes back to 'to review' in its session
            try:
                s = load(st["session"])
                if photo in s["drafts"]:
                    s["drafts"][photo]["status"] = "draft"
                    save(s)
            except (KeyError, OSError, ValueError):
                pass
    return {"ok": True}
