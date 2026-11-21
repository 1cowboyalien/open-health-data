"""Optic radiations for the phone start screen, traced on each of her diffusion MRIs (DTI), plus the optic tracts (drawn).

    imaging/.venv/bin/python -I make_phone_tracts.py <volumetry dir> <date>=<dti_files.txt> [<date>=<files> ...] [--model local/phone/model.json]

<date>=<dti_files.txt>: one DICOM file per line, every image of one raw "Ax DTI" series from that date. Siemens keeps the b-value in
(0019,100c) and the direction in (0019,100e) (patient coordinates); GE keeps the b-value in (0043,1039)[0] and the direction in
(0019,10bb/bc/bd). <volumetry dir>/<date>/to_baseline.tfm is the rigid alignment of that session to the reference scan (baseline point ->
session point); the DTI was taken in the same session, so it shares it.

For each date:
1. Fit a diffusion tensor in each voxel (log-linear least squares; repeats of a direction averaged): FA and the main fibre direction.
2. The frame of the stored directions differs between makers, so the fit is tried with each axis flipped (none, x, y, z; with --swaps
   also every order of the axes) and the one
   giving the longest fibres on a sample of seeds is kept (a wrong frame breaks fibres up; the standard check). The scores are printed.
3. Track fibres (0.8 mm steps; stop at FA < 0.15 or a bend > 45° in one step) from white matter in the back half of the brain, both ways,
   and keep those from near the lateral geniculate nucleus (LGN: 23 mm to the side of and 20 mm behind the optic chiasm that
   make_phone_model.py found at the end of the traced optic nerves) to the back 40 mm of the brain: the optic radiations.
The optic tracts (chiasm -> LGN) are too thin for 5 mm DTI slices, so they are drawn as a smooth curve.
Output local/phone/tracts.json (RAS mm, reference space), also added to model.json as "visual":
  {"by_date": {date: {"radiations": [{"side", "p"}], "n": {"L", "R"}, "flip", "maker"}}, "tracts": [...], "lgn", "chiasm"}
Private (built from her scans): stays in local/.
"""
import json, pathlib, sys
from collections import defaultdict
import numpy as np, pydicom, SimpleITK as sitk
from scipy import ndimage as ndi
from skimage.filters import threshold_otsu

args = [a for a in sys.argv[1:] if not a.startswith("--")]
VOL = pathlib.Path(args[0])
JOBS = [a.split("=", 1) for a in args[1:]]
MODEL = pathlib.Path(sys.argv[sys.argv.index("--model") + 1]) if "--model" in sys.argv else pathlib.Path(__file__).parent / "local" / "phone" / "model.json"
OUT = MODEL.parent / "tracts.json"

M = json.load(open(MODEL))
ends = [np.array(n["p"]).reshape(-1, 3)[-1] for n in M.get("nerves", [])]
assert len(ends) == 2, "needs the two optic nerves from make_phone_model.py"
CH = np.mean(ends, 0)   # optic chiasm (RAS)
LGN = {"L": CH + [-23, -20, 2], "R": CH + [23, -20, 2]}   # RAS: x+ = right, y+ = front
yback = np.array(M["brain"]["v"]).reshape(-1, 3)[:, 1].min()


def read(files):
    """-> S (n, z, y, x), b-values, directions, geometry"""
    vols = defaultdict(dict); geo = None; maker = ""
    for f in files:
        x = pydicom.dcmread(f)
        if (0x19, 0x100c) in x:   # Siemens
            b = float(x[0x19, 0x100c].value)
            g = [float(v) for v in x[0x19, 0x100e].value] if (0x19, 0x100e) in x and b > 0 else [0, 0, 0]
        elif (0x43, 0x1039) in x:   # GE
            b = float(x[0x43, 0x1039].value[0]) % 100000
            g = [float(x[0x19, t].value) for t in (0x10bb, 0x10bc, 0x10bd)] if b > 0 else [0, 0, 0]
        else:
            raise SystemExit(f"no diffusion tags in {f}")
        g = tuple(np.round(g, 3)) if b > 0 else (0.0, 0.0, 0.0)
        z = float(x.ImagePositionPatient[2])
        vols[(b, g)].setdefault(round(z, 1), []).append(x.pixel_array.astype(np.float32))
        if geo is None:
            geo = (np.array([float(v) for v in x.ImagePositionPatient]), [float(v) for v in x.PixelSpacing], [float(v) for v in x.ImageOrientationPatient])
            maker = str(x.Manufacturer).split()[0]
    assert np.allclose(geo[2], [1, 0, 0, 0, 1, 0], atol=2e-2), "expects plain axial DTI (no tilt)"
    zs = sorted(set.intersection(*[set(v) for v in vols.values()]))
    keys = sorted(k for k in vols if k[0] == 0 or k[0] > 400)
    S = np.stack([np.stack([np.mean(vols[k][z], 0) for z in zs]) for k in keys])
    return S, np.array([k[0] for k in keys]), np.array([k[1] for k in keys], float), geo, zs, maker


def fit(S, B, G):
    b0 = S[B == 0].mean(0); mask = ndi.gaussian_filter(b0, 1) > threshold_otsu(b0)   # head only: outside it the fit is noise
    lab, _ = ndi.label(mask); mask = lab == np.argmax(np.bincount(lab.ravel())[1:]) + 1
    mask = ndi.binary_erosion(ndi.binary_fill_holes(mask), iterations=2)
    dw = B > 0
    A = -B[dw, None] * np.stack([G[dw, 0] ** 2, G[dw, 1] ** 2, G[dw, 2] ** 2, 2 * G[dw, 0] * G[dw, 1], 2 * G[dw, 0] * G[dw, 2], 2 * G[dw, 1] * G[dw, 2]], 1)
    y = np.log(np.clip(S[dw], 1, None) / np.clip(b0, 1, None)[None])
    d6 = np.linalg.pinv(A) @ y.reshape(y.shape[0], -1)
    T = np.zeros((d6.shape[1], 3, 3)); T[:, 0, 0], T[:, 1, 1], T[:, 2, 2] = d6[0], d6[1], d6[2]
    T[:, 0, 1] = T[:, 1, 0] = d6[3]; T[:, 0, 2] = T[:, 2, 0] = d6[4]; T[:, 1, 2] = T[:, 2, 1] = d6[5]
    w, v = np.linalg.eigh(T); w = np.clip(w, 0, None)
    md = w.mean(1); fa = np.sqrt(1.5 * ((w - md[:, None]) ** 2).sum(1) / np.maximum((w ** 2).sum(1), 1e-12))
    shape = S.shape[1:]
    return np.where(mask, fa.reshape(shape), 0), v[:, :, 2].reshape(shape + (3,))


def trace(date, files):
    tx = sitk.ReadTransform(str(VOL / date / "to_baseline.tfm")); inv = tx.GetInverse()   # baseline LPS -> session LPS
    S, B, G, geo, zs, maker = read(files)
    dz = float(np.median(np.diff(zs))); dy, dx = geo[1][0], geo[1][1]; shape = S.shape[1:]
    print(f"{date} {maker}: {len(B)} volumes (b = {sorted(set(B.tolist()))}), {shape} voxels, {dx:.2f} x {dy:.2f} x {dz:.1f} mm")
    lps_to_idx = lambda p: np.array([(p[2] - zs[0]) / dz, (p[1] - geo[0][1]) / dy, (p[0] - geo[0][0]) / dx])
    idx_to_lps = lambda i: np.array([geo[0][0] + i[2] * dx, geo[0][1] + i[1] * dy, zs[0] + i[0] * dz])
    ses_to_ras = lambda p: (lambda q: np.array([-q[0], -q[1], q[2]]))(inv.TransformPoint(tuple(float(a) for a in p)))

    def tracker(FA, E1):
        def sample(p, prev):
            i = np.round(lps_to_idx(p)).astype(int)
            if (i < 0).any() or (i >= shape).any() or FA[tuple(i)] < .15: return None
            e = E1[tuple(i)]
            if prev is not None:
                if e @ prev < 0: e = -e
                if e @ prev < np.cos(np.radians(45)): return None
            return e
        def track(seed, d0):
            pts, p, d = [], seed.copy(), d0
            for _ in range(400):
                e = sample(p, d)
                if e is None: break
                d = e if d is None else .7 * e + .3 * d; d /= np.linalg.norm(d); p = p + .8 * d; pts.append(p.copy())
            return pts
        return sample, track

    # which frame are the directions in? keep the flip that gives the longest fibres
    best = None
    rng = np.random.default_rng(0)
    import itertools
    combos = [("".join("xyz"[i] for i in pm) + "/" + n, pm, fl) for pm in itertools.permutations(range(3))
              for n, fl in (("none", [1, 1, 1]), ("x", [-1, 1, 1]), ("y", [1, -1, 1]), ("z", [1, 1, -1]))]
    if "--swaps" not in sys.argv: combos = [c for c in combos if c[1] == (0, 1, 2)]   # axis swaps only when asked (a GE frame that is not just flipped)
    for name, pm, fl in combos:
        FA, E1 = fit(S, B, G[:, list(pm)] * fl)
        sample, track = tracker(FA, E1)
        cand = np.argwhere(FA > .35); cand = cand[rng.choice(len(cand), min(400, len(cand)), replace=False)]
        L = [len(track(idx_to_lps(i), e)) + len(track(idx_to_lps(i), -e)) for i in cand for e in [sample(idx_to_lps(i), None)] if e is not None]
        score = float(np.mean(L)) * .8
        print(f"   axes {name}: mean fibre length {score:.1f} mm")
        if best is None or score > best[0]: best = (score, name, FA, E1)
    _, flip, FA, E1 = best
    sample, track = tracker(FA, E1)

    seeds = []
    for i in np.argwhere(FA > .25):
        r = ses_to_ras(idx_to_lps(i))
        if 12 < abs(r[0] - CH[0]) < 48 and yback + 5 < r[1] < CH[1] - 15 and CH[2] - 18 < r[2] < CH[2] + 32:
            seeds.append(idx_to_lps(i))
    keep = []
    for s in seeds:
        e = sample(s, None)
        if e is None: continue
        line = np.array([ses_to_ras(p) for p in track(s, -e)[::-1] + [s] + track(s, e)])
        if len(line) < 30: continue
        for side, g in LGN.items():
            if not ((line[:, 0] - CH[0]) * (g[0] - CH[0]) > 0).all(): continue
            dl = np.linalg.norm(line - g, axis=1)
            if dl.min() < 9 and (line[:, 1] < yback + 40).any():
                k0, k1 = int(dl.argmin()), int(np.argmin(line[:, 1]))
                seg = line[min(k0, k1):max(k0, k1) + 1]
                if seg[0][1] < seg[-1][1]: seg = seg[::-1]   # from the LGN backwards
                keep.append((side, seg))
    n = {s: sum(1 for k in keep if k[0] == s) for s in LGN}
    print(f"   axes {flip}; {len(seeds)} seeds; optic radiation paths {n}")
    rad = []
    for side in LGN:
        ps = sorted([p for s, p in keep if s == side], key=lambda p: -len(p))
        for p in ps[:40]:   # the longest few dozen per side show the bundle
            rad.append({"side": side, "p": np.round(resample(ndi.gaussian_filter1d(p, 2, axis=0, mode="nearest")), 1).ravel().tolist()})
    return {"radiations": rad, "n": n, "flip": flip, "maker": maker}


def resample(P, step=3.0):
    d = np.r_[0, np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))]
    if d[-1] < step: return P
    t = np.arange(0, d[-1], step); return np.stack([np.interp(t, d, P[:, k]) for k in range(3)], 1)


by = json.load(open(OUT)).get("by_date", {}) if OUT.exists() else {}   # dates not named this time are kept
for date, lst in JOBS:
    by[date] = trace(date, [l for l in open(lst).read().split("\n") if l.strip()])
tracts = []
for side, g in LGN.items():   # chiasm -> LGN, bowing outward around the brainstem (drawn, not traced)
    mid = (CH + g) / 2 + [(g[0] - CH[0]) * .25, 0, -2]
    t = np.linspace(0, 1, 12)[:, None]; P = (1 - t) ** 2 * CH + 2 * (1 - t) * t * mid + t ** 2 * g
    tracts.append({"side": side, "p": np.round(P, 1).ravel().tolist()})
V = {"by_date": dict(sorted(by.items())), "tracts": tracts, "lgn": {k: np.round(v, 1).tolist() for k, v in LGN.items()}, "chiasm": np.round(CH, 1).tolist()}
json.dump(V, open(OUT, "w"), separators=(",", ":"))
M["visual"] = V; json.dump(M, open(MODEL, "w"), separators=(",", ":"))   # also straight into the phone model
print(OUT, ", ".join("%s %d" % (d, sum(v["n"].values())) for d, v in by.items()), "; added to", MODEL)
