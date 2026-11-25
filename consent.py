"""Recipient copies of the patient's consent to share her health information (the /consent page).

A visitor types their name, role, institution and email; the server fills those into the private Recipient Copy
template, turns it into a PDF (html2pdf.swift, WebKit, compiled once into local/consent/bin/) and keeps it under a
random id, so the visitor can download it, email themselves a link to it, or pass the link to a colleague.
Every copy made is listed in local/consent/issued.jsonl (who, when, from where), which only this Mac and the home
network can read (GET /consent/api/issued).

Everything personal lives in local/consent/ (never committed):
  settings.json            {"patient": "...", "signedOn": "" (empty = not signed yet), "version": "1",
                            "germlineOpen": false, "contact": "...", "publicBase": "http://..."}
  recipient_template.html  the Recipient Copy with {{name}} {{role}} {{institution}} {{email}} {{date}} {{germline}}
                           {{signed_on}} {{status_url}} {{copy_url}} {{copy_id}} {{banner}} {{issued_by}} placeholders
  consent.pdf              the consent itself (the draft until a scan of the signed form replaces it)
  issued/<id>.pdf          the copies made; issued.jsonl the list
Without settings.json the page answers 404, so the feature stays off until it is set up.
Python standard library only.
"""
import datetime
import html
import json
import os
import re
import secrets
import subprocess
import threading
import time

AT = "/consent"
FIELDS = ("name", "role", "institution", "email")
MAXLEN = 120
OUTSIDE_PER_HOUR = 20      # copies one outside address may make per hour (home: no limit)
_lock = threading.Lock()
_tries = {}                # address -> times of copies made in the last hour


class Consent:
    def __init__(self, local, here):
        self.dir = os.path.join(local, "consent")
        self.here = here
        self.issued_dir = os.path.join(self.dir, "issued")
        self.log = os.path.join(self.dir, "issued.jsonl")
        self.template = os.path.join(self.dir, "recipient_template.html")
        self.master = os.path.join(self.dir, "consent.pdf")
        self.page = os.path.join(here, "consent_view.html")
        self.swift = os.path.join(here, "html2pdf.swift")
        self.binary = os.path.join(self.dir, "bin", "html2pdf")

    def settings(self):
        try:
            s = json.load(open(os.path.join(self.dir, "settings.json")))
            return s if isinstance(s, dict) else None
        except (OSError, ValueError):
            return None

    def ready(self):
        return self.settings() is not None and os.path.isfile(self.template)

    def public(self, s):
        """What the page may show about the consent (no list of recipients)."""
        return {"patient": s.get("patient", ""), "signedOn": s.get("signedOn", ""), "version": str(s.get("version", "")),
                "germlineOpen": bool(s.get("germlineOpen")), "contact": s.get("contact", ""),
                "hasConsentPdf": os.path.isfile(self.master)}

    # ---- making a copy ----
    def clean(self, body):
        out = {}
        for k in FIELDS:
            v = body.get(k, "")
            if not isinstance(v, str):
                raise ValueError(k + " must be text")
            v = re.sub(r"\s+", " ", v).strip()
            if len(v) > MAXLEN:
                raise ValueError(k + " is too long")
            out[k] = v
        if not out["name"] and not out["institution"]:
            raise ValueError("Please give your name or your institution.")
        if out["email"] and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", out["email"]):
            raise ValueError("That email address doesn't look right.")
        return out

    def allowed(self, ip, home):
        if home:
            return True
        now = time.time()
        with _lock:
            t = [x for x in _tries.get(ip, []) if now - x < 3600]
            if len(t) >= OUTSIDE_PER_HOUR:
                _tries[ip] = t
                return False
            t.append(now)
            _tries[ip] = t
        return True

    def pdf_tool(self):
        """The compiled html2pdf (made once from html2pdf.swift, again when the source is newer)."""
        if not (os.path.isfile(self.binary) and os.path.getmtime(self.binary) >= os.path.getmtime(self.swift)):
            os.makedirs(os.path.dirname(self.binary), exist_ok=True)
            subprocess.run(["swiftc", "-O", self.swift, "-o", self.binary], check=True, capture_output=True, timeout=600)
        return self.binary

    def issue(self, f, ip, home, base):
        s = self.settings() or {}
        cid = secrets.token_urlsafe(12)
        copy_url = base + AT + "/copy/" + cid + ".pdf"
        signed = s.get("signedOn", "")
        e = lambda v: html.escape(v or "")
        banner = "" if signed else ('<div style="border:2px solid #b00000;color:#b00000;padding:6px 10px;margin:6px 0;'
                                    'font-weight:bold">Not signed yet: this shows what the permission will say. It gives no '
                                    'permission until the consent is signed.</div>')
        box = '<span class="box" style="text-align:center;line-height:13px;font-size:11px">%s</span>'
        vals = {"name": e(f["name"]), "role": e(f["role"]), "institution": e(f["institution"]), "email": e(f["email"]),
                "date": datetime.date.today().strftime("%m/%d/%Y"), "germline": box % ("✓" if s.get("germlineOpen") else ""),
                "signed_on": e(signed or "not signed yet"), "status_url": e(base + AT), "copy_url": e(copy_url),
                "copy_id": cid, "banner": banner, "issued_by": e(s.get("issuedBy", "the records website"))}
        doc = open(self.template, encoding="utf-8").read()
        for k, v in vals.items():
            doc = doc.replace("{{" + k + "}}", v)
        os.makedirs(self.issued_dir, exist_ok=True)
        tmp = os.path.join(self.issued_dir, cid + ".html")
        out = os.path.join(self.issued_dir, cid + ".pdf")
        open(tmp, "w", encoding="utf-8").write(doc)
        try:
            with _lock:   # one WebKit render at a time
                subprocess.run([self.pdf_tool(), tmp, out], check=True, capture_output=True, timeout=120)
        finally:
            os.remove(tmp)
        rec = dict(f, id=cid, at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), ip=ip, home=home,
                   version=str(s.get("version", "")), signedOn=signed, germline=bool(s.get("germlineOpen")))
        with _lock:
            with open(self.log, "a") as fh:
                fh.write(json.dumps(rec) + "\n")
        return {"id": cid, "url": AT + "/copy/" + cid + ".pdf", "fullUrl": copy_url}

    def issued(self):
        out = []
        try:
            for line in open(self.log):
                try:
                    out.append(json.loads(line))
                except ValueError:
                    pass
        except OSError:
            pass
        return out[::-1]

    def copy_file(self, cid):
        if not re.fullmatch(r"[A-Za-z0-9_-]{16}", cid or ""):
            return None
        f = os.path.join(self.issued_dir, cid + ".pdf")
        return f if os.path.isfile(f) else None


def handle_get(h, sub, c, home):
    """GET /consent..., sub = the part after /consent. h is the viewer's request handler."""
    s = c.settings()
    if s is None or not c.ready():
        return h.send(404, {"error": "not found"})
    if sub in ("", "/"):
        return h.send(200, open(c.page, "rb").read(), "text/html; charset=utf-8")
    if sub == "/api/info":
        return h.send(200, dict(c.public(s), home=home))
    if sub == "/consent.pdf":
        if not os.path.isfile(c.master):
            return h.send(404, {"error": "not found"})
        return h.send(200, open(c.master, "rb").read(), "application/pdf",
                      headers=[("Content-Disposition", 'inline; filename="consent.pdf"')])
    m = re.fullmatch(r"/copy/([A-Za-z0-9_-]+)\.pdf", sub)
    if m:
        f = c.copy_file(m.group(1))
        if not f:
            return h.send(404, {"error": "not found"})
        return h.send(200, open(f, "rb").read(), "application/pdf",
                      headers=[("Content-Disposition", 'inline; filename="recipient_copy.pdf"')])
    if sub == "/api/issued":
        if not home:
            return h.send(404, {"error": "not found"})
        return h.send(200, {"issued": c.issued()})
    return h.send(404, {"error": "not found"})


def handle_post(h, sub, c, home, ip, base):
    if c.settings() is None or not c.ready() or sub != "/api/issue":
        return h.send(404, {"error": "not found"})
    n = int(h.headers.get("Content-Length") or 0)
    if n <= 0 or n > 4000:
        return h.send(400, {"error": "bad request"})
    try:
        body = json.loads(h.rfile.read(n))
        if not isinstance(body, dict):
            raise ValueError("bad request")
        f = c.clean(body)
    except ValueError as e:
        return h.send(400, {"error": str(e)})
    if not c.allowed(ip, home):
        return h.send(429, {"error": "Too many copies from this address in the last hour. Please try again later."})
    try:
        return h.send(200, c.issue(f, ip, home, base))
    except Exception as e:  # noqa: BLE001 - the PDF tool failed: say so, keep the server up
        print(time.strftime("%H:%M:%S"), "consent copy failed:", e)
        return h.send(500, {"error": "The copy could not be made just now. Please try again, or contact the family."})
