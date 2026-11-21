"""3D model for the phone start screen (phone_view.js), all in the space of the reference brain MRI (the one every other scan is lined up to):
- a glass head and an approximate brain envelope from the AVERAGE of every measured contrast scan (median, each scaled to its own
  brightness first): the scans cover different parts of the head, so together they reach the crown, and the average is clean;
- blood vessels: bright tubes in that average (Frangi vesselness inside the skull; lesions masked out; the average keeps vessels,
  which stay put, and washes out lesions, which change), reduced to centre lines with a thickness;
- eyes (the dark round globes) and optic nerves (least-cost path through nerve-like tissue from the back of each eye to the chiasm);
- every viewer scan's lesions, each fitted with one shared mesh layout so the page can morph them.

    imaging/.venv/bin/python -I make_phone_model.py [local/imaging] [local/phone/model.json]

Needs SimpleITK, scikit-image and scipy (the imaging venv has them). Output is private health data: it stays in local/.
The face is cut away (a box in front of and below the brow) so the skin surface can't be used to recognise anyone.
"""
import json, pathlib, sys
import numpy as np, SimpleITK as sitk
from skimage import measure, filters
from scipy import ndimage as ndi

IMG = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else pathlib.Path(__file__).parent / "local" / "imaging")
OUT = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else pathlib.Path(__file__).parent / "local" / "phone" / "model.json")
REF = next((s_["date"] for s_ in json.load(open(IMG / "imaging.json"))["viewer_scans"] if "Aligned to" not in s_.get("note", "")),
           None)   # the reference scan: the one every other scan is lined up to
SP = 2.5                       # mm per voxel for the surfaces (small file, smooth enough on a phone)
FACE_Y, FACE_Z = 30.0, -12.0   # RAS mm: everything more forward than FACE_Y and lower than FACE_Z is cut (eyes, nose, mouth)

ref = sitk.ReadImage(str(IMG / REF / "t1c.nii.gz"), sitk.sitkFloat32)
VS = json.load(open(IMG / "imaging.json"))["viewer_scans"]
stack = []
for s_ in VS:
    if s_.get("viewing") or not (IMG / s_["date"] / "t1c.nii.gz").exists():
        continue
    x = sitk.GetArrayFromImage(sitk.ReadImage(str(IMG / s_["date"] / "t1c.nii.gz"))).astype(np.float32)
    stack.append((x / np.percentile(x[x > np.percentile(x, 50)], 99)).astype(np.float16))
med = np.median(np.stack(stack), 0).astype(np.float32); del stack   # z, y, x on the 1 mm grid of the reference scan
im = sitk.GetImageFromArray(med); im.CopyInformation(ref)
size = [int(round(s * o / SP)) for s, o in zip(im.GetSize(), im.GetSpacing())]
r = sitk.ResampleImageFilter(); r.SetOutputSpacing([SP] * 3); r.SetSize(size)
r.SetOutputOrigin(im.GetOrigin()); r.SetOutputDirection(im.GetDirection()); r.SetInterpolator(sitk.sitkLinear)
lo = r.Execute(im)
a = ndi.gaussian_filter(sitk.GetArrayFromImage(lo), 0.8)   # z, y, x

def biggest(m):
    lab, _ = ndi.label(m)
    return lab == (np.argmax(np.bincount(lab.ravel())[1:]) + 1)

head = biggest(a > filters.threshold_otsu(a[a > np.percentile(a, 5)]) * 0.45)
head = ndi.binary_closing(head, iterations=3)
for z in range(head.shape[0]):
    head[z] = ndi.binary_fill_holes(head[z])

# RAS position of every voxel centre (LPS from the image, x and y flipped)
kk, jj, ii = np.indices(head.shape)
D = np.array(lo.GetDirection()).reshape(3, 3); O = np.array(lo.GetOrigin())
lps = O[:, None] + D @ (np.stack([ii.ravel(), jj.ravel(), kk.ravel()]) * SP)
ras_y = (-lps[1]).reshape(head.shape); ras_z = lps[2].reshape(head.shape)

# brain envelope (approximate): the head shrunk ~13 mm within each slice, low part cut
st2 = np.zeros((3, 3, 3), bool); st2[1] = ndi.generate_binary_structure(2, 1)
br = biggest(ndi.binary_erosion(head, structure=st2, iterations=int(round(13 / SP))))
br[ras_z < -45] = False
br = ndi.binary_fill_holes(br)

head[(ras_y > FACE_Y) & (ras_z < FACE_Z)] = False   # deface
head = biggest(head)

# pad with empty slices so both surfaces are closed where the scan stops
head = np.pad(head, 2); br = np.pad(br, 2)
lo.SetOrigin(tuple(O - D @ np.array([2 * SP] * 3)))

def surf(mask, sigma):
    v, f, _, _ = measure.marching_cubes(ndi.gaussian_filter(mask.astype(np.float32), sigma), 0.5, step_size=2)
    pts = np.array([lo.TransformContinuousIndexToPhysicalPoint((float(x), float(y), float(z))) for z, y, x in v])
    pts[:, 0] *= -1; pts[:, 1] *= -1   # LPS -> RAS
    return {"v": np.round(pts, 1).ravel().tolist(), "f": f[:, ::-1].ravel().tolist()}, pts

H, hp = surf(head, 1.2)
B, _ = surf(br, 2.4)

# ---- vessels, eyes, optic nerves (1 mm grid of the reference scan) ----
def ras1(zyx):   # (n,3) z,y,x indices on the 1 mm grid -> RAS mm
    p = np.array([ref.TransformContinuousIndexToPhysicalPoint((float(x), float(y), float(z))) for z, y, x in zyx])
    p[:, 0] *= -1; p[:, 1] *= -1
    return p

hd1 = ndi.binary_fill_holes(ndi.binary_closing(med > 0.15, iterations=3)); hd1 = biggest(hd1)
for z in range(hd1.shape[0]):
    hd1[z] = ndi.binary_fill_holes(hd1[z])
inner = ndi.binary_erosion(hd1, iterations=11)   # inside the skull, away from bright scalp fat and bone marrow
les = np.zeros(med.shape, bool)
for s_ in VS:
    f_ = IMG / s_["date"] / "lesions.nii.gz"
    if f_.exists():
        les |= sitk.GetArrayFromImage(sitk.ReadImage(str(f_))) > 0
les = ndi.binary_dilation(les, iterations=3)
fr = filters.frangi(np.where(inner, med, 0), sigmas=[1, 1.5, 2, 3], black_ridges=False, alpha=0.5, beta=0.5)
fr[~inner] = 0
ves = filters.apply_hysteresis_threshold(fr, 0.03, 0.08) & ~les; ves[:6] = False
lab, _ = ndi.label(ves); sz = np.bincount(lab.ravel()); ves = np.isin(lab, np.where(sz > 200)[0][1:])
from skimage.morphology import skeletonize
sk = skeletonize(ves); edt = ndi.distance_transform_edt(ves)

def polylines(sk):
    """skeleton voxels -> list of paths (each a list of (z,y,x)), split at ends and branch points"""
    pts = set(map(tuple, np.argwhere(sk))); off = [(a, b, c) for a in (-1, 0, 1) for b in (-1, 0, 1) for c in (-1, 0, 1) if (a, b, c) != (0, 0, 0)]
    nb = {p: [(p[0] + a, p[1] + b, p[2] + c) for a, b, c in off if (p[0] + a, p[1] + b, p[2] + c) in pts] for p in pts}
    node = {p for p in pts if len(nb[p]) != 2}; seen = set(); out = []
    def walk(a, b):
        path = [a, b]
        while path[-1] not in node:
            nxt = [q for q in nb[path[-1]] if q != path[-2] and frozenset((path[-1], q)) not in seen]
            if not nxt: break
            seen.add(frozenset((path[-1], nxt[0]))); path.append(nxt[0])
        return path
    for a in list(node) + list(pts):   # from nodes first, then any leftover loops
        for b in nb[a]:
            if frozenset((a, b)) in seen: continue
            seen.add(frozenset((a, b))); out.append(walk(a, b))
    return out

def smooth(p, k=1.5):
    p = np.asarray(p, float)
    if len(p) < 4: return p
    q = ndi.gaussian_filter1d(p, k, axis=0, mode="nearest"); q[0], q[-1] = p[0], p[-1]
    return q

VES = []
for path in polylines(sk):
    if len(path) < 4: continue
    r = float(np.clip(np.mean([edt[p] for p in path]), .6, 3.0))
    q = ras1(smooth(path)[::2] if len(path) > 8 else smooth(path))
    if np.mean(q[:, 2] < -85) > .5: continue   # along the bottom edge of the scanned slab: an edge effect, not a vessel
    VES.append({"r": round(r, 2), "p": np.round(q, 1).ravel().tolist()})

# eyes: the two dark round globes in front, off the midline
Z, Y, X = np.indices(med.shape); smd = ndi.gaussian_filter(med, 1)
xm = med.shape[2] / 2
lab, _ = ndi.label((smd < 0.3) & hd1 & (np.abs(X - xm) > 18)); sz = np.bincount(lab.ravel()); eyes = []
for k in np.argsort(sz)[::-1][1:20]:
    if not 2500 <= sz[k] <= 12000: continue
    zz, yy, xx = np.where(lab == k); ext = [int(np.ptp(a)) + 1 for a in (zz, yy, xx)]
    if max(ext) < 35 and min(ext) > 15: eyes.append(k)
    if len(eyes) == 2: break
EYES = []; NERVES = []
from skimage.graph import MCP_Geometric
sm7 = ndi.gaussian_filter(med, 0.7); E = []
for k in eyes:
    m = lab == k
    v, f, _, _ = measure.marching_cubes(ndi.gaussian_filter(m.astype(np.float32), 1.0), 0.5, step_size=2)
    EYES.append({"v": np.round(ras1(v), 1).ravel().tolist(), "f": f[:, ::-1].ravel().tolist()})
    zz, yy, xx = np.where(m); E.append((zz.mean(), yy.max() + 1, xx.mean(), yy.mean()))
if len(E) == 2:
    # chiasm: on the midline between the eyes, ~43 mm behind their centres and ~8 mm higher (where these scans show it)
    ch = (int(round(np.mean([e[0] for e in E]) + 8)), int(round(np.mean([e[3] for e in E]) + 43)), int(round(np.mean([e[2] for e in E]))))
    z0, z1 = ch[0] - 25, ch[0] + 15; y0, y1 = int(min(e[1] for e in E)) - 2, ch[1] + 6; x0, x1 = int(min(e[2] for e in E)) - 15, int(max(e[2] for e in E)) + 15
    cost = 0.03 + 4 * (sm7[z0:z1, y0:y1, x0:x1] - 0.6) ** 2   # the nerve is mid-grey between bright fat and dark bone or air
    for e in E:
        st = (int(round(e[0])) - z0, int(e[1]) - y0, int(round(e[2])) - x0); en = (ch[0] - z0, ch[1] - y0, ch[2] - x0)
        m_ = MCP_Geometric(cost); m_.find_costs([st], [en]); p = np.array(m_.traceback(en)) + [z0, y0, x0]
        NERVES.append({"r": 1.7, "p": np.round(ras1(smooth(p, 2.5)[::2]), 1).ravel().tolist()})
print(f"vessels: {len(VES)} paths from {int(sk.sum())} centre-line points; eyes {len(EYES)}; optic nerves {len(NERVES)}")

def obj(p):
    v, f = [], []
    for line in open(p):
        s = line.split()
        if s and s[0] == "v":
            v.append([float(x) for x in s[1:4]])
        elif s and s[0] == "f":
            f.append([int(x.split("/")[0]) - 1 for x in s[1:4]])
    return np.array(v), np.array(f)

# Every lesion on every scan is fitted with the same mesh layout (a sphere of SUB-times-divided triangles, shrink-wrapped
# onto the outline: for each direction from the lesion's centre, the farthest point where the ray leaves the outline).
# Same points in the same order on every scan, so the page can blend one scan's shape into the next point by point (a real
# morph). It keeps the outer shape; hollows inside a lesion (e.g. a ring) are filled in.
SUB = 3
def icosphere(n):
    t = (1 + 5 ** .5) / 2
    v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
    f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
         [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]]
    v = [np.array(x, float) / np.linalg.norm(x) for x in v]
    for _ in range(n):
        mid, nf = {}, []
        def m(a, b):
            k = (min(a, b), max(a, b))
            if k not in mid:
                x = v[a] + v[b]; v.append(x / np.linalg.norm(x)); mid[k] = len(v) - 1
            return mid[k]
        for a, b, c in f:
            ab, bc, ca = m(a, b), m(b, c), m(c, a); nf += [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]]
        f = nf
    return np.array(v), np.array(f)
DIRS, TRI = icosphere(SUB)
NB = [set() for _ in DIRS]
for a, b, c in TRI:
    NB[a] |= {b, c}; NB[b] |= {a, c}; NB[c] |= {a, b}

def wrap(v, f):
    """centre (volume centroid) and the radius along each of DIRS to where the outline is left for the last time"""
    A, B, Cc = v[f[:, 0]], v[f[:, 1]], v[f[:, 2]]
    vol = np.einsum("ij,ij->i", A, np.cross(B, Cc)) / 6
    c = ((A + B + Cc) / 4 * vol[:, None]).sum(0) / vol.sum() if abs(vol.sum()) > 1e-6 else v.mean(0)
    e1, e2, s0 = B - A, Cc - A, c - A
    r = np.zeros(len(DIRS))
    for k, d in enumerate(DIRS):   # Moller-Trumbore against every triangle at once
        p = np.cross(d, e2); det = np.einsum("ij,ij->i", e1, p); ok = np.abs(det) > 1e-9; inv = np.where(ok, 1 / np.where(ok, det, 1), 0)
        u = np.einsum("ij,ij->i", s0, p) * inv; q = np.cross(s0, e1); w = (q @ d) * inv; t = np.einsum("ij,ij->i", e2, q) * inv
        hit = ok & (u >= 0) & (w >= 0) & (u + w <= 1) & (t > 0)
        r[k] = t[hit].max() if hit.any() else np.nan
    for _ in range(2):   # fill misses, then one gentle smoothing so single rays can't spike
        nan = np.isnan(r)
        if nan.any():
            r[nan] = [np.nanmean([r[j] for j in NB[k]]) if not np.all(np.isnan([r[j] for j in NB[k]])) else 0 for k in np.where(nan)[0]]
    r = np.nan_to_num(r)
    r = .6 * r + .4 * np.array([np.mean([r[j] for j in NB[k]]) for k in range(len(r))])
    return c, r

scans = []
for s in VS:
    L = []
    for l in s["lesions"]:
        p = IMG.parent / l["mesh"] if "mesh" in l else None
        if p and p.exists():
            c, r = wrap(*obj(p))
            L.append({"id": l["id"], "name": l.get("name", ""), "enh": l.get("enh") or 0, "rgb": l.get("rgb"),
                      "c": np.round(c, 1).tolist(), "r": np.round(r, 1).tolist()})
    scans.append({"date": s["date"], "field": s.get("field"), "viewing": bool(s.get("viewing")), "lesions": L})

OUT.parent.mkdir(parents=True, exist_ok=True)
zcut = [float(hp[:, 2].min()), float(hp[:, 2].max())]   # where the head surface stops (neck, crown): the page fades there
VIS = OUT.parent / "tracts.json"   # optic radiations from her DTI (make_phone_tracts.py), if made
json.dump({"visual": json.load(open(VIS)) if VIS.exists() else None, "ref": REF, "zcut": zcut, "face": [FACE_Y, FACE_Z], "head": H, "brain": B, "dirs": np.round(DIRS, 4).ravel().tolist(), "tri": TRI.ravel().tolist(), "vessels": VES, "eyes": EYES, "nerves": NERVES, "scans": scans}, open(OUT, "w"), separators=(",", ":"))
print(f"{OUT}: {OUT.stat().st_size // 1024} KB; head {len(H['f']) // 3} tris, brain {len(B['f']) // 3}, {len(scans)} scans, zcut {np.round(zcut, 1)}")
