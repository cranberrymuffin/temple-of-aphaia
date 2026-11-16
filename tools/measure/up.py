"""Global up-axis search (plan Step 2.3) and frame.json writer.

a. Per-splat normal = column of R(q) for the smallest-scale axis; flat splats only
   (min/mid scale < 0.3). Stored nx,ny,nz are checked and ignored when zero.
b. Global spherical histogram (Fibonacci grid, ~1 deg cells, axial), local maxima as
   candidates, plus +-X/Y/Z as extra seeds only. Each candidate is mean-shifted to its
   local peak and then replaced by the pole of the vertical-surface band (great circle
   orthogonal to it). Score = peak weight x band weight (fractions of total weight):
   a sum would reward horizontal axes, whose great circle holds every floor normal.
c. Column-axis consensus is applied later by measure_from_picks.py.
d. RANSAC ground plane is reported as a cross-check only.
e. Rotation + translation -> measurements/frame.json with frameHash.

Usage: up.py scan.ply [--out measurements/frame.json]
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np  # noqa: E402
from scipy.spatial import cKDTree  # noqa: E402

from common import MEASUREMENTS, angle_deg, make_frame, quat_to_rot, rotation_between, write_json  # noqa: E402
from load import Splats, load, stored_normals_usable  # noqa: E402

FLAT_RATIO = 0.3
PEAK_DEG = 3.0
BAND_DEG = 3.0
BAND_CAPTURE_DEG = 12.0


def splat_normals(s: Splats):
    """Return (normals, weights, flat_mask) for all splats in s."""
    R = quat_to_rot(s.rot)
    order = np.argsort(s.scale, axis=1)
    smin = order[:, 0]
    n = R[np.arange(len(R)), :, smin]
    srt = np.take_along_axis(s.scale, order, axis=1)
    flat = (srt[:, 0] / np.maximum(srt[:, 1], 1e-12)) < FLAT_RATIO
    area = srt[:, 1] * srt[:, 2]
    w = s.opacity * area
    return n, w, flat


def fibonacci_sphere(n):
    i = np.arange(n) + 0.5
    phi = np.arccos(1 - 2 * i / n)
    theta = np.pi * (1 + 5 ** 0.5) * i
    return np.stack([np.cos(theta) * np.sin(phi), np.sin(theta) * np.sin(phi), np.cos(phi)], axis=1)


def _mean_shift(n, w, u, deg, iters=50):
    c = np.cos(np.radians(deg))
    for _ in range(iters):
        d = n @ u
        m = np.abs(d) > c
        if not m.any():
            return u, 0.0
        v = (n[m] * np.sign(d[m])[:, None] * w[m, None]).sum(axis=0)
        v /= np.linalg.norm(v)
        if np.dot(v, u) > np.cos(np.radians(1e-4)):
            u = v
            break
        u = v
    return u, float(w[np.abs(n @ u) > c].sum())


def _band_pole(n, w, u, capture_deg, iters=30):
    """Pole of the great circle best fitting the near-orthogonal normals around u."""
    s = np.sin(np.radians(capture_deg))
    for _ in range(iters):
        m = np.abs(n @ u) < s
        if m.sum() < 10:
            return u
        nm = n[m]
        C = (nm * w[m, None]).T @ nm
        evals, evecs = np.linalg.eigh(C)
        v = evecs[:, 0]
        if np.dot(v, u) < 0:
            v = -v
        if np.dot(v, u) > np.cos(np.radians(1e-4)):
            return v
        u = v
    return u


def score_axis(n, w, u, total):
    d = np.abs(n @ u)
    peak = w[d > np.cos(np.radians(PEAK_DEG))].sum() / total
    band = w[d < np.sin(np.radians(BAND_DEG))].sum() / total
    return float(peak), float(band)


def _sign_vote(xyz, up, cell=2.0):
    """Ground lies under objects: in each horizontal cell the height distribution is
    skewed upward (dense surface at the bottom, sparse objects above). Returns the
    number of cells voting for +up minus those voting for -up."""
    R = rotation_between(up, [0, 0, 1])
    p = xyz @ R.T
    cell = cell * max(1.0, 1.0)
    key = np.floor(p[:, :2] / cell).astype(np.int64)
    _, inv = np.unique(key, axis=0, return_inverse=True)
    inv = inv.ravel()
    order = np.argsort(inv, kind="stable")
    bounds = np.flatnonzero(np.diff(inv[order])) + 1
    votes = 0
    for grp in np.split(order, bounds):
        if len(grp) < 50:
            continue
        h = p[grp, 2]
        lo, med, hi = np.percentile(h, [5, 50, 95])
        if hi - lo < 0.2:
            continue
        votes += 1 if (hi - med) > (med - lo) else -1
    return votes


def estimate_up(s: Splats, max_normals=400_000, n_candidates=24, rng=None):
    rng = np.random.default_rng(0) if rng is None else rng
    n, w, flat = splat_normals(s)
    n, w = n[flat], w[flat]
    if len(n) > max_normals:
        idx = rng.choice(len(n), max_normals, replace=False, p=w / w.sum())
        n, w = n[idx], np.ones(max_normals)  # importance-sampled: equal weights
    total = w.sum()

    # Global axial histogram on a ~1 deg Fibonacci grid.
    grid = fibonacci_sphere(41253)
    tree = cKDTree(grid)
    _, i1 = tree.query(n)
    _, i2 = tree.query(-n)
    hist = np.bincount(i1, weights=w, minlength=len(grid)) + np.bincount(i2, weights=w, minlength=len(grid))
    # Smooth over 2 deg and find local maxima within 4 deg.
    rad2 = 2 * np.sin(np.radians(2.0) / 2)
    rad4 = 2 * np.sin(np.radians(4.0) / 2)
    nb2 = tree.query_ball_point(grid, rad2)
    smooth = np.array([hist[nb].sum() for nb in nb2])
    nb4 = tree.query_ball_point(grid, rad4)
    is_max = np.array([smooth[i] >= smooth[nb].max() and smooth[i] > 0 for i, nb in enumerate(nb4)])
    cand = np.where(is_max)[0]
    cand = cand[np.argsort(-smooth[cand])]
    seeds = []
    for ci in cand:
        g = grid[ci]
        if all(angle_deg(g, sv) > 4 for sv in seeds):
            seeds.append(g)
        if len(seeds) >= n_candidates:
            break
    histogram_seeds = len(seeds)
    seeds += [np.array(a, float) for a in ([1, 0, 0], [0, 1, 0], [0, 0, 1])]  # +-X/Y/Z: seeds only (axial)

    results = []
    for sv in seeds:
        u, _ = _mean_shift(n, w, sv, PEAK_DEG)
        u = _band_pole(n, w, u, BAND_CAPTURE_DEG)
        u = _band_pole(n, w, u, BAND_DEG * 2)
        # The axis is the band pole. A free mean-shift from here would drift onto a larger
        # tilted floor (the 8 deg terrace); the local peak is kept only as a diagnostic.
        local_peak, _ = _mean_shift(n, w, u, PEAK_DEG, iters=1)
        peak, band = score_axis(n, w, u, total)
        results.append({"axis": u, "pole": local_peak, "peak": peak, "band": band, "score": peak * band})
    # dedupe
    uniq = []
    for r in sorted(results, key=lambda r: -r["score"]):
        if all(angle_deg(r["axis"], q["axis"]) > 1.0 for q in uniq):
            uniq.append(r)
    best = uniq[0]
    up = best["axis"]
    if up[np.argmax(np.abs(up))] < 0:
        up = -up
    if _sign_vote(s.xyz, up) < 0:
        up = -up
    return {
        "up": up,
        "peakAngleToBandPoleDeg": angle_deg(best["axis"], best["pole"]),  # band pole vs one-step local peak
        "candidates": [
            {"axis": r["axis"].tolist(), "peak": r["peak"], "band": r["band"], "score": r["score"]} for r in uniq[:8]
        ],
        "nNormals": int(len(n)),
        "histogramSeeds": histogram_seeds,
        "normals": n,
        "weights": w,
    }


def horizontal_orientation(xyz, up, bin_size=0.2):
    """Dominant rectilinear azimuth (mod 90 deg) of the structure in the up-aligned frame.

    Vertical-surface normals of a ruin are dominated by round columns, so the azimuth
    comes from points instead: the angle that makes the x and y projection histograms
    sharpest (sum of squared bin counts), coarse 0.5 deg search then 0.05 deg refine.
    """
    R = rotation_between(up, [0, 0, 1])
    p = xyz @ R.T
    xy = p[:, :2] - np.median(p[:, :2], axis=0)
    rng = np.random.default_rng(3)
    if len(xy) > 300_000:
        xy = xy[rng.choice(len(xy), 300_000, replace=False)]

    def sharp(th):
        c, s = np.cos(th), np.sin(th)
        u = xy[:, 0] * c + xy[:, 1] * s
        v = -xy[:, 0] * s + xy[:, 1] * c
        tot = 0.0
        for a in (u, v):
            h = np.bincount(np.floor((a - a.min()) / bin_size).astype(int))
            tot += float((h.astype(float) ** 2).sum())
        return tot

    coarse = np.radians(np.arange(0, 90, 0.5))
    vals = [sharp(t) for t in coarse]
    t0 = coarse[int(np.argmax(vals))]
    fine = t0 + np.radians(np.arange(-0.75, 0.75001, 0.05))
    vals = [sharp(t) for t in fine]
    return float(fine[int(np.argmax(vals))]), R


def ransac_plane(pts, thresh, iters=500, rng=None):
    rng = np.random.default_rng(1) if rng is None else rng
    best = (None, -1)
    for _ in range(iters):
        p = pts[rng.choice(len(pts), 3, replace=False)]
        nrm = np.cross(p[1] - p[0], p[2] - p[0])
        L = np.linalg.norm(nrm)
        if L < 1e-12:
            continue
        nrm /= L
        cnt = int((np.abs((pts - p[0]) @ nrm) < thresh).sum())
        if cnt > best[1]:
            best = ((nrm, p[0]), cnt)
    nrm, p0 = best[0]
    inl = np.abs((pts - p0) @ nrm) < thresh
    c = pts[inl].mean(axis=0)
    _, _, vt = np.linalg.svd(pts[inl] - c, full_matrices=False)
    return vt[2], c, inl


def normal_sigma_deg(est):
    """Uncertainty of the normal-based up: the larger of the band-pole offset and 0.25 deg."""
    return max(float(est["peakAngleToBandPoleDeg"]), 0.25)


def consensus_up(u_normals, sig_normals_deg, u_columns, sig_columns_deg):
    """Inverse-variance weighted combination of two axial unit vectors."""
    u_n = np.asarray(u_normals, float) / np.linalg.norm(u_normals)
    u_c = np.asarray(u_columns, float) / np.linalg.norm(u_columns)
    if np.dot(u_n, u_c) < 0:
        u_c = -u_c
    w_n, w_c = 1.0 / sig_normals_deg**2, 1.0 / sig_columns_deg**2
    u = w_n * u_n + w_c * u_c
    u /= np.linalg.norm(u)
    sig = 1.0 / np.sqrt(w_n + w_c)
    return u, float(sig), angle_deg(u_n, u_c)


def build_frame(s: Splats, rng=None, column_axes=None):
    """column_axes: optional {"meanRaw": [x,y,z], "sigmaDeg": s} from a previous measure run."""
    est = estimate_up(s, rng=rng)
    up_normals = est["up"]
    up = up_normals
    consensus = None
    if column_axes is not None:
        up, sig, ang = consensus_up(up_normals, normal_sigma_deg(est), column_axes["meanRaw"], column_axes["sigmaDeg"])
        if np.dot(up, up_normals) < 0:
            up = -up
        consensus = {
            "columnAxisMeanRaw": list(map(float, column_axes["meanRaw"])),
            "columnAxisSigmaDeg": float(column_axes["sigmaDeg"]),
            "normalSigmaDeg": normal_sigma_deg(est),
            "angleNormalsVsColumnsDeg": ang,
            "consensusSigmaDeg": sig,
            "withinOneDegree": bool(ang <= 1.0),
        }
    theta, R_up = horizontal_orientation(s.xyz, up)
    c, si = np.cos(-theta), np.sin(-theta)
    Rz = np.array([[c, -si, 0], [si, c, 0], [0, 0, 1]])
    R = Rz @ R_up
    pf = s.xyz @ R.T
    t = -np.array([np.median(pf[:, 0]), np.median(pf[:, 1]), np.percentile(pf[:, 2], 5)])
    rng2 = np.random.default_rng(2)
    sub = s.xyz[rng2.choice(len(s), min(200_000, len(s)), replace=False)]
    gn, _, inl = ransac_plane(sub, thresh=0.05 * max(1.0, float(np.ptp(sub[:, 0])) / 80.0))
    return {
        "R": R,
        "t": t,
        "report": {
            "upRaw": up.tolist(),
            "upNormalsRaw": up_normals.tolist(),
            "normalSigmaDeg": normal_sigma_deg(est),
            "consensus": consensus,
            "upSource": "normals" if consensus is None else "consensus(normals, column axes)",
            "peakAngleToBandPoleDeg": est["peakAngleToBandPoleDeg"],
            "candidates": est["candidates"],
            "nFlatNormals": est["nNormals"],
            "histogramSeeds": est["histogramSeeds"],
            "azimuthDeg": float(np.degrees(theta)),
            "ransacGroundCrossCheck": {
                "normalRaw": gn.tolist(),
                "angleToUpDeg": angle_deg(gn, up),
                "inlierFraction": float(inl.mean()),
                "note": "cross-check only; terrace may slope",
            },
        },
    }


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("scan")
    ap.add_argument("--out", default=str(MEASUREMENTS / "frame.json"))
    ap.add_argument("--consensus", help="scan-report.json from a previous measure run: combine the normal-based up with its column-axis mean")
    a = ap.parse_args(argv)
    s, allsp = load(a.scan)
    col = None
    if a.consensus:
        from common import read_json

        col = read_json(a.consensus)["up"]["columnAxes"]
    fr = build_frame(s, column_axes=col)
    frame = make_frame(
        fr["R"],
        fr["t"],
        {
            "scan": os.path.basename(a.scan),
            "nSplats": len(allsp),
            "nFiltered": len(s),
            "storedNormalsUsable": stored_normals_usable(allsp),
            "up": fr["report"],
        },
    )
    write_json(a.out, frame)
    rep = fr["report"]
    print(f"up (raw) = {np.round(rep['upRaw'], 5).tolist()}  band-pole offset {rep['peakAngleToBandPoleDeg']:.3f} deg")
    if rep["consensus"]:
        c = rep["consensus"]
        print(f"consensus: normals vs column axes {c['angleNormalsVsColumnsDeg']:.2f} deg (sigma normals {c['normalSigmaDeg']:.2f}, columns {c['columnAxisSigmaDeg']:.2f})")
    print(f"RANSAC ground cross-check angle {rep['ransacGroundCrossCheck']['angleToUpDeg']:.2f} deg")
    for c in rep["candidates"][:5]:
        print("  cand", np.round(c["axis"], 3).tolist(), f"peak={c['peak']:.3f} band={c['band']:.3f}")
    print("frameHash", frame["frameHash"], "->", a.out)


if __name__ == "__main__":
    main()
