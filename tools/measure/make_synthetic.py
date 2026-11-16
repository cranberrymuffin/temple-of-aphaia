"""Synthetic 3DGS scan with known ground truth (plan Step 2.10).

Pure Python/numpy and independent of the TypeScript generators. Writes:
  <out>/synthetic.ply   3DGS layout (62 float32), nx,ny,nz zeroed, rot/scale encode flat
                        surface splats (smallest axis = surface normal)
  <out>/gt.json         ground-truth values, transform, up vector, terrace normal
  <out>/published.json  ground truth in dimensions.json layout (the "published" table)
  <out>/picks.json      ground-truth picks in RAW coordinates (frameHash filled by the test
                        or by save_picks --rebind once a frame exists)

Content: 6 x 12 peristyle on a 3-step crepidoma, 20-fluted entasis columns with
echinus and square abaci, restored architrave blocks on 3 columns, 7 columns missing,
a dominant terrace sloped 8 deg (larger than the stylobate), clutter, 10% outliers,
Gaussian position noise sigma, a random rotation and a uniform scale (default 1.04).

Usage: make_synthetic.py OUTDIR [--noise 0.015] [--seed 1] [--scale 1.04] [--density 1.0]
"""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np  # noqa: E402
from plyfile import PlyData, PlyElement  # noqa: E402
from scipy.spatial.transform import Rotation  # noqa: E402

from common import N_COLS, N_ROWS, perimeter_labels  # noqa: E402

GT = {
    "interaxialFlank": 2.57,
    "cornerContractionFlank": 0.245,
    "interaxialFront": 2.62,
    "cornerContractionFront": 0.25,
    "margin": 0.6,
    "columnHeight": 5.27,
    "lowerDiameterBase": 0.99,
    "upperDiameterTop": 0.73,
    "echinusHeight": 0.25,
    "abacusHeight": 0.22,
    "abacusWidth": 1.25,
    "fluteDepth": 0.025,
    "entasis": 0.008,
    "stepRise": 0.26,
    "stepTread": 0.30,
    "terraceSlopeDeg": 8.0,
}
MISSING = [(0, 4), (0, 9), (5, 2), (5, 7), (2, 0), (3, 11), (4, 11)]
RESTORED = [(0, 1), (5, 5), (1, 0)]
FLUTES = 20


def axis_positions(labels):
    """True-frame column axes. Same convention as fits.grid_nodes with theta = pi and the
    origin at column (0,0) (north-east): col runs -x, row runs -y."""
    af, cf, aw, cw = GT["interaxialFlank"], GT["cornerContractionFlank"], GT["interaxialFront"], GT["cornerContractionFront"]

    def pos(i, n, a, c):
        if i <= 0:
            return 0.0
        corner = a - c
        return corner + min(i - 1, n - 3) * a + (corner if i >= n - 1 else 0.0)

    Lax = pos(N_COLS - 1, N_COLS, af, cf)
    Wax = pos(N_ROWS - 1, N_ROWS, aw, cw)
    out = {}
    for r, c in labels:
        out[(r, c)] = np.array([Lax / 2 - pos(c, N_COLS, af, cf), Wax / 2 - pos(r, N_ROWS, aw, cw)])
    return out, Lax, Wax


def shaft_radius(z, H_shaft):
    R0, R1 = GT["lowerDiameterBase"] / 2, GT["upperDiameterTop"] / 2
    return R0 + (R1 - R0) * z / H_shaft + GT["entasis"] * np.sin(np.pi * z / H_shaft)


def flute_f(psi, d, R):
    h = R * np.sin(np.pi / FLUTES)
    rho = (h * h + d * d) / (2 * d)
    x = (psi / np.pi) * h
    return (np.sqrt(np.maximum(rho * rho - x * x, 0)) - (rho - d)) / d


def _orthobasis(n):
    a = np.where(np.abs(n[:, 2:3]) < 0.9, np.array([[0, 0, 1.0]]), np.array([[1.0, 0, 0]]))
    t1 = np.cross(n, a)
    t1 /= np.linalg.norm(t1, axis=1, keepdims=True)
    t2 = np.cross(n, t1)
    return t1, t2


class Builder:
    def __init__(self, rng, density):
        self.rng = rng
        self.density = density
        self.P, self.N, self.S = [], [], []  # positions, normals, tangential splat size

    def add(self, p, n, area_per_pt):
        self.P.append(p)
        self.N.append(n / np.linalg.norm(n, axis=1, keepdims=True))
        self.S.append(np.full(len(p), np.sqrt(area_per_pt)))

    def n_for(self, area, per_m2):
        return max(int(area * per_m2 * self.density), 1)

    def rect(self, x0, x1, y0, y1, z, per_m2, exclude=None):
        n = self.n_for((x1 - x0) * (y1 - y0), per_m2)
        x = self.rng.uniform(x0, x1, n)
        y = self.rng.uniform(y0, y1, n)
        m = np.ones(n, bool)
        if exclude is not None:
            m = ~exclude(x, y)
        p = np.stack([x[m], y[m], np.full(m.sum(), z)], 1)
        self.add(p, np.tile([0, 0, 1.0], (len(p), 1)), 1.0 / (per_m2 * self.density))

    def vface(self, a, b, z0, z1, outward, per_m2):
        """Vertical rectangle from 2D point a to b, z0..z1, normal outward (2D)."""
        L = np.linalg.norm(b - a)
        n = self.n_for(L * (z1 - z0), per_m2)
        t = self.rng.uniform(0, 1, n)
        z = self.rng.uniform(z0, z1, n)
        xy = a[None, :] + t[:, None] * (b - a)[None, :]
        p = np.column_stack([xy, z])
        nn = np.tile([outward[0], outward[1], 0.0], (n, 1))
        self.add(p, nn, 1.0 / (per_m2 * self.density))

    def box(self, cx, cy, z0, hx, hy, hz, per_m2, top=True, rot=0.0):
        c, s = np.cos(rot), np.sin(rot)
        Rm = np.array([[c, -s], [s, c]])
        corners = [np.array(v) for v in ([hx, hy], [-hx, hy], [-hx, -hy], [hx, -hy])]
        ctr = np.array([cx, cy])
        for i in range(4):
            a = ctr + Rm @ corners[i]
            b = ctr + Rm @ corners[(i + 1) % 4]
            mid = 0.5 * (a + b) - ctr
            self.vface(a, b, z0, z0 + 2 * hz, mid / np.linalg.norm(mid), per_m2)
        if top:
            n = self.n_for(4 * hx * hy, per_m2)
            u = self.rng.uniform(-hx, hx, n)
            v = self.rng.uniform(-hy, hy, n)
            xy = ctr + np.stack([u, v], 1) @ Rm.T
            self.add(np.column_stack([xy, np.full(n, z0 + 2 * hz)]), np.tile([0, 0, 1.0], (n, 1)), 1.0 / (per_m2 * self.density))

    def column(self, cxy, per_m2, restored=False, row_dir=np.array([1.0, 0.0])):
        H = GT["columnHeight"]
        he, ha = GT["echinusHeight"], GT["abacusHeight"]
        Hs = H - he - ha
        d = GT["fluteDepth"]
        phi0 = self.rng.uniform(0, 2 * np.pi / FLUTES)
        area = 2 * np.pi * 0.43 * Hs
        n = self.n_for(area, per_m2)
        z = self.rng.uniform(0, Hs, n)
        th = self.rng.uniform(0, 2 * np.pi, n)
        R = shaft_radius(z, Hs)
        psi = ((FLUTES * (th - phi0) + np.pi) % (2 * np.pi)) - np.pi
        r = R - d * flute_f(psi, d, R)
        p = np.column_stack([cxy[0] + r * np.cos(th), cxy[1] + r * np.sin(th), z])
        self.add(p, np.column_stack([np.cos(th), np.sin(th), np.zeros(n)]), 1.0 / (per_m2 * self.density))
        # echinus: radius from shaft top to 0.62 (quadratic flare)
        r_top = shaft_radius(Hs, Hs)
        n = self.n_for(2 * np.pi * 0.5 * 0.4, per_m2)
        u = self.rng.uniform(0, 1, n)
        th = self.rng.uniform(0, 2 * np.pi, n)
        re = r_top + (0.6 - r_top) * np.sqrt(u)
        ze = Hs + he * u
        slope = np.arctan2(he, 0.6 - r_top)
        nn = np.column_stack([np.cos(th) * np.sin(slope), np.sin(th) * np.sin(slope), np.full(n, -np.cos(slope))])
        self.add(np.column_stack([cxy[0] + re * np.cos(th), cxy[1] + re * np.sin(th), ze]), nn, 1.0 / (per_m2 * self.density))
        # abacus: square block aligned with the grid
        a = GT["abacusWidth"] / 2
        rot = np.arctan2(row_dir[1], row_dir[0])
        self.box(cxy[0], cxy[1], H - ha, a, a, ha / 2, per_m2, top=not restored, rot=rot)
        if restored:
            # restored architrave block sitting on the abacus, spanning one interaxial
            self.box(cxy[0], cxy[1], H, GT["interaxialFlank"] / 2, 0.4, 0.41, per_m2 * 0.5, top=True, rot=rot)


def make(outdir, noise=0.015, seed=1, scale=1.04, density=1.0, outlier_frac=0.10):
    rng = np.random.default_rng(seed)
    os.makedirs(outdir, exist_ok=True)
    labels = sorted(perimeter_labels())
    axes, Lax, Wax = axis_positions(labels)
    m = GT["margin"]
    L, W = Lax + 2 * m, Wax + 2 * m
    b = Builder(rng, density)
    rise, tread = GT["stepRise"], GT["stepTread"]
    # crepidoma: stylobate top (z=0) and two lower steps, with risers
    present = [lab for lab in labels if lab not in MISSING]

    def under_columns(x, y):
        mm = np.zeros(len(x), bool)
        for lab in present:
            c = axes[lab]
            mm |= (x - c[0]) ** 2 + (y - c[1]) ** 2 < 0.44**2
        return mm

    b.rect(-L / 2, L / 2, -W / 2, W / 2, 0.0, 250, exclude=under_columns)
    for k in range(3):
        hx, hy = L / 2 + k * tread, W / 2 + k * tread
        ztop = -k * rise
        if k > 0:
            ring = lambda x, y, hx=hx, hy=hy: (np.abs(x) < hx - tread) & (np.abs(y) < hy - tread)  # noqa: E731
            b.rect(-hx, hx, -hy, hy, ztop, 200, exclude=ring)
        cs = [np.array(v) for v in ([hx, hy], [-hx, hy], [-hx, -hy], [hx, -hy])]
        for i in range(4):
            a_, b_ = cs[i], cs[(i + 1) % 4]
            mid = 0.5 * (a_ + b_)
            b.vface(a_, b_, ztop - rise, ztop, mid / np.linalg.norm(mid), 200)
    # columns
    for lab in present:
        b.column(axes[lab], 1500, restored=lab in RESTORED, row_dir=np.array([1.0, 0.0]))
    # terrace: large plane sloped 8 deg, outside the crepidoma footprint
    zb = -3 * rise
    slope = np.radians(GT["terraceSlopeDeg"])
    alpha = rng.uniform(0, 2 * np.pi)
    tdir = np.array([np.cos(alpha), np.sin(alpha)])
    TX, TY = 40.0, 30.0
    n = b.n_for(4 * TX * TY, 40)
    x = rng.uniform(-TX, TX, n)
    y = rng.uniform(-TY, TY, n)
    keep = ~((np.abs(x) < L / 2 + 3 * tread + 1.0) & (np.abs(y) < W / 2 + 3 * tread + 1.0))
    x, y = x[keep], y[keep]
    z = zb + np.tan(slope) * (x * tdir[0] + y * tdir[1])
    tn = np.array([-np.sin(slope) * tdir[0], -np.sin(slope) * tdir[1], np.cos(slope)])
    b.add(np.column_stack([x, y, z]), np.tile(tn, (len(x), 1)), 1.0 / (40 * density))
    # clutter: fallen blocks and drums on the terrace and the stylobate
    for _ in range(12):
        cx, cy = rng.uniform(-TX * 0.6, TX * 0.6), rng.uniform(-TY * 0.6, TY * 0.6)
        if abs(cx) < L / 2 + 1.5 and abs(cy) < W / 2 + 1.5:
            continue
        zc = zb + np.tan(slope) * (cx * tdir[0] + cy * tdir[1])
        b.box(cx, cy, zc, rng.uniform(0.3, 1.0), rng.uniform(0.3, 0.6), rng.uniform(0.2, 0.4), 300, rot=rng.uniform(0, np.pi))
    for _ in range(6):  # fallen drums: horizontal cylinders
        cx, cy = rng.uniform(-TX * 0.7, TX * 0.7), rng.uniform(-TY * 0.7, TY * 0.7)
        if abs(cx) < L / 2 + 1.5 and abs(cy) < W / 2 + 1.5:
            continue
        zc = zb + np.tan(slope) * (cx * tdir[0] + cy * tdir[1]) + 0.45
        ang = rng.uniform(0, np.pi)
        nn = b.n_for(2 * np.pi * 0.45 * 1.0, 600)
        t = rng.uniform(-0.5, 0.5, nn)
        th = rng.uniform(0, 2 * np.pi, nn)
        ax_ = np.array([np.cos(ang), np.sin(ang), 0])
        e1 = np.array([-np.sin(ang), np.cos(ang), 0])
        e2 = np.array([0, 0, 1.0])
        nrm = np.outer(np.cos(th), e1) + np.outer(np.sin(th), e2)
        p = np.array([cx, cy, zc]) + np.outer(t, ax_) + 0.45 * nrm
        b.add(p, nrm, 1.0 / (600 * density))

    P = np.vstack(b.P)
    N = np.vstack(b.N)
    S = np.concatenate(b.S)
    # normals: small angular noise; positions: Gaussian noise sigma
    N = N + rng.normal(0, np.radians(3.0), N.shape)
    N /= np.linalg.norm(N, axis=1, keepdims=True)
    P = P + rng.normal(0, noise, P.shape)
    t1, t2 = _orthobasis(N)
    Rs = np.stack([t1, t2, N], axis=2)  # columns: tangent, tangent, normal
    scales = np.column_stack([S * 0.5, S * 0.5, S * 0.05])
    opac = rng.uniform(1.0, 4.0, len(P))  # logit; sigmoid 0.73..0.98
    # outliers
    n_out = int(outlier_frac * len(P))
    lo, hi = P.min(axis=0), P.max(axis=0)
    Po = rng.uniform(lo, hi, (n_out, 3))
    Ro = Rotation.random(n_out, random_state=seed + 7).as_matrix()
    So = np.exp(rng.uniform(np.log(0.005), np.log(0.1), (n_out, 3)))
    Oo = rng.uniform(-3, 3, n_out)
    P = np.vstack([P, Po])
    Rs = np.concatenate([Rs, Ro])
    scales = np.vstack([scales, So])
    opac = np.concatenate([opac, Oo])
    # global similarity: random rotation, uniform scale, translation
    Rg = Rotation.random(random_state=seed).as_matrix()
    tg = rng.uniform(-20, 20, 3)
    raw = scale * P @ Rg.T + tg
    Rs = np.einsum("ij,njk->nik", Rg, Rs)
    scales = scales * scale
    q = Rotation.from_matrix(Rs).as_quat()  # x,y,z,w
    q = np.column_stack([q[:, 3], q[:, 0], q[:, 1], q[:, 2]])
    perm = rng.permutation(len(raw))
    raw, q, scales, opac = raw[perm], q[perm], scales[perm], opac[perm]
    write_ply(os.path.join(outdir, "synthetic.ply"), raw, q, scales, opac)

    def to_raw(p):
        return scale * np.asarray(p, float) @ Rg.T + tg

    # ground truth (true metres)
    Hs = GT["columnHeight"] - GT["echinusHeight"] - GT["abacusHeight"]
    D_at = lambda z: 2 * (shaft_radius(z, Hs))  # noqa: E731  (arris diameter)
    truth = {
        "stylobateLength": L,
        "stylobateWidth": W,
        "interaxialFlank": GT["interaxialFlank"],
        "interaxialFront": GT["interaxialFront"],
        "cornerContractionFlank": GT["cornerContractionFlank"],
        "cornerContractionFront": GT["cornerContractionFront"],
        "columnHeight": GT["columnHeight"],
        "lowerDiameter": float(D_at(0.25)),
        "upperDiameter": float(D_at(GT["columnHeight"] - 0.8)),
    }
    gt = {
        "truth": truth,
        "noise": noise,
        "seed": seed,
        "scale": scale,
        "kExpected": 1.0 / scale,
        "rotation": Rg.tolist(),
        "translation": tg.tolist(),
        "upRaw": (Rg @ np.array([0, 0, 1.0])).tolist(),
        "terraceNormalRaw": (Rg @ tn).tolist(),
        "missing": [list(x) for x in MISSING],
        "restored": [list(x) for x in RESTORED],
        "nSplats": int(len(raw)),
    }
    with open(os.path.join(outdir, "gt.json"), "w") as f:
        json.dump(gt, f, indent=1)
    pub = {"meta": {"status": "provisional", "note": "synthetic ground truth"}, "dimensions": {k: {"value": v, "unit": "m", "source": "published"} for k, v in truth.items()}}
    with open(os.path.join(outdir, "published.json"), "w") as f:
        json.dump(pub, f, indent=1)

    # ground-truth picks in raw coordinates (edges picked 0.1 m inside the true edge)
    cols = []
    for lab in labels:
        st = "missing" if lab in MISSING else "standing"
        seed_pt = None if st == "missing" else to_raw([*axes[lab], 1.0]).tolist()
        cols.append({"label": list(lab), "status": st, "complete": st == "standing", "seed": seed_pt})
    e = 0.1
    edges = {
        "north": [[x, W / 2 - e, 0.0] for x in (-L / 3, 0.0, L / 3)],
        "south": [[x, -W / 2 + e, 0.0] for x in (-L / 3, 0.0, L / 3)],
        "east": [[L / 2 - e, y, 0.0] for y in (-W / 3, 0.0, W / 3)],
        "west": [[-L / 2 + e, y, 0.0] for y in (-W / 3, 0.0, W / 3)],
    }
    crop = [[L / 2 + 1, W / 2 + 1, 0], [-L / 2 - 1, W / 2 + 1, 0], [-L / 2 - 1, -W / 2 - 1, 0], [L / 2 + 1, -W / 2 - 1, 0]]
    picks = {
        "coords": "raw",
        "frameHash": None,
        "convention": "synthetic ground truth; same (row,col) convention as the real picks",
        "crop": to_raw(crop).tolist(),
        "cellaExclude": None,
        "columns": cols,
        "stylobateEdges": {k: to_raw(v).tolist() for k, v in edges.items()},
        "interior": [],
    }
    with open(os.path.join(outdir, "picks.json"), "w") as f:
        json.dump(picks, f, indent=1)
    return gt


def write_ply(path, xyz, q, scales, opac):
    names = ["x", "y", "z", "nx", "ny", "nz", "f_dc_0", "f_dc_1", "f_dc_2"] + [f"f_rest_{i}" for i in range(45)] + ["opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"]
    arr = np.zeros(len(xyz), dtype=[(n, "<f4") for n in names])
    arr["x"], arr["y"], arr["z"] = xyz[:, 0], xyz[:, 1], xyz[:, 2]
    arr["opacity"] = opac
    ls = np.log(scales)
    arr["scale_0"], arr["scale_1"], arr["scale_2"] = ls[:, 0], ls[:, 1], ls[:, 2]
    for i in range(4):
        arr[f"rot_{i}"] = q[:, i]
    PlyData([PlyElement.describe(arr, "vertex")], text=False).write(path)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("outdir")
    ap.add_argument("--noise", type=float, default=0.015)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--scale", type=float, default=1.04)
    ap.add_argument("--density", type=float, default=1.0)
    a = ap.parse_args(argv)
    gt = make(a.outdir, a.noise, a.seed, a.scale, a.density)
    print(f"wrote {gt['nSplats']} splats to {a.outdir}")


if __name__ == "__main__":
    main()
