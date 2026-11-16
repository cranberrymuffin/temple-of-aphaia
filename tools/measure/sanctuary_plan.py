"""Digitise the sanctuary from the public-domain vector plan (Bibi Saint-Pol 2007, after
the Guide Joanne 1911 pl. 172-173 / Furtwaengler 1906) into the temple frame.

Frame (src/data/resolveDimensions.ts): origin = stylobate centre, x = east (+), z = south (+),
y = up. Output is plan-view (x, z) in metres.

1. Flatten the SVG (all transforms) with svgplan.read.
2. Scale from the 0-20 m scale bar (px per metre).
3. Peristyle column dots (filled orange circles, diameter ~24 px) are matched to the
   resolver's 6 x 12 column grid; a rigid 2D fit (rotation + translation, scale fixed by
   the bar) maps sheet px -> frame metres. A free-scale fit is reported as a cross-check.
4. Every drawn item is classified by colour into a phase and mapped to a feature id
   (FEATURES table, keyed by SVG element id and sub-path index), then written to
   measurements/sanctuary-plan.json with an overlay PNG.

Usage: sanctuary_plan.py PLAN.svg [--grid grid.json] [--out measurements/sanctuary-plan.json]
       [--overlay measurements/sanctuary-overlay.png] [--index-overlay PATH]
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np  # noqa: E402

import svgplan  # noqa: E402
from common import MEASUREMENTS, write_json  # noqa: E402

ORANGE, GREEN, BLUE, BLACK = "#f57900", "#4e9a06", "#204a87", "#000000"

# Resolver grid (src/data/resolveDimensions.ts with src/data/dimensions.json, published
# values): column axis positions in metres. Regenerate with --grid when the data change.
GRID_X = [-13.89, -11.565, -8.995, -6.425, -3.855, -1.285, 1.285, 3.855, 6.425, 8.995, 11.565, 13.89]
GRID_Z = [-6.3, -3.93, -1.31, 1.31, 3.93, 6.3]


def perimeter_nodes(gx=GRID_X, gz=GRID_Z):
    out = []
    for i, x in enumerate(gx):
        for j, z in enumerate(gz):
            if i in (0, len(gx) - 1) or j in (0, len(gz) - 1):
                out.append((x, z))
    return np.array(out)


def scale_bar(items):
    """px per metre from the black scale-bar rectangles between the '0' and '20 m' labels."""
    texts = {it["text"]: it["pts"][0] for it in items if it["kind"] == "text"}
    if "0" not in texts or "20 m" not in texts:
        raise ValueError("scale bar labels not found")
    y0 = texts["0"][1]
    bars = [it for it in items if it["kind"] == "rect" and it["style"].get("stroke") == BLACK and np.ptp(it["pts"][:, 1]) < 25 and 0 < np.min(it["pts"][:, 1]) - y0 < 40]
    xs = np.concatenate([it["pts"][:, 0] for it in bars])
    return float((xs.max() - xs.min()) / 20.0), [float(xs.min()), float(xs.max())], len(bars)


def circles(items, colour, d_lo, d_hi):
    out = []
    for i, it in enumerate(items):
        if it["kind"] != "path" or not it["closed"]:
            continue
        role, c = svgplan.colour(it["style"])
        if role != "fill" or c != colour:
            continue
        span = np.ptp(it["pts"], axis=0)
        if d_lo <= span.mean() <= d_hi and abs(span[0] - span[1]) < 0.15 * span.mean() and len(it["pts"]) >= 12:
            out.append((i, it["pts"][:-1].mean(axis=0), float(span.mean())))
    return out


def rigid_fit(src, dst, scale=None):
    """Least-squares dst ~ s R src + t (2D, det R = +1). scale=None fits s too."""
    cs, cd = src.mean(axis=0), dst.mean(axis=0)
    A, B = src - cs, dst - cd
    U, S, Vt = np.linalg.svd(B.T @ A)
    D = np.diag([1.0, np.sign(np.linalg.det(U @ Vt))])
    R = U @ D @ Vt
    s = float((S * np.diag(D)).sum() / (A**2).sum()) if scale is None else float(scale)
    t = cd - s * R @ cs
    return s, R, t


def apply(s, R, t, pts):
    return s * np.asarray(pts) @ R.T + t


def fit_columns(dots_px, px_per_m, nodes=None, east_hint_px=None):
    """Match plan column dots to the grid nodes. Initial pose from PCA (long axis = x);
    the sign is chosen so east_hint_px (e.g. the altar) lands at +x. ICP with a 1.2 m gate.
    Returns dict with s, R, t (px -> m), residuals and the matched pairs."""
    nodes = perimeter_nodes() if nodes is None else nodes
    P = np.asarray(dots_px, float)
    c = P.mean(axis=0)
    _, _, vt = np.linalg.svd(P - c, full_matrices=False)
    long_ax = vt[0]
    best = None
    for sgn in (1.0, -1.0):
        a = sgn * long_ax
        th = -np.arctan2(a[1], a[0])
        R0 = np.array([[np.cos(th), -np.sin(th)], [np.sin(th), np.cos(th)]])
        s0 = 1.0 / px_per_m
        t0 = -s0 * R0 @ c
        s, R, t = s0, R0, t0
        for _ in range(30):
            Q = apply(s, R, t, P)
            d = np.linalg.norm(Q[:, None, :] - nodes[None, :, :], axis=2)
            j = d.argmin(axis=1)
            ok = d[np.arange(len(P)), j] < 1.2
            # one-to-one: keep the closest dot per node
            keep = np.zeros(len(P), bool)
            for n in np.unique(j[ok]):
                cand = np.flatnonzero(ok & (j == n))
                keep[cand[np.argmin(d[cand, n])]] = True
            if keep.sum() < 6:
                break
            s, R, t = rigid_fit(P[keep], nodes[j[keep]], scale=1.0 / px_per_m)
        Q = apply(s, R, t, P)
        res = np.linalg.norm(Q[keep] - nodes[j[keep]], axis=1)
        east_ok = True
        if east_hint_px is not None:
            east_ok = apply(s, R, t, np.atleast_2d(east_hint_px))[0, 0] > 0
        cand = {"s": s, "R": R, "t": t, "matched": int(keep.sum()), "rms": float(np.sqrt(np.mean(res**2))), "max": float(res.max()), "pairs": (np.flatnonzero(keep), j[keep]), "east_ok": east_ok}
        if best is None or (cand["east_ok"], cand["matched"], -cand["rms"]) > (best["east_ok"], best["matched"], -best["rms"]):
            best = cand
    idx, nj = best["pairs"]
    s_free, R_free, t_free = rigid_fit(P[idx], nodes[nj], scale=None)
    res_free = np.linalg.norm(apply(s_free, R_free, t_free, P[idx]) - nodes[nj], axis=1)
    best["freeScalePxPerM"] = 1.0 / s_free
    best["freeRms"] = float(np.sqrt(np.mean(res_free**2)))
    best["rotationDeg"] = float(np.degrees(np.arctan2(best["R"][1, 0], best["R"][0, 0])))
    best["residuals"] = np.linalg.norm(apply(best["s"], best["R"], best["t"], P[idx]) - nodes[nj], axis=1)
    return best


def load_plan(svg_path):
    items = svgplan.read(svg_path)
    ppm, bar_px, nbar = scale_bar(items)
    peri = circles(items, ORANGE, 21, 27)
    texts = {it["text"]: it["pts"][0] for it in items if it["kind"] == "text"}
    hint = texts.get("Altar of 5th c.")
    fit = fit_columns([c[1] for c in peri], ppm, east_hint_px=hint)
    return items, {"pxPerM": ppm, "barPx": bar_px, "nBarRects": nbar}, peri, fit


# ------------------------------------------------------------------ feature table
# Keys are "<svg id>#<n>": the n-th flattened item carrying that SVG id (document order).
# ids follow ~/.omc/research/aphaia-sanctuary.md section 19. show = c. 490 BC scene
# (user decision: Option A; votive column always shown, flagged uncertain).
FEATURES = {
    "altar": {"label": "Altar of 5th c.", "show": True, "keys": ["path27016#29"], "details": ["path2561#0", "path2549#0"]},
    "altar_court": {"label": "Altar court / pavement outline (unlabelled)", "show": True, "keys": ["path2547#0"], "details": ["path27086#0", "path28072#0", "path28074#0", "path2559#0", "path2557#0", "path27089#0"]},
    "ramp_way": {"label": "Approach ramp", "show": True, "keys": ["path2545#0", "path2543#0"], "details": ["rect3148#0"]},
    "base_north": {"label": "Base (north base foundation)", "show": True, "keys": ["path27016#45"]},
    "base_south": {"label": "Base (south)", "show": True, "keys": ["path27016#33"]},
    "plinth_way": {"label": "Plinth beside the head of the way (unlabelled)", "show": True, "keys": ["path2533#0"]},
    "base_temple_ne": {"label": "Small base at the temple NE corner (unlabelled)", "show": True, "keys": ["rect6407#0"]},
    "propylon": {"label": "Propylon of 5th c.", "show": True, "keys": ["path2575#0", "path2573#0", "path27016#35"], "details": ["path2571#0", "path2569#0", "path2567#0", "path2565#0"], "columns": ["path27016#34", "path27016#36", "path27016#37", "path27016#38"]},
    "se_houses": {"label": "Dwellings of priests (5th c.), with Gantry (Fiechter: priests' and attendants' quarters, not 'Amphipoleion')", "show": True, "note": "key polygons are room interiors (holes of wallNetwork); the walls are the band between them", "keys": [f"path27016#{i}" for i in (2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 14, 15, 22, 23, 24)], "details": ["path4135#0", "path9080#0", "rect3201#0", "rect4177#0", "rect4179#0", "rect4181#0", "rect4192#0", "rect4194#0", "rect4213#0", "rect4213#1", "rect4234#0", "rect4260#0", "path2579#0"]},
    "se_houses_staircase": {"label": "Staircase", "show": True, "keys": [f"path27016#{i}" for i in (12, 13, 16, 17, 18, 19, 20, 21)]},
    "se_houses_bath": {"label": "Bath (borderline date)", "show": True, "keys": [f"path27016#{i}" for i in (26, 27, 28, 30, 31, 32)]},
    "lower_south_wall": {"label": "South outer peribolos (lower south retaining wall)", "show": True, "keys": ["path27016#25"], "details": ["path7058#0"]},
    "fence_wall": {"label": "Short wall running south from the south terrace wall, west of the propylon", "show": True, "keys": ["path9064#2", "path27016#40"]},
    "outer_terrace_structures": {"label": "Unlabelled dashed structures on the outer terrace", "show": True, "keys": ["path9146#0", "path2577#0", "path9064#3"]},
    "cistern": {"label": "Cistern", "show": True, "phase": "7th c. BC", "phaseNote": "blue (7th c.) disc drawn over an orange one: older shaft, reworked in the new campaign (Furtwaengler p. 88)", "keys": ["path7314#0", "path27016#0"]},
    "settling_basin": {"label": "Settling basin (pear-shaped, at the head of the aqueduct)", "show": True, "keys": ["path2555#0"]},
    "water_channel": {"label": "Aqueduct (water channel to the temple's north side)", "show": True, "keys": ["path2537#0", "path2535#0"]},
    "votive_column": {"label": "Votive (sphinx) column", "show": True, "uncertain": "6th c.; that it was spared at the rebuild is only 'not impossible' (Furtwaengler p. 157)", "keys": ["path2553#0"]},
    "north_wall_gap_dashed": {"label": "Reconstructed (dashed) continuation of the north terrace wall toward the east peribolos, by the cave", "show": True, "keys": ["path9064#1", "path9064#0", "path27016#39"]},
    "unlabelled_walls_south_of_temple": {"label": "Unlabelled 5th-c. wall traces south of the temple", "show": True, "keys": ["path6497#0", "path8437#0"]},
    "old_altar_6th": {"label": "Altar of 6th c.", "show": False, "keys": ["rect13159#0"]},
    "old_altar_7th": {"label": "Altar of 7th c.", "show": False, "keys": ["rect20150#0"]},
    "old_propylon": {"label": "Propylon of 6th c.", "show": False, "keys": ["rect7249#0"]},
    "old_peribolos_6th": {"label": "6th-c. peribolos (green, partly dashed)", "show": False, "keys": ["path7277#0", "path16156#0", "path17134#0", "rect13163#0"]},
    "old_peribolos": {"label": "Peribolos of 7th c.", "show": False, "keys": ["rect21180#0"]},
    "old_houses": {"label": "Dwellings of priests (7th c.)", "show": False, "keys": ["rect4281#0", "rect4281#1", "rect4281#2", "rect4281#3", "rect4281#4", "rect4281#5", "rect4281#6", "path10216#0", "path10216#1", "path13224#0", "rect6275#0"]},
    "old_structure_7th": {"label": "Unlabelled 7th-c. foundation near the north base", "show": False, "keys": ["rect7247#0"]},
    "circular_substructions": {"label": "Circular substructions (7th c.)", "show": False, "keys": ["rect2235#0", "path3210#0", "path3290#0", "path3292#0", "path3298#0", "path3304#0"]},
    "temple_plan": {"label": "Temple as drawn on the plan (registration check only, not for building)", "show": False, "keys": ["path2563#0", "path2551#0", "path2541#0", "path2539#0"] + [f"path27016#{i}" for i in (41, 42, 43, 44)], "details": ["path2304#0", "path2306#0", "path2359#0", "path2361#0", "rect2579#0", "rect2581#0", "rect2581#1", "rect2581#2", "rect2573#0"] + [f"path{n}#0" for n in range(2478, 2497, 2)]},
}

# Terrace walls: centre lines from the 5th-c. wall network outline (path27016#1, one filled
# contour). "outer"/"inner" list that contour's vertex indices along each face; the centre
# line is the outer face moved inward by half the wall thickness (mean inner-to-outer
# distance). Where the inner face is broken up by abutting houses only the outer face is used.
WALLS = {
    "terrace_wall_n": {"label": "North terrace wall", "outer": [53, 52], "inner": [50, 51]},
    "terrace_wall_w": {"label": "West terrace wall (the sheet's 'North terrace wall' label runs round this corner)", "outer": [53, 54], "inner": [50, 49]},
    "terrace_wall_s": {"label": "South terrace wall, west of the propylon", "outer": [54, 59], "inner": [49, 48]},
    "terrace_wall_s_east": {"label": "South terrace wall, east of the propylon to the turn", "outer": [8, 7], "inner": [8, 7], "thickness": None},
    "terrace_wall_e": {"label": "East peribolos (oblique: trapezoidal east side of the terrace)", "outer": [3, 2, 0], "inner": [4, 5]},
}


def _dist_to_polyline(p, pl):
    best = np.inf
    for a, b in zip(pl[:-1], pl[1:]):
        ab = b - a
        t = np.clip(np.dot(p - a, ab) / np.dot(ab, ab), 0, 1)
        best = min(best, float(np.linalg.norm(p - (a + t * ab))))
    return best


def wall_centrelines(outline_m, default_thickness):
    out = {}
    for wid, w in WALLS.items():
        outer = outline_m[w["outer"]]
        inner = outline_m[w["inner"]]
        if w.get("thickness", "auto") is None or w["outer"] == w["inner"]:
            th = default_thickness
            face, sign = outer, -1.0  # listed face is the terrace-side face: move outward
        else:
            th = float(np.mean([_dist_to_polyline(p, outer) for p in inner]))
            face, sign = outer, 1.0
        cl = []
        for i, p in enumerate(face):
            a = face[max(i - 1, 0)]
            b = face[min(i + 1, len(face) - 1)]
            d = (b - a) / np.linalg.norm(b - a)
            n = np.array([-d[1], d[0]])
            if np.dot(-p, n) < 0:  # inward = toward the temple (origin)
                n = -n
            cl.append(p + sign * n * th / 2)
        out[wid] = {"label": w["label"], "centreline": np.array(cl), "thickness": th, "length": float(np.sum(np.linalg.norm(np.diff(outer, axis=0), axis=1)))}
    return out


def index_overlay(items, fit, path):
    """Debug/authoring view: every item in metres with its index (to build FEATURES)."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(16, 20), dpi=80)
    for i, it in enumerate(items):
        q = apply(fit["s"], fit["R"], fit["t"], it["pts"])
        if it["kind"] == "text":
            ax.text(q[0, 0], q[0, 1], it["text"], fontsize=7, color="k", alpha=0.5)
            continue
        role, c = svgplan.colour(it["style"])
        if c == BLACK and role == "fill":
            continue
        ax.plot(q[:, 0], q[:, 1], "-", color=c if c.startswith("#") else "gray", lw=0.8)
        m = q.mean(axis=0)
        ax.text(m[0], m[1], str(i), fontsize=5, color="r")
    ax.set_aspect("equal")
    ax.invert_yaxis()
    ax.grid(True, lw=0.3)
    ax.set_xlabel("x (m, east)")
    ax.set_ylabel("z (m, south)")
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)


def item_keys(items):
    seen, keys = {}, []
    for it in items:
        n = seen.get(it.get("id"), 0)
        seen[it.get("id")] = n + 1
        keys.append(f"{it.get('id')}#{n}")
    return keys


def phase_of(it):
    return svgplan.PHASE_BY_COLOUR.get(svgplan.colour(it["style"])[1], "unknown")


def is_dashed(it):
    return it["style"].get("stroke-dasharray", "none") not in ("none", "", "-")


def geometry(it, s, R, t):
    q = apply(s, R, t, it["pts"])
    g = {"type": "polygon" if it["closed"] else "polyline", "points": np.round(q, 3).tolist(), "dashed": is_dashed(it), "phase": phase_of(it)}
    span = np.ptp(q, axis=0)
    if it["closed"] and len(q) >= 13 and abs(span[0] - span[1]) < 0.1 * span.mean():
        g.update({"type": "circle", "centre": np.round(q[:-1].mean(axis=0), 3).tolist(), "radius": round(float(span.mean() / 2), 3)})
    return g


def build(svg_path):
    items, bar, peri, fit = load_plan(svg_path)
    s, R, t = fit["s"], fit["R"], fit["t"]
    keys = item_keys(items)
    by_key = dict(zip(keys, items))
    dscale = abs(bar["pxPerM"] / fit["freeScalePxPerM"] - 1.0)

    def unc(pts):
        r = float(np.max(np.linalg.norm(np.asarray(pts), axis=1)))
        return round(float(np.sqrt(fit["rms"] ** 2 + (dscale * r) ** 2)), 3)

    feats, used = [], set()
    for fid, f in FEATURES.items():
        geoms = []
        for role in ("keys", "details", "columns"):
            for k in f.get(role, []):
                if k not in by_key:
                    raise KeyError(f"{fid}: {k} not in the SVG")
                if k in used:
                    raise ValueError(f"{k} assigned twice")
                used.add(k)
                g = geometry(by_key[k], s, R, t)
                g.update({"svgKey": k, "role": role[:-1] if role != "details" else "detail"})
                geoms.append(g)
        main_pts = np.vstack([g["points"] for g in geoms if g["role"] in ("key", "column")])
        phases = sorted({g["phase"] for g in geoms if g["role"] == "key"})
        lo, hi = main_pts.min(axis=0), main_pts.max(axis=0)
        rec = {
            "id": fid,
            "label": f["label"],
            "phase": f.get("phase") or (phases[0] if len(phases) == 1 else phases),
            "show": f["show"],
            "conjectural": all(g["dashed"] for g in geoms if g["role"] == "key"),
            "centroid": np.round((lo + hi) / 2, 3).tolist(),
            "extent": {"min": np.round(lo, 3).tolist(), "max": np.round(hi, 3).tolist()},
            "uncertaintyM": unc(main_pts),
            "geometry": geoms,
        }
        for k in ("uncertain", "phaseNote", "note"):
            if f.get(k):
                rec[k] = f[k]
        feats.append(rec)

    outline = apply(s, R, t, by_key["path27016#1"]["pts"])
    used.add("path27016#1")
    # path27016 is one even-odd compound path: #1 is the outer contour of the connected
    # wall network, and sub-paths lying inside it are holes (rooms, propylon passages).
    import fits

    holes = []
    for k, it in by_key.items():
        if k.startswith("path27016#") and k != "path27016#1":
            q = apply(s, R, t, it["pts"])
            if fits.point_in_polygon(q[:-1].mean(axis=0)[None, :], outline)[0]:
                holes.append({"svgKey": k, "points": np.round(q, 3).tolist()})
    walls = wall_centrelines(outline, default_thickness=None or 1.0)
    wall_recs = [{"id": k, "label": w["label"], "phase": "5th c. BC", "show": True, "thickness": round(w["thickness"], 3), "length": round(w["length"], 3), "centreline": np.round(w["centreline"], 3).tolist(), "uncertaintyM": unc(w["centreline"])} for k, w in walls.items()]
    # terrace: inner faces of the N, W and S walls; east side = the oblique peribolos
    tn = float(outline[[50, 51], 1].mean())
    tw = float(outline[[50, 49], 0].mean())
    ts = float(outline[[49, 48], 1].mean())
    east_inner = outline[[4, 5]]
    # north arrow: line from tail to the arrowhead
    arrow = [it for it, k in zip(items, keys) if k.startswith("path5968")][0]
    head = [it for it, k in zip(items, keys) if k.startswith("path2228")][0]
    hp = apply(s, R, t, head["pts"]).mean(axis=0)
    ap = apply(s, R, t, arrow["pts"])
    tail = ap[np.argmax(np.linalg.norm(ap - hp, axis=1))]
    nvec = hp - tail
    north_dev = float(np.degrees(np.arctan2(nvec[0], -nvec[1])))  # 0 = plan north equals frame -z
    legend = by_key["rect7036#0"]["pts"]
    lmin, lmax = legend.min(axis=0), legend.max(axis=0)

    def in_legend(it):
        return bool(np.all((it["pts"] >= lmin) & (it["pts"] <= lmax)))

    unused = [k for k, it in zip(keys, items) if it["kind"] != "text" and k not in used and not in_legend(it) and svgplan.colour(it["style"])[1] in (ORANGE, GREEN, BLUE) and not any(k == f"{items[c[0]]['id']}#0" for c in peri)]
    meta = {
        "source": "Plan_Aphaia_sanctuary-en.svg, Bibi Saint-Pol 2007, Wikimedia Commons, public domain; after Guide Joanne 1911 pl. 172-173 (after Furtwaengler 1906)",
        "frame": "temple frame of src/data/resolveDimensions.ts: origin = stylobate centre, x = east (+), z = south (+); plan view, metres",
        "scale": {"pxPerM": round(bar["pxPerM"], 4), "from": "0-20 m scale bar", "barPx": [round(v, 2) for v in bar["barPx"]], "columnFitPxPerM": round(fit["freeScalePxPerM"], 4), "disagreementPct": round(100 * dscale, 2)},
        "transform": {"pxToM": {"scale": s, "rotationDeg": round(fit["rotationDeg"], 4), "matrix": np.round(np.hstack([s * R, t[:, None]]), 8).tolist(), "note": "[x, z] = matrix @ [u, v, 1] with (u, v) SVG sheet px after all transforms"}},
        "columnFit": {"matched": fit["matched"], "of": 32, "rmsM": round(fit["rms"], 4), "maxM": round(fit["max"], 4), "rmsFreeScaleM": round(fit["freeRms"], 4), "note": "rigid fit with the bar scale; the free-scale fit's rms shows how much is scale"},
        "northArrowDeviationDeg": round(north_dev, 2),
        "uncertaintyModel": "sqrt(columnFit.rms^2 + (scale disagreement x distance from the stylobate centre)^2), per feature at its farthest point",
        "terrace": {"innerNorthZ": round(tn, 3), "innerSouthZ": round(ts, 3), "innerWestX": round(tw, 3), "eastPeribolosInnerFace": np.round(east_inner, 3).tolist(), "widthNS": round(ts - tn, 3), "lengthEW_atAxis": round(float(np.interp(0.0, east_inner[:, 1], east_inner[:, 0])) - tw, 3)},
        "propylonStairs": "Drawn as three parallel step lines on the NORTH (temple-facing, inner) side of the propylon, inside the south terrace wall; Furtwaengler's text has a stair flight rising from the south (outer side). Conflict recorded, not resolved.",
        "notDrawn": ["Suedbau (outside the sheet)", "west buildings"],
        "unassignedSvgItems": unused,
    }
    columns = {"plan": np.round(apply(s, R, t, np.array([c[1] for c in peri])), 3).tolist(), "residualsM": np.round(fit["residuals"], 3).tolist()}
    return {"meta": meta, "features": feats, "walls": wall_recs, "wallNetwork": {"outer": np.round(outline, 3).tolist(), "holes": holes, "phase": "5th c. BC", "note": "filled region = outer minus holes (even-odd); it is every 5th-c. wall drawn as one band, incl. terrace walls, propylon and SE-house walls"}, "planColumns": columns}, items, fit


def overlay(doc, path):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    col = {"5th c. BC": ORANGE, "6th c. BC": GREEN, "7th c. BC": BLUE}
    fig, ax = plt.subplots(figsize=(10, 9), dpi=110)
    from matplotlib.patches import PathPatch
    from matplotlib.path import Path

    def ring(pts, ccw):
        pts = np.asarray(pts)
        area = 0.5 * np.sum(pts[:-1, 0] * pts[1:, 1] - pts[1:, 0] * pts[:-1, 1])
        return pts if (area > 0) == ccw else pts[::-1]

    rings = [ring(doc["wallNetwork"]["outer"], True)] + [ring(h["points"], False) for h in doc["wallNetwork"]["holes"]]
    verts = np.vstack(rings)
    codes = np.concatenate([[Path.MOVETO] + [Path.LINETO] * (len(r) - 2) + [Path.CLOSEPOLY] for r in rings])
    ax.add_patch(PathPatch(Path(verts, codes), facecolor=ORANGE, alpha=0.45, lw=0))
    for f in doc["features"]:
        for g in f["geometry"]:
            pts = np.array(g["points"])
            c = col.get(g["phase"], "gray")
            alpha = 1.0 if f["show"] else 0.35
            ls = "--" if g["dashed"] else "-"
            if g["type"] == "circle" and not g["dashed"]:
                ax.fill(pts[:, 0], pts[:, 1], color=c, alpha=alpha * 0.8, lw=0)
            else:
                ax.plot(pts[:, 0], pts[:, 1], ls, color=c, lw=0.8, alpha=alpha)
        if f["id"] != "temple_plan":
            ax.text(f["centroid"][0], f["centroid"][1], f["id"], fontsize=5, ha="center", alpha=0.9 if f["show"] else 0.5)
    for w in doc["walls"]:
        cl = np.array(w["centreline"])
        ax.plot(cl[:, 0], cl[:, 1], "-", color="saddlebrown", lw=0.6)
        ax.text(*cl.mean(axis=0), w["id"], fontsize=5, color="saddlebrown")
    # generated temple at true size (resolver): lowest step, stylobate, column circles
    for hx, hz, lw in ((15.25, 7.75, 0.6), (14.4, 6.9, 1.0)):
        ax.plot([-hx, hx, hx, -hx, -hx], [-hz, -hz, hz, hz, -hz], "k-", lw=lw)
    th = np.linspace(0, 2 * np.pi, 24)
    for x, z in perimeter_nodes():
        ax.plot(x + 0.495 * np.cos(th), z + 0.495 * np.sin(th), "k-", lw=0.5)
    pc = np.array(doc["planColumns"]["plan"])
    ax.plot(pc[:, 0], pc[:, 1], "r.", ms=2)
    m = doc["meta"]
    ax.set_title(f"Sanctuary plan in the temple frame (m; x east, z south). Black = generated temple at true size, red = plan column dots.\n"
                 f"scale {m['scale']['pxPerM']} px/m (bar), column fit rms {m['columnFit']['rmsM']} m; faded = hidden at c. 490 BC; dashed = conjectural", fontsize=7)
    ax.set_aspect("equal")
    ax.invert_yaxis()
    ax.grid(True, lw=0.3)
    ax.set_xlabel("x (m, east)")
    ax.set_ylabel("z (m, south)")
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("svg")
    ap.add_argument("--index-overlay")
    ap.add_argument("--out", default=str(MEASUREMENTS / "sanctuary-plan.json"))
    ap.add_argument("--overlay", default=str(MEASUREMENTS / "sanctuary-overlay.png"))
    a = ap.parse_args(argv)
    doc, items, fit = build(a.svg)
    m = doc["meta"]
    print(f"scale {m['scale']['pxPerM']} px/m (bar); column-fit scale {m['scale']['columnFitPxPerM']} px/m ({m['scale']['disagreementPct']}%)")
    print(f"column fit: {m['columnFit']['matched']}/32, rms {m['columnFit']['rmsM']} m, max {m['columnFit']['maxM']} m, rotation {m['transform']['pxToM']['rotationDeg']} deg; north arrow off frame north by {m['northArrowDeviationDeg']} deg")
    print("terrace:", m["terrace"])
    for f in doc["features"]:
        e = f["extent"]
        print(f"  {f['id']:32s} {str(f['phase']):10s} show={f['show']!s:5s} c={f['centroid']} size={np.round(np.subtract(e['max'], e['min']), 2).tolist()} +-{f['uncertaintyM']}")
    for w in doc["walls"]:
        print(f"  {w['id']:32s} t={w['thickness']} L={w['length']}")
    print("unassigned:", m["unassignedSvgItems"])
    write_json(a.out, doc)
    overlay(doc, a.overlay)
    if a.index_overlay:
        index_overlay(items, fit, a.index_overlay)


if __name__ == "__main__":
    main()
