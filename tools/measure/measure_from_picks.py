"""Automated fits inside the picked regions, scale fit and report (plan Steps 2.6-2.8).

Usage:
  measure_from_picks.py scan.ply [--frame measurements/frame.json] [--picks measurements/picks.json]
                        [--published src/data/dimensions.json] [--outdir measurements]
                        [--scale-ref <published_m>:<raw>] [--no-images] [--bootstrap 500]

Exits non-zero (2) when picks.json is bound to a different frameHash than frame.json.
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np  # noqa: E402
from scipy.spatial import cKDTree  # noqa: E402

import fits  # noqa: E402
from common import MEASUREMENTS, REPO, angle_deg, frame_matrix, load_frame, read_json, to_frame, write_json  # noqa: E402
from decide import LONG_KEYS, decide_all  # noqa: E402
from load import MAX_SPLAT_SCALE, OPACITY_THRESHOLD, OPACITY_THRESHOLD_LOW, read_all  # noqa: E402
from save_picks import FrameMismatch, load_picks, raw_to_frame  # noqa: E402
from up import splat_normals  # noqa: E402

LOWER_LEVELS = np.round(np.arange(0.10, 0.4001, 0.05), 3)  # slices 0.05 thick, 0.1..0.4 above the stylobate


def published_values(path):
    d = read_json(path)["dimensions"]
    return {k: v["value"] for k, v in d.items() if v.get("source") == "published" or "value" in v}


# ------------------------------------------------------------------ stages


def coarse_plane(p, crop_xy, cella_xy, rng):
    """Coarse stylobate plane (10 cm RANSAC) on the peristasis ring; only sets search windows."""
    inside = fits.point_in_polygon(p[:, :2], crop_xy)
    if cella_xy is not None:
        inside &= ~fits.point_in_polygon(p[:, :2], cella_xy)
    q = p[inside]
    h, e = np.histogram(q[:, 2], bins=np.arange(q[:, 2].min(), q[:, 2].max() + 0.1, 0.1))
    z0 = e[np.argmax(h)]
    qq = q[np.abs(q[:, 2] - z0) < 1.0]
    if len(qq) > 150_000:
        qq = qq[rng.choice(len(qq), 150_000, replace=False)]
    n, p0, inl = fits.ransac_plane(qq, thresh=0.10, iters=600, rng=rng, max_tilt_deg=5.0)
    return {"normal": n, "point": p0}


def shaft_foot(p_near, axis_xy, zc, window=0.6, r_in=0.5):
    """Lowest height where the shaft (points inside r_in of the axis) is continuously
    present, scanning down from zc + 1.5. Returns None when no shaft is found."""
    rr = np.hypot(p_near[:, 0] - axis_xy[0], p_near[:, 1] - axis_xy[1])
    z = p_near[rr < r_in, 2]
    bins = np.arange(zc - window, zc + 1.5 + 1e-9, 0.02)
    h, e = np.histogram(z, bins=bins)
    hs = np.convolve(h, np.ones(5) / 5.0, mode="same")
    ref = np.median(hs[e[:-1] > zc + 0.6]) if (e[:-1] > zc + 0.6).any() else 0
    if ref <= 0:
        return None
    i = len(hs) - 3
    while i > 0 and hs[i - 1] >= 0.25 * ref:
        i -= 1
    return float(e[i]) if i > 0 else None


def local_base(p_near, nz_near, axis_xy, coarse, window=0.6):
    """Local stylobate-top level around a column.

    Horizontal-surface splats (normal within 15 deg of up) in a 0.6-1.3 m annulus give a
    height histogram (2 cm bins, +-window around the coarse plane). Candidate levels are
    peaks holding >= 30% of the largest bin. The base is the candidate at the shaft foot
    (-8..+6 cm), else the shaft foot itself; without a detectable shaft foot it is the
    highest candidate. Returns (level, support, foot).
    """
    rr = np.hypot(p_near[:, 0] - axis_xy[0], p_near[:, 1] - axis_xy[1])
    zc = float(fits.plane_z(coarse["normal"], coarse["point"], np.asarray(axis_xy, float)))
    foot = shaft_foot(p_near, axis_xy, zc, window)
    m = (rr > 0.6) & (rr < 1.3) & (np.abs(nz_near) > np.cos(np.radians(15))) & (np.abs(p_near[:, 2] - zc) < window)
    if m.sum() < 30:
        return (foot if foot is not None else zc), 0, foot
    z = p_near[m, 2]
    bins = np.arange(zc - window, zc + window + 0.02, 0.02)
    h, e = np.histogram(z, bins=bins)
    hs = np.convolve(h, [1, 2, 1], mode="same") / 4.0
    thr = 0.3 * hs.max()
    peaks = [i for i in range(1, len(hs) - 1) if hs[i] >= thr and hs[i] >= hs[i - 1] and hs[i] >= hs[i + 1]]
    centres = [0.5 * (e[i] + e[i + 1]) for i in peaks]
    if foot is not None:
        # Columns stand on their own stylobate blocks; where the neighbouring slabs are
        # lower or lost, the surface around the column is not the column's base. Use the
        # horizontal peak at the shaft foot, else the foot itself.
        near = [c for c in centres if foot - 0.08 <= c <= foot + 0.06]
        if not near:
            return foot, 0, foot
        zpk = max(near)
    elif centres:
        zpk = max(centres)
    else:
        return zc, 0, foot
    sel = np.abs(z - zpk) < 0.03
    return float(np.median(z[sel])), int(sel.sum()), foot


def stylobate_plane(base_pts, rng):
    """RANSAC (2 cm) on points at the column-base level; refines up."""
    n, p0, inl = fits.ransac_plane(base_pts, thresh=0.02, iters=600, rng=rng, max_tilt_deg=5.0)
    return {"normal": n, "point": p0, "inlierFraction": float(inl.mean()), "nInliers": int(inl.sum()), "nRing": int(len(base_pts))}


def thin_edge_points(tree_all, p_all, op_all, seed_xy, base, r=0.7):
    """Survivor counts around a column before/after filtering (L4)."""
    idx = np.asarray(tree_all.query_ball_point(seed_xy, r), dtype=int)
    if len(idx) == 0:
        return {"all": 0, "kept": 0, "keptLow": 0}, idx
    z = p_all[idx, 2]
    band = (z > base + 0.1) & (z < base + 4.0)
    idx = idx[band]
    op = op_all[idx]
    return {"all": int(len(idx)), "kept": int((op > OPACITY_THRESHOLD).sum()), "keptLow": int((op > OPACITY_THRESHOLD_LOW).sum())}, idx


def measure(scan, frame, picks, published, rng=None, n_boot=500, scale_ref=None, log=print):
    rng = np.random.default_rng(7) if rng is None else rng
    M = frame_matrix(frame)
    pf = raw_to_frame(picks, frame)
    allsp = read_all(scan)
    valid = (allsp.scale.max(axis=1) < MAX_SPLAT_SCALE) & np.isfinite(allsp.xyz).all(axis=1) & (np.linalg.norm(allsp.rot, axis=1) > 1e-8)
    allsp = allsp.subset(valid)
    p_all = to_frame(M, allsp.xyz)
    crop = np.asarray(pf["crop"])
    lo, hi = crop.min(axis=0) - 2.0, crop.max(axis=0) + 2.0
    near = (p_all[:, 0] > lo[0]) & (p_all[:, 0] < hi[0]) & (p_all[:, 1] > lo[1]) & (p_all[:, 1] < hi[1])
    allsp = allsp.subset(near)
    p_all = p_all[near]
    op_all = allsp.opacity
    nrm, _, _ = splat_normals(allsp)
    nz_all = nrm @ M[:3, :3].T[:, 2]
    keep = op_all > OPACITY_THRESHOLD
    p, nz = p_all[keep], nz_all[keep]
    low = op_all > OPACITY_THRESHOLD_LOW
    p_low, nz_low = p_all[low], nz_all[low]
    tree = cKDTree(p[:, :2])
    tree_low = cKDTree(p_low[:, :2])
    tree_all = cKDTree(p_all[:, :2])
    log(f"points: {len(p)} kept (op>{OPACITY_THRESHOLD}), {len(p_low)} at op>{OPACITY_THRESHOLD_LOW}, near crop")

    cella = np.asarray(pf["cellaExclude"]) if pf.get("cellaExclude") else None
    coarse = coarse_plane(p, crop, cella, rng)

    # ---------------- columns: local base, thin-edge check, axis
    cols = []
    base_pts = []
    for c in pf["columns"]:
        rec = {"label": c["label"], "status": c["status"], "complete": bool(c.get("complete", False))}
        cols.append(rec)
        if c.get("seed") is None or c["status"] in ("missing", "unresolved"):
            continue
        sd = np.asarray(c["seed"], float)
        idx = np.asarray(tree.query_ball_point(sd, 1.4), dtype=int)
        base, nb, _ = local_base(p[idx], nz[idx], sd, coarse)
        counts, _ = thin_edge_points(tree_all, p_all, op_all, sd, base)
        rec["survivors"] = counts
        use_low = counts["all"] > 0 and counts["kept"] < 0.5 * counts["all"]
        rec["refilteredLow"] = bool(use_low)
        P, NZ, T = (p_low, nz_low, tree_low) if use_low else (p, nz, tree)
        idx = np.asarray(T.query_ball_point(sd, 1.1), dtype=int)
        q = P[idx]
        top = base + (5.0 if c["status"] == "standing" else 3.0)
        ax = fits.fit_column_axis(q, sd, base, top)
        if ax is None:
            rec["error"] = "axis fit failed"
            continue
        # re-centre the neighbourhood on the fitted axis and refit once
        idx = np.asarray(T.query_ball_point(ax["a0"][:2], 1.4), dtype=int)
        base, nb, foot = local_base(P[idx], NZ[idx], ax["a0"][:2], coarse)
        idx = np.asarray(T.query_ball_point(ax["a0"][:2], 1.1), dtype=int)
        q = P[idx]
        ax2 = fits.fit_column_axis(q, ax["a0"][:2], base, top)
        ax = ax2 or ax
        t = (base - ax["a0"][2]) / ax["u"][2]
        a0 = ax["a0"] + t * ax["u"]
        rec.update({"axisBase": a0.tolist(), "axisDir": ax["u"].tolist(), "axisSlices": ax["nSlices"], "axisSpan": ax["span"], "axisCentreRms": ax["centreRms"], "axisSigmaDeg": float(np.degrees(ax["sigmaRad"])), "baseLevel": base, "baseSupport": nb, "shaftFoot": foot})
        rec["_pts"] = q
        rec["_nz"] = NZ[idx]
        rr = np.hypot(P[:, 0][idx] - a0[0], P[:, 1][idx] - a0[1])
        ring = (rr > 0.6) & (rr < 1.3) & (np.abs(q[:, 2] - base) < 0.03)
        base_pts.append(q[ring])

    plane = stylobate_plane(np.vstack(base_pts), rng)
    log(f"stylobate plane (column-base level): normal tilt {angle_deg(plane['normal'], [0, 0, 1]):.3f} deg, inliers {plane['inlierFraction']:.2f}")

    # ---------------- lower diameter
    for rec in cols:
        if "_pts" not in rec:
            continue
        q, a0, u = rec["_pts"], np.asarray(rec["axisBase"]), np.asarray(rec["axisDir"])
        h, lx, ly = fits.local_coords(q, a0, u)
        dl = fits.lower_diameter(h, lx, ly, LOWER_LEVELS)
        if dl:
            rec["lowerDiameter"] = {"D": dl["D"], "sigma": dl["sigmaD"], "rms": dl["rms"], "nSlices": dl["nSlices"], "method": dl["method"], "fluteDepth": float(np.median([s["d"] for s in dl["slices"]])), "perSlice": [{"level": s["level"], "R": s["R"], "sigmaR": s["sigmaR"], "d": s["d"], "rms": s["rms"], "n": s["n"]} for s in dl["slices"]]}
        sv = rec["survivors"]
        log(f"  col {tuple(rec['label'])} {rec['status']:9s} base {rec['baseLevel']:.3f} surv {sv['kept']}/{sv['all']}{' LOW' if rec['refilteredLow'] else ''} tilt {angle_deg(u, [0, 0, 1]):.2f} D={dl['D'] if dl else float('nan'):.3f}")

    fitted = [r for r in cols if "axisBase" in r]
    if len(fitted) < 4:
        raise RuntimeError(f"only {len(fitted)} columns fitted; cannot continue")

    # ---------------- grid fit
    labels = np.array([r["label"] for r in fitted])
    centres = np.array([r["axisBase"][:2] for r in fitted])
    th0 = _grid_theta_init(pf)
    o0 = _grid_origin_init(pf, th0)
    pubw = {k: published.get(k) for k in ("interaxialFlank", "cornerContractionFlank", "interaxialFront", "cornerContractionFront")}
    init = [o0[0], o0[1], th0, pubw["interaxialFlank"] or 2.5, pubw["cornerContractionFlank"] or 0.2, pubw["interaxialFront"] or 2.5, pubw["cornerContractionFront"] or 0.2]
    g = fits.fit_grid(centres, labels, init)
    for r, res in zip(fitted, g["perColumn"]):
        r["gridResidual"] = float(res)
    gp = g["params"]
    log(f"grid: flank {gp[3]:.4f} (corner -{gp[4]:.4f}), front {gp[5]:.4f} (corner -{gp[6]:.4f}), rms {g['rms']:.3f}")
    grid_dir = np.array([np.cos(gp[2]), np.sin(gp[2]), 0.0])

    # per-side check of the grid (distortion evidence)
    sides = _side_checks(fitted)

    # ---------------- heights (complete standing columns), upper diameter
    for r in fitted:
        if r["status"] != "standing" or not r["complete"]:
            continue
        q = r["_pts"]
        a0, u = np.asarray(r["axisBase"]), np.asarray(r["axisDir"])
        h, lx, ly = fits.local_coords(q, a0, u, ref=grid_dir)
        ch = fits.column_height(h, lx, ly, nz=r["_nz"])
        if ch is None:
            r["heightError"] = "no square abacus signature"
            continue
        r["height"] = {"H": ch["H"], "sigma": ch["sigma"], "estimates": ch["estimates"], "abacusWidth": 2 * ch["abacusHalfWidth"], "restoredAbove": ch["restoredAbove"], "pointsAboveExcluded": ch["pointsAbove"]}
        # upper diameter: 0.65-0.95 m below the abacus top (below the necking)
        levels = np.round(np.arange(ch["H"] - 0.95, ch["H"] - 0.649, 0.05), 3)
        du = fits.diameter_from_slices(h, lx, ly, levels)
        if du:
            r["upperDiameter"] = {"D": du["D"], "sigma": du["sigmaD"], "rms": du["rms"], "nSlices": du["nSlices"]}
        log(f"  height {tuple(r['label'])}: H={ch['H']:.3f} sigma={ch['sigma']:.3f} restoredAbove={ch['restoredAbove']} Du={du['D'] if du else float('nan'):.3f}")

    # ---------------- stylobate edges
    edges = {}
    centroid = crop.mean(axis=0)
    for name, pts in pf["stylobateEdges"].items():
        pts = np.asarray(pts)
        c0, d = fits.fit_line_2d(pts)
        sel = np.abs((p[:, :2] - c0) @ np.array([-d[1], d[0]])) < 1.5
        s_ = (p[sel, :2] - c0) @ d
        sp = (pts - c0) @ d
        sel_idx = np.flatnonzero(sel)[(s_ > sp.min() - 1.2) & (s_ < sp.max() + 1.2)]
        band = p[sel_idx]
        nrm_in = np.array([-d[1], d[0]])
        if np.dot(centroid - c0, nrm_in) < 0:
            nrm_in = -nrm_in
        o_in = (band[:, :2] - c0) @ nrm_in
        # Stylobate-top plane inliers near the edge. RANSAC (2 cm) per 3 m segment of the
        # strip just inside the edge, so a bent scan does not starve one global plane.
        nzb = nz[sel_idx]
        s_b = (band[:, :2] - c0) @ d
        inl = np.zeros(len(band), bool)
        for s_lo in np.arange(sp.min() - 1.2, sp.max() + 1.2, 3.0):
            seg = (s_b >= s_lo) & (s_b < s_lo + 3.0)
            strip = seg & (o_in > 0.05) & (o_in < 1.0) & (np.abs(nzb) > np.cos(np.radians(15)))
            if strip.sum() < 30:
                continue
            try:
                n_l, p_l, _ = fits.ransac_plane(band[strip], thresh=0.02, iters=200, rng=rng, max_tilt_deg=5.0)
            except ValueError:
                continue
            inl |= seg & (np.abs((band - p_l) @ n_l) < 0.02)
        if inl.sum() < 30:
            edges[name] = {"error": "no stylobate points near edge"}
            continue
        e = fits.edge_line(band[inl, :2], pts, centroid, band=1.0)
        if e is None:
            edges[name] = {"error": "too few boundary bins"}
            continue
        edges[name] = e
        log(f"  edge {name}: rms {e['edgeRms']:.4f}, bins {e['nBins']}")

    meas = {}
    long_parts = {}
    if all(k in edges and "point" in edges[k] for k in ("north", "south")):
        W, angW = fits.line_distance(edges["north"], edges["south"])
        rmsW = float(np.sqrt(0.5 * (edges["north"]["edgeRms"] ** 2 + edges["south"]["edgeRms"] ** 2)))
        meas["stylobateWidth"] = {"raw": W, "residual": rmsW, "residualType": "edge_rms", "n": edges["north"]["nBins"] + edges["south"]["nBins"], "edgeAngleDeg": angW}
    if all(k in edges and "point" in edges[k] for k in ("east", "west")):
        L, angL = fits.line_distance(edges["east"], edges["west"])
        rmsL = float(np.sqrt(0.5 * (edges["east"]["edgeRms"] ** 2 + edges["west"]["edgeRms"] ** 2)))
        meas["stylobateLength"] = {"raw": L, "residual": rmsL, "residualType": "edge_rms", "n": edges["east"]["nBins"] + edges["west"]["nBins"], "edgeAngleDeg": angL}
    n_grid = len(fitted)
    sg = g["sigma"]
    meas["interaxialFlank"] = {"raw": float(gp[3]), "residual": g["rms"], "residualType": "grid_rms", "n": n_grid, "uncertaintyRaw": float(sg[3])}
    meas["interaxialFront"] = {"raw": float(gp[5]), "residual": g["rms"], "residualType": "grid_rms", "n": n_grid, "uncertaintyRaw": float(sg[5])}
    meas["cornerContractionFlank"] = {"raw": float(gp[4]), "residual": g["rms"], "residualType": "grid_rms", "n": n_grid, "uncertaintyRaw": float(sg[4])}
    meas["cornerContractionFront"] = {"raw": float(gp[6]), "residual": g["rms"], "residualType": "grid_rms", "n": n_grid, "uncertaintyRaw": float(sg[6])}

    dls = [r["lowerDiameter"] for r in fitted if "lowerDiameter" in r]
    if dls:
        D = np.array([x["D"] for x in dls])
        meas["lowerDiameter"] = {"raw": float(np.median(D)), "residual": float(np.median([x["rms"] for x in dls])), "residualType": "flute_fit_rms", "n": len(dls), "uncertaintyRaw": float(np.sqrt(np.median([x["sigma"] for x in dls]) ** 2 / len(dls) + (1.4826 * np.median(np.abs(D - np.median(D)))) ** 2 / len(dls))), "perColumnSpread": float(np.std(D))}
    # Column-height outliers: a column whose "upper diameter" is not smaller than its lower
    # diameter had the wrong band picked as abacus; then a 3-MAD cut across columns.
    hcols = [r for r in fitted if "height" in r]
    for r in hcols:
        du, dl = r.get("upperDiameter", {}).get("D"), r.get("lowerDiameter", {}).get("D")
        if du is not None and dl is not None and du >= 0.95 * dl:
            r["height"]["rejected"] = "upper diameter >= 0.95 x lower diameter: abacus band misidentified"
    ok = [r for r in hcols if "rejected" not in r["height"]]
    if len(ok) >= 3:
        Hs = np.array([r["height"]["H"] for r in ok])
        med = np.median(Hs)
        mad = 1.4826 * np.median(np.abs(Hs - med)) + 1e-3
        for r in ok:
            if abs(r["height"]["H"] - med) > 3 * mad:
                r["height"]["rejected"] = f"outlier: {r['height']['H'] - med:+.3f} from the median (> 3 MAD)"
    hs = [r["height"] for r in hcols if "rejected" not in r["height"]]
    if hs:
        H = np.array([x["H"] for x in hs])
        mad = 1.4826 * np.median(np.abs(H - np.median(H)))
        meas["columnHeight"] = {"raw": float(np.median(H)), "residual": float(np.median([x["sigma"] for x in hs])), "residualType": "slice_sigma", "n": len(hs), "uncertaintyRaw": float(max(mad, np.median([x["sigma"] for x in hs])) / np.sqrt(len(H))), "perColumnSpread": float(np.std(H))}
    dus = [r["upperDiameter"] for r in fitted if "upperDiameter" in r and "rejected" not in r.get("height", {})]
    if dus:
        Du = np.array([x["D"] for x in dus])
        meas["upperDiameter"] = {"raw": float(np.median(Du)), "residual": float(np.median([x["rms"] for x in dus])), "residualType": "flute_fit_rms", "n": len(dus), "uncertaintyRaw": float(np.std(Du) / np.sqrt(len(Du))) if len(Du) > 1 else float(dus[0]["sigma"])}

    # ---------------- up consensus
    good = [r for r in fitted if r["axisSlices"] >= 10 and r["axisSpan"] > 2.0]
    up_info = {"planeTiltDeg": angle_deg(plane["normal"], [0, 0, 1])}
    if good:
        U = np.array([r["axisDir"] for r in good])
        um = U.mean(axis=0)
        um /= np.linalg.norm(um)
        tilts = np.array([angle_deg(u, um) for u in U])
        sig_c = float(max(np.sqrt(np.mean(tilts**2)) / np.sqrt(len(U)), 0.05))
        R = M[:3, :3]
        up_info["columnAxes"] = {"meanFrame": um.tolist(), "meanRaw": (R.T @ um).tolist(), "sigmaDeg": sig_c, "n": len(U), "scatterDeg": float(np.sqrt(np.mean(tilts**2)))}
        up_info["frameUpVsColumnsDeg"] = angle_deg(um, [0, 0, 1])
        up_info["stylobateNormalVsColumnsDeg"] = angle_deg(um, plane["normal"])
        fu = frame.get("up", {})
        un_raw = fu.get("upNormalsRaw", fu.get("upRaw"))
        if un_raw is not None:
            un_f = R @ np.asarray(un_raw)
            sig_n = float(fu.get("normalSigmaDeg", 1.0))
            from up import consensus_up

            uc, sc, ang = consensus_up(un_f, sig_n, um, sig_c)
            up_info["consensus"] = {"normalsVsColumnsDeg": ang, "withinOneDegree": bool(ang <= 1.0), "consensusFrame": uc.tolist(), "consensusSigmaDeg": sc, "frameUpVsConsensusDeg": angle_deg(uc, [0, 0, 1]), "normalSigmaDeg": sig_n}
        log(f"up: frame vs column mean {up_info['frameUpVsColumnsDeg']:.3f} deg; stylobate normal vs columns {up_info['stylobateNormalVsColumnsDeg']:.3f} deg")

    # ---------------- scale
    scale = fit_scale(meas, published, fitted, edges, init, rng, n_boot, scale_ref)
    log(f"k = {scale['k']:.5f}  95% CI [{scale['ci'][0]:.5f}, {scale['ci'][1]:.5f}]  metric={scale['metric']}")

    keys = decide_all(meas, published, scale)

    survivors = []
    for r in cols:
        if "survivors" in r:
            survivors.append({"label": r["label"], "status": r["status"], "allSplats": r["survivors"]["all"], "keptOpacity05": r["survivors"]["kept"], "keptOpacity02": r["survivors"]["keptLow"], "refilteredLow": r["refilteredLow"]})
    for r in cols:
        r.pop("_pts", None)
        r.pop("_nz", None)
    report = {
        "frameHash": frame["frameHash"],
        "units": "scan units (raw) and metres (scaled/published)",
        "stylobatePlane": {"normalFrame": plane["normal"].tolist(), "pointFrame": plane["point"].tolist(), "inlierFraction": plane["inlierFraction"], "tiltDeg": up_info["planeTiltDeg"]},
        "up": up_info,
        "grid": {"params": {"originX": gp[0], "originY": gp[1], "thetaDeg": float(np.degrees(gp[2])), "interaxialFlank": gp[3], "cornerContractionFlank": gp[4], "interaxialFront": gp[5], "cornerContractionFront": gp[6]}, "rms": g["rms"], "nColumns": n_grid, "sides": sides},
        "edges": {k: ({kk: (vv.tolist() if isinstance(vv, np.ndarray) else vv) for kk, vv in e.items() if kk != "boundaryXY"} if "point" in e else e) for k, e in edges.items()},
        "scale": scale,
        "stylobateEdgeAnglesDeg": {k: meas[k]["edgeAngleDeg"] for k in ("stylobateWidth", "stylobateLength") if k in meas},
        "keys": keys,
        "columns": cols,
        "survivorsPerColumn": survivors,
    }
    return report, {"p": p, "edges": edges, "grid": g, "fitted": fitted, "pf": pf, "plane": plane}


def _grid_theta_init(pf):
    by = {tuple(c["label"]): c for c in pf["columns"] if c.get("seed") is not None}
    pairs = [((0, 0), (0, 11)), ((5, 0), (5, 11))]
    for a, b in pairs:
        if a in by and b in by:
            v = np.asarray(by[b]["seed"]) - np.asarray(by[a]["seed"])
            return float(np.arctan2(v[1], v[0]))
    # fall back: any two seeds in the same row
    rows = {}
    for (r, c), col in by.items():
        rows.setdefault(r, []).append((c, np.asarray(col["seed"])))
    for r, lst in rows.items():
        if len(lst) >= 2:
            lst.sort(key=lambda t: t[0])
            v = lst[-1][1] - lst[0][1]
            if lst[-1][0] != lst[0][0]:
                return float(np.arctan2(v[1], v[0]))
    raise RuntimeError("cannot initialise the grid orientation from picks")


def _grid_origin_init(pf, th):
    by = {tuple(c["label"]): np.asarray(c["seed"]) for c in pf["columns"] if c.get("seed") is not None}
    if (0, 0) in by:
        return by[(0, 0)]
    # crude: average of seeds back-projected with nominal spacing 2.5
    est = []
    d = np.array([np.cos(th), np.sin(th)])
    n = np.array([-np.sin(th), np.cos(th)])
    for (r, c), s in by.items():
        est.append(s - c * 2.5 * d - r * 2.5 * n)
    return np.mean(est, axis=0)


def _side_checks(fitted):
    """Per-row centre-line straightness and spacing: evidence for non-rigid scan distortion."""
    out = {}
    groups = {"north(row0)": [r for r in fitted if r["label"][0] == 0], "south(row5)": [r for r in fitted if r["label"][0] == 5], "east(col0)": [r for r in fitted if r["label"][1] == 0], "west(col11)": [r for r in fitted if r["label"][1] == 11]}
    for name, rs in groups.items():
        if len(rs) < 2:
            continue
        xy = np.array([r["axisBase"][:2] for r in rs])
        idx = np.array([r["label"][1] if "row" in name else r["label"][0] for r in rs], float)
        c, d = fits.fit_line_2d(xy)
        perp = (xy - c) @ np.array([-d[1], d[0]])
        s = (xy - c) @ d
        order = np.argsort(idx)
        span = abs(s[order[-1]] - s[order[0]])
        bays = idx[order[-1]] - idx[order[0]]
        out[name] = {"n": len(rs), "directionDeg": float(np.degrees(np.arctan2(d[1], d[0])) % 180), "straightnessRms": float(np.sqrt(np.mean(perp**2))), "meanPitch": float(span / bays) if bays else None, "labels": [r["label"] for r in rs]}
    return out


def fit_scale(meas, published, fitted, edges, grid_init, rng, n_boot, scale_ref):
    """Single k (scaled = k * raw) on long distances only, 95% CI by bootstrap over columns and edges."""
    keys = [k for k in LONG_KEYS if k in meas and published.get(k)]

    def k_of(vals):
        r = np.array([vals[k] / published[k] for k in keys])
        return float(np.sum(r) / np.sum(r * r))

    k = k_of({kk: meas[kk]["raw"] for kk in keys})
    labels = np.array([r["label"] for r in fitted])
    centres = np.array([r["axisBase"][:2] for r in fitted])
    ks = []
    edge_b = {n: e["boundaryXY"] for n, e in edges.items() if "boundaryXY" in e}
    for _ in range(n_boot):
        vals = {}
        ii = rng.integers(0, len(fitted), len(fitted))
        try:
            gb = fits.fit_grid(centres[ii], labels[ii], grid_init)
            vals["interaxialFlank"], vals["interaxialFront"] = gb["params"][3], gb["params"][5]
        except Exception:  # noqa: BLE001 - degenerate resample
            continue
        lines = {}
        for n, B in edge_b.items():
            jj = rng.integers(0, len(B), len(B))
            c, d = fits.fit_line_2d(B[jj])
            lines[n] = {"point": c, "dir": d, "boundaryXY": B[jj]}
        if "north" in lines and "south" in lines:
            vals["stylobateWidth"] = fits.line_distance(lines["north"], lines["south"])[0]
        if "east" in lines and "west" in lines:
            vals["stylobateLength"] = fits.line_distance(lines["east"], lines["west"])[0]
        if all(kk in vals for kk in keys):
            ks.append(k_of(vals))
    ks = np.array(ks)
    ci = [float(np.percentile(ks, 2.5)), float(np.percentile(ks, 97.5))] if len(ks) > 10 else [k, k]
    out = {"k": k, "ci": ci, "nBoot": int(len(ks)), "fittedOn": keys, "definition": "scaled = k * raw; k minimises sum((k*raw/published - 1)^2) over long distances"}
    if scale_ref:
        pub_m, raw_u = scale_ref
        out = {"k": pub_m / raw_u, "ci": [pub_m / raw_u, pub_m / raw_u], "nBoot": 0, "fittedOn": ["--scale-ref"], "kFromPublished": k, "ciFromPublished": ci, "definition": "user tape reference overrides k"}
    out["metric"] = bool(abs(out["k"] - 1) <= 0.01 and out["ci"][0] <= 1 <= out["ci"][1])
    out["perKeyRatio"] = {kk: meas[kk]["raw"] / published[kk] for kk in keys}
    return out


# ------------------------------------------------------------------ outputs


def write_overlay(path, ctx, report):
    import matplotlib

    matplotlib.use("Agg")
    from render_views import render

    p = ctx["p"]
    crop = np.asarray(ctx["pf"]["crop"])
    lo, hi = crop.min(axis=0) - 1.5, crop.max(axis=0) + 1.5
    ext = [lo[0], hi[0], lo[1], hi[1]]
    m = (p[:, 0] > ext[0]) & (p[:, 0] < ext[1]) & (p[:, 1] > ext[2]) & (p[:, 1] < ext[3])
    q = p[m]
    gp = ctx["grid"]["params"]
    lab = [(r, c) for r in range(6) for c in range(12) if r in (0, 5) or c in (0, 11)]
    nodes = fits.grid_nodes(gp, np.array(lab))

    def draw(ax):
        ax.plot(nodes[:, 0], nodes[:, 1], "+", color="k", ms=8, mew=1.0)
        for r in ctx["fitted"]:
            x, y = r["axisBase"][:2]
            col = "lime" if r["status"] == "standing" else "orange"
            ax.plot(x, y, "o", mfc="none", mec=col, ms=7, mew=1.2)
            ax.text(x, y - 0.75, f"{r['label'][0]},{r['label'][1]}\n{r['gridResidual']:.2f}", fontsize=4.5, ha="center")
        for n, e in ctx["edges"].items():
            if "point" not in e:
                continue
            s0, s1 = e["sRange"]
            B = e["boundaryXY"]
            ax.plot(B[:, 0], B[:, 1], ".", color="red", ms=2)
            t = np.array([-3, 3]) + np.array([0, 0])
            proj = (B - e["point"]) @ e["dir"]
            t = np.array([proj.min() - 1, proj.max() + 1])
            L = e["point"] + np.outer(t, e["dir"])
            ax.plot(L[:, 0], L[:, 1], "r-", lw=0.8)

    render(q[:, 0], q[:, 1], q[:, 2], ext, 0.04, path, "fit result: + grid nodes, o fitted axes (label, grid residual), red = stylobate boundary points + edge lines", "x", "y", grid=1.0, overlay=draw)


def write_markdown(path, report):
    sc = report["scale"]
    L = []
    L.append("# Scan report\n")
    L.append(f"frameHash `{report['frameHash']}`\n")
    L.append(f"k = {sc['k']:.4f} (95% CI {sc['ci'][0]:.4f}..{sc['ci'][1]:.4f}, n_boot {sc['nBoot']}), fitted on {', '.join(sc['fittedOn'])}. Metric: {sc['metric']}.\n")
    if not sc["metric"]:
        L.append("When k != 1: the scan verifies proportions; absolute size is anchored to published values. Long distances are consistent by construction.\n")
    else:
        L.append("The scan's metric scale agrees with published values within the stated CI.\n")
    L.append("| key | raw | scaled | compareTo | published | diff % | residual (type) | uncertainty | n | ratio check | decision |")
    L.append("|---|---|---|---|---|---|---|---|---|---|---|")
    for k, v in report["keys"].items():
        rc = v.get("ratioCheck") or {}
        rcs = f"{rc.get('diffPct', float('nan')):+.1f}% vs {rc.get('against', '')}" if rc else ""
        L.append(f"| {k} | {v['raw']:.4f} | {v['scaled']:.4f} | {v['compareTo']} | {v.get('published')} | {v.get('diffPct', float('nan')):+.2f} | {v['residual']:.4f} ({v['residualType']}) | {v.get('uncertainty', float('nan')):.4f} | {v['n']} | {rcs} | {v['decision']}{' (' + '; '.join(v['reasons']) + ')' if v['reasons'] else ''} |")
    L.append("")
    up = report["up"]
    L.append("## Up axis\n")
    if "consensus" in up:
        c = up["consensus"]
        L.append(f"- normal-based up vs column-axis mean: {c['normalsVsColumnsDeg']:.2f} deg (<= 1 deg: {c['withinOneDegree']}); frame up vs consensus {c['frameUpVsConsensusDeg']:.2f} deg")
    if "columnAxes" in up:
        L.append(f"- column axes: n={up['columnAxes']['n']}, scatter {up['columnAxes']['scatterDeg']:.2f} deg, sigma of mean {up['columnAxes']['sigmaDeg']:.2f} deg; stylobate normal vs columns {up['stylobateNormalVsColumnsDeg']:.2f} deg")
    L.append("")
    L.append("## Grid sides\n")
    for n, s in report["grid"]["sides"].items():
        L.append(f"- {n}: n={s['n']}, direction {s['directionDeg']:.2f} deg, straightness rms {s['straightnessRms']:.3f}, mean pitch {s['meanPitch']}")
    L.append("")
    L.append("## Surviving points per column (r < 0.7, 0.1-4.0 above base)\n")
    L.append("| label | status | all splats | op>0.5 | op>0.2 | refiltered at 0.2 |")
    L.append("|---|---|---|---|---|---|")
    for s in report["survivorsPerColumn"]:
        L.append(f"| {s['label'][0]},{s['label'][1]} | {s['status']} | {s['allSplats']} | {s['keptOpacity05']} | {s['keptOpacity02']} | {s['refilteredLow']} |")
    with open(path, "w") as f:
        f.write("\n".join(L) + "\n")


def _jsonable(o):
    if isinstance(o, dict):
        return {k: _jsonable(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_jsonable(v) for v in o]
    if isinstance(o, np.ndarray):
        return _jsonable(o.tolist())
    if isinstance(o, (np.floating,)):
        return float(o)
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.bool_,)):
        return bool(o)
    if isinstance(o, float) and not np.isfinite(o):
        return None
    return o


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("scan")
    ap.add_argument("--frame", default=str(MEASUREMENTS / "frame.json"))
    ap.add_argument("--picks", default=str(MEASUREMENTS / "picks.json"))
    ap.add_argument("--published", default=str(REPO / "src" / "data" / "dimensions.json"))
    ap.add_argument("--outdir", default=str(MEASUREMENTS))
    ap.add_argument("--scale-ref", help="<published metres>:<raw scan units> tape reference; overrides k")
    ap.add_argument("--bootstrap", type=int, default=500)
    ap.add_argument("--no-images", action="store_true")
    a = ap.parse_args(argv)
    frame = load_frame(a.frame)
    try:
        picks = load_picks(a.picks, frame)
    except FrameMismatch as e:
        print(f"REFUSING TO RUN: {e}", file=sys.stderr)
        return 2
    published = published_values(a.published)
    sr = tuple(float(x) for x in a.scale_ref.split(":")) if a.scale_ref else None
    report, ctx = measure(a.scan, frame, picks, published, n_boot=a.bootstrap, scale_ref=sr)
    os.makedirs(a.outdir, exist_ok=True)
    write_json(os.path.join(a.outdir, "scan-report.json"), _jsonable(report))
    write_markdown(os.path.join(a.outdir, "scan-report.md"), report)
    if not a.no_images:
        write_overlay(os.path.join(a.outdir, "fit-overlay.png"), ctx, report)
    print("report ->", os.path.join(a.outdir, "scan-report.json"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
