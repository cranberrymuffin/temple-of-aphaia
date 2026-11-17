"""Check the temple frame and the sanctuary layout against the Hellenic Cadastre orthophoto.

Imagery: Ktimatologio open WMS (http://gis.ktimanet.gr/wms/wmsopen/wmsserver.aspx, layer
BASEMAP, EPSG:2100 = GGRS87 / Greek Grid). Terms (gis.ktimanet.gr/cachenascommon/oroi.pdf):
no distribution policy has been announced; any commercial use or exploitation of the viewing
service is expressly forbidden. So the image and any overlay stay in refs/ortho/
(gitignored); only numbers are committed.

  ortho_check.py fetch OUTDIR                    GetMap 150 x 150 m around the temple (0.1 m/px request)
  ortho_check.py check IMAGE.png BBOX.txt [--picks measurements/ortho-picks.json]
                 [--sanctuary src/data/sanctuary.json] [--georef measurements/georef.json]
                 [--overlay refs/ortho/ortho-overlay.png] [--out measurements/ortho-check.json]

Frames: temple frame (x toward the east front, z temple south) <-> UTM 34N via georef.json,
UTM 34N <-> EPSG:2100 via pyproj.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np  # noqa: E402
from pyproj import Transformer  # noqa: E402

from common import MEASUREMENTS, REPO, read_json, write_json  # noqa: E402
from dem_terrain import Georef  # noqa: E402

WMS = "http://gis.ktimanet.gr/wms/wmsopen/wmsserver.aspx"
# Features of sanctuary.json that could not be identified in the photo, with the reason.
NOT_IDENTIFIED = {
    "altar": "foundation not separable from the ruin field east of the ramp at 0.5 m GSD (several candidate gray bands, none clearly 13 x 2.6 m)",
    "altar-court": "no clear outline",
    "paved-way": "no clear edges (gravel and blocks)",
    "propylon": "south of the terrace edge the ruins are dense; a wall angle near the model's south-wall turn is visible but cannot be matched to the propylon walls with confidence",
    "terrace-wall-se": "the east part of the south wall: a wall angle near frame (36-41, 17-21) is visible but ambiguous",
    "se-rooms-ii-iv": "walls visible with the model's orientation (NW-SE), overlap within about 2-3 m, but individual rooms are not resolvable",
    "se-bath": "not resolvable",
    "cistern": "not visible (small shaft, ruins and trees around)",
    "settling-basin": "not visible",
    "water-channel": "not visible",
    "votive-column": "not visible",
    "base-north": "not separable",
    "base-south": "not separable",
    "lower-south-wall": "under tree canopy",
    "suedbau-north-wall": "under tree canopy / outside the clear area",
    "fence-wall": "not visible",
}
TERMS = "http://gis.ktimanet.gr/cachenascommon/oroi.pdf"
UA = "generic-client/1.0"
_U2G = Transformer.from_crs("EPSG:32634", "EPSG:2100", always_xy=True)
_G2U = Transformer.from_crs("EPSG:2100", "EPSG:32634", always_xy=True)
_L2G = Transformer.from_crs("EPSG:4326", "EPSG:2100", always_xy=True)


class FrameGreekGrid:
    """Temple frame (x, z) <-> EGSA87 / EPSG:2100 (E, N)."""

    def __init__(self, georef):
        self.geo = Georef((georef["origin"]["utmE"], georef["origin"]["utmN"]), georef["axisBearing"]["grid"])

    def to_egsa(self, x, z):
        return _U2G.transform(*self.geo.frame_to_utm(x, z))

    def from_egsa(self, e, n):
        return self.geo.utm_to_frame(*_G2U.transform(e, n))

    def axis_bearing_egsa(self):
        e0, n0 = self.to_egsa(0.0, 0.0)
        e1, n1 = self.to_egsa(100.0, 0.0)
        return float(np.degrees(np.arctan2(e1 - e0, n1 - n0)) % 360)


def fetch(outdir, georef, half=75.0, px=1500):
    fg = FrameGreekGrid(georef)
    e, n = fg.to_egsa(0.0, 0.0)
    bbox = (e - half, n - half, e + half, n + half)
    q = {"SERVICE": "WMS", "VERSION": "1.1.0", "REQUEST": "GetMap", "LAYERS": "BASEMAP", "STYLES": "", "SRS": "EPSG:2100", "BBOX": ",".join(f"{v:.1f}" for v in bbox), "WIDTH": px, "HEIGHT": px, "FORMAT": "image/png"}
    os.makedirs(outdir, exist_ok=True)
    req = urllib.request.Request(WMS + "?" + urllib.parse.urlencode(q), headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
    with open(os.path.join(outdir, "ortho.png"), "wb") as f:
        f.write(data)
    with open(os.path.join(outdir, "bbox.txt"), "w") as f:
        f.write(",".join(f"{v:.1f}" for v in bbox))
    return bbox


# ------------------------------------------------------------------ model geometry


def _rect(c, length, width, rot_deg):
    """Rectangle in the frame: length along x, width along z, rotated by rot_deg about +y
    (three.js convention: positive turns +x toward -z, i.e. counter-clockwise from above)."""
    a = np.radians(rot_deg)
    ex = np.array([np.cos(a), -np.sin(a)])
    ez = np.array([np.sin(a), np.cos(a)])
    h = [(1, 1), (-1, 1), (-1, -1), (1, -1), (1, 1)]
    return np.array([np.asarray(c) + sx * length / 2 * ex + sz * width / 2 * ez for sx, sz in h])


def _val(v):
    return v["value"] if isinstance(v, dict) else v


def feature_shapes(sanct):
    """{id: {"kind", "lines": [polyline arrays], "centre": (x, z)}} from sanctuary.json."""
    out = {}
    for fid, f in sanct["features"].items():
        lines = []
        if "polyline" in f:
            lines.append(np.array(f["polyline"], float))
        if "polygon" in f:
            p = np.array(f["polygon"], float)
            lines.append(np.vstack([p, p[:1]]))
        if "center" in f:
            c = np.array(f["center"], float)
            if f.get("shape") == "circle" or "diameter" in f or "baseDiameter" in f:
                d = _val(f.get("diameter") or f.get("baseDiameter"))
                t = np.linspace(0, 2 * np.pi, 33)
                lines.append(np.column_stack([c[0] + d / 2 * np.cos(t), c[1] + d / 2 * np.sin(t)]))
            elif "length" in f and "width" in f:
                lines.append(_rect(c, _val(f["length"]), _val(f["width"]), f.get("rotation", 0) or 0))
        if not lines:
            continue
        allp = np.vstack(lines)
        out[fid] = {"kind": f.get("kind"), "lines": lines, "centre": allp.mean(axis=0) if "center" not in f else np.array(f["center"], float)}
    return out


TEMPLE = {"lowestStep": (15.25, 7.75), "stylobate": (14.4, 6.9)}


def temple_lines():
    return {k: np.array([[sx * hx, sz * hz] for sx, sz in ((1, 1), (-1, 1), (-1, -1), (1, -1), (1, 1))]) for k, (hx, hz) in TEMPLE.items()}


# ------------------------------------------------------------------ image analysis


def load_image(path, bbox):
    from PIL import Image

    im = np.asarray(Image.open(path).convert("RGB")).astype(float)
    x0, y0, x1, y1 = bbox
    h, w = im.shape[:2]
    return im, (x1 - x0) / w, (y1 - y0) / h


def pixel_frame_coords(bbox, shape, fg, step=1):
    x0, y0, x1, y1 = bbox
    h, w = shape
    jj, ii = np.meshgrid(np.arange(0, w, step), np.arange(0, h, step))
    E = x0 + (jj + 0.5) * (x1 - x0) / w
    N = y1 - (ii + 0.5) * (y1 - y0) / h
    fx, fz = fg.from_egsa(E.ravel(), N.ravel())
    return ii.ravel(), jj.ravel(), fx, fz


def edge_profiles(grey, bbox, fg, thr=240.0, step=2):
    """Fraction of non-gravel pixels (grey < thr) along x (|z| < 5) and across z (|x| < 10)."""
    ii, jj, fx, fz = pixel_frame_coords(bbox, grey.shape, fg, step)
    dark = (grey[ii, jj] < thr).astype(float)

    def prof(sel, coord, lo, hi):
        bins = np.arange(lo, hi + 1e-9, 0.5)
        h, _ = np.histogram(coord[sel], bins, weights=dark[sel])
        c, _ = np.histogram(coord[sel], bins)
        return bins[:-1] + 0.25, h / np.maximum(c, 1)

    return prof(np.abs(fz) < 5, fx, -25, 25), prof(np.abs(fx) < 10, fz, -20, 20)


def half_max_edge(centres, f, start, direction):
    """Walk from `start` outward (direction +-1) and return where f first drops below 0.5."""
    order = np.argsort(centres * direction)
    c, v = centres[order], f[order]
    k = np.searchsorted(c * direction, start * direction)
    for i in range(k, len(c) - 1):
        if v[i] >= 0.5 > v[i + 1]:
            t = (v[i] - 0.5) / (v[i] - v[i + 1])
            return float(c[i] + t * (c[i + 1] - c[i]))
    return None


def line_bearing(grey, bbox, fg, p0_frame, s_range, half=1.2, thr=150.0, iters=5):
    """Weighted TLS line through dark pixels in a band around a model line (frame coords),
    returned as a frame-relative angle (deg, + = rotated toward -z) and point."""
    ii, jj, fx, fz = pixel_frame_coords(bbox, grey.shape, fg, 1)
    g = grey[ii, jj]
    p = np.asarray(p0_frame, float)
    d = np.array([1.0, 0.0])
    for _ in range(iters):
        n = np.array([-d[1], d[0]])
        u = (fx - p[0]) * d[0] + (fz - p[1]) * d[1]
        v = (fx - p[0]) * n[0] + (fz - p[1]) * n[1]
        m = (u > s_range[0]) & (u < s_range[1]) & (np.abs(v) < half) & (g < thr)
        w = thr - g[m]
        P = np.column_stack([fx[m], fz[m]])
        c = (P * w[:, None]).sum(axis=0) / w.sum()
        C = ((P - c) * w[:, None]).T @ (P - c)
        _, vec = np.linalg.eigh(C)
        d = vec[:, 1] if vec[0, 1] > 0 else -vec[:, 1]
        p = c
    r = (P - c) @ np.array([-d[1], d[0]])
    return float(np.degrees(np.arctan2(-d[1], d[0]))), c, int(m.sum()), float(np.sqrt(np.average(r**2, weights=w)))


def wall_face_fit(grey, bbox, fg, a, b, thickness, trim=3.0, search=5.0, step=0.5):
    """Terrace edge along a model wall centre line a -> b (frame). The terrace surface is
    bright gravel; outside the wall the ground is darker (wall top, drop, trees). For each
    station along the wall, the edge is the strongest bright->dark step on the outward
    normal within +-search m; a robust line through the edge points gives the photo face.
    Returns the photo face offset from the model INNER face (+ = outward) and the angle."""
    from scipy.ndimage import map_coordinates

    a, b = np.asarray(a, float), np.asarray(b, float)
    d = (b - a) / np.linalg.norm(b - a)
    n = np.array([-d[1], d[0]])
    mid = (a + b) / 2
    if np.dot(-mid, n) > 0:  # outward = away from the temple
        n = -n
    x0, y0, x1, y1 = bbox
    h, w = grey.shape
    L = float(np.linalg.norm(b - a))
    ts = np.arange(-search, search + 1e-9, 0.1)
    pts = []
    for s_ in np.arange(trim, L - trim, step):
        q = a + s_ * d + np.outer(ts, n)
        e, nn = fg.to_egsa(q[:, 0], q[:, 1])
        col = (np.asarray(e) - x0) / (x1 - x0) * w - 0.5
        row = (y1 - np.asarray(nn)) / (y1 - y0) * h - 0.5
        prof = map_coordinates(grey, [row, col], order=1, mode="nearest")
        g = np.gradient(prof)
        k = int(np.argmin(g))  # bright inside -> dark outside
        if g[k] < -3.0:
            pts.append((s_, ts[k], -g[k]))
    if len(pts) < 5:
        return None
    P = np.array(pts)
    keep = np.ones(len(P), bool)
    for _ in range(3):
        A = np.column_stack([np.ones(keep.sum()), P[keep, 0]])
        coef, *_ = np.linalg.lstsq(A, P[keep, 1], rcond=None)
        r = P[:, 1] - (coef[0] + coef[1] * P[:, 0])
        sd = 1.4826 * np.median(np.abs(r[keep])) + 0.05
        keep = np.abs(r) < 2.5 * sd
    A = np.column_stack([np.ones(keep.sum()), P[keep, 0]])
    coef, *_ = np.linalg.lstsq(A, P[keep, 1], rcond=None)
    r = P[keep, 1] - A @ coef
    face_mid = coef[0] + coef[1] * (L / 2)
    return {"offsetFromInnerFaceM": round(float(face_mid + thickness / 2), 2), "angleDeg": round(float(np.degrees(np.arctan(coef[1]))), 2), "rmsM": round(float(np.sqrt(np.mean(r**2))), 2), "stations": int(keep.sum()), "of": int(len(P))}


# ------------------------------------------------------------------ main


def draw_overlay(path, im, bbox, fg, shapes, picks, half=60.0):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    x0, y0, x1, y1 = bbox
    e0, n0 = fg.to_egsa(0.0, 0.0)
    fig, ax = plt.subplots(figsize=(11, 11), dpi=110)
    ax.imshow(im / 255.0, extent=[x0 - e0, x1 - e0, y0 - n0, y1 - n0], interpolation="bilinear")

    def plot(line, col, lw=0.9, ls="-"):
        e, n = fg.to_egsa(line[:, 0], line[:, 1])
        ax.plot(np.asarray(e) - e0, np.asarray(n) - n0, ls, color=col, lw=lw)

    for k, ln in temple_lines().items():
        plot(ln, "red" if k == "lowestStep" else "yellow", 1.0)
    for fid, s in shapes.items():
        for ln in s["lines"]:
            plot(ln, "cyan", 0.7)
        e, n = fg.to_egsa(*s["centre"])
        ax.text(e - e0, n - n0, fid, fontsize=4.5, color="cyan")
    for p in picks:
        ax.plot(p["egsa"][0] - e0, p["egsa"][1] - n0, "x", color="magenta", ms=6)
        ax.text(p["egsa"][0] - e0, p["egsa"][1] - n0 - 1.5, p["id"], fontsize=4.5, color="magenta")
    ax.set_xlim(-half, half)
    ax.set_ylim(-half, half)
    ax.set_xlabel("EGSA87 E offset from the temple origin (m)")
    ax.set_ylabel("EGSA87 N offset (m)")
    ax.set_title("Ktimatologio orthophoto (NOT FOR REDISTRIBUTION) with the model: red lowest step, yellow stylobate, cyan sanctuary.json, magenta photo picks", fontsize=7)
    ax.grid(True, lw=0.2)
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)


def check(image, bbox_path, picks_path, sanct_path, georef_path, overlay_path, out_path):
    georef = read_json(georef_path)
    fg = FrameGreekGrid(georef)
    with open(bbox_path) as f:
        bbox = [float(v) for v in f.read().split(",")]
    im, rx, ry = load_image(image, bbox)
    grey = im.mean(axis=2)
    from scipy.ndimage import gaussian_filter

    (ax_c, ax_f), (az_c, az_f) = edge_profiles(gaussian_filter(grey, 3), bbox, fg)
    west = half_max_edge(ax_c, ax_f, 0.0, -1)
    south = half_max_edge(az_c, az_f, 0.0, +1)
    north_ang, north_pt, north_n, north_rms = line_bearing(gaussian_filter(grey, 4), bbox, fg, (-4.0, -6.3), (-12.0, 4.0))
    sanct = read_json(sanct_path)
    shapes = feature_shapes(sanct)
    sm = gaussian_filter(grey, 2)
    walls = {}
    F = sanct["features"]
    nws = F["terrace-wall-nws"]["polyline"]
    th = _val(F["terrace-wall-nws"]["thickness"])
    for name, a, b in (("terrace south (west of propylon)", nws[0], nws[1]), ("terrace west", nws[1], nws[2]), ("terrace north", nws[2], nws[3])):
        walls[name] = wall_face_fit(sm, bbox, fg, a, b, th)
    se = F["terrace-wall-se"]["polyline"]
    walls["east peribolos (oblique)"] = wall_face_fit(sm, bbox, fg, se[2], se[3], _val(F["terrace-wall-se"]["thickness"]))
    picks = read_json(picks_path)["picks"] if picks_path and os.path.exists(picks_path) else []
    feats = []
    for p in picks:
        fx, fz = fg.from_egsa(*p["egsa"])
        rec = {"id": p["id"], "photo": p.get("what", ""), "photoFrame": [round(float(fx), 2), round(float(fz), 2)], "pickUncertaintyM": p.get("uncertaintyM", 1.0)}
        model = p.get("modelPoint")
        if model is None and p["id"] in shapes:
            model = shapes[p["id"]]["centre"].tolist()
        if model is not None:
            d = np.array([fx, fz]) - np.asarray(model, float)
            rec.update({"modelFrame": [round(float(v), 2) for v in model], "displacement": [round(float(v), 2) for v in d], "distanceM": round(float(np.linalg.norm(d)), 2)})
            tol = float(np.hypot(p.get("uncertaintyM", 1.0), p.get("modelUncertaintyM", 1.0)))
            rec["toleranceM"] = round(tol, 2)
            rec["withinTolerance"] = bool(np.linalg.norm(d) <= tol)
        rec["note"] = p.get("note", "")
        feats.append(rec)
    res = {
        "imagery": {
            "source": "Hellenic Cadastre (Ktimatologio) orthophoto basemap, open WMS " + WMS + " layer BASEMAP, EPSG:2100",
            "date": "not stated by the service",
            "nativeResolutionM": 0.5,
            "nativeResolutionNote": "estimated from the block size of a 5 cm/px request (about 10 px blocks); requested at 0.1 m/px",
            "terms": TERMS,
            "termsSummary": "No distribution policy announced yet; any commercial use or exploitation of the viewing service is expressly forbidden; otherwise ktimatologio.gr terms apply. A watermark ('Ktimatologio') is burnt into the tiles. Imagery and overlay kept in refs/ortho/ (gitignored), not redistributed.",
            "bboxEgsa87": bbox,
            "pixelM": [rx, ry],
        },
        "temple": {
            "axisBearingModelEgsaGrid": round(fg.axis_bearing_egsa(), 3),
            "northColonnadeLine": {"angleVsModelDeg": round(north_ang, 2), "pointFrame": np.round(north_pt, 2).tolist(), "nPixels": north_n, "rmsM": round(north_rms, 2), "note": "dark band of the north colonnade bases (ground level); + = the photo axis is turned toward temple north (counter-clockwise) relative to the model"},
            "westEdgeX": None if west is None else round(west, 2),
            "westEdgeModelX": -15.25,
            "southEdgeZ": None if south is None else round(south, 2),
            "southEdgeModelZ": 7.75,
            "edgeNote": "half-max of the non-gravel fraction (grey < 240); north edge hidden by the colonnade shadows, east edge merged with the ramp foundations, so only west and south are usable; the south edge may be pushed out by fallen drums",
        },
        "terraceWalls": walls,
        "terraceWallsNote": "photo edge = strongest bright-gravel -> dark step across each model wall; offset is measured from the model's inner face at mid-length (+ = photo edge further out), angle = photo edge vs model wall (+ = turned counter-clockwise seen from above)",
        "features": feats,
        "notIdentified": NOT_IDENTIFIED,
    }
    rots = [("temple north colonnade", north_ang, 1.5)] + [(k, v["angleDeg"], 1.0) for k, v in walls.items() if v and v["rmsM"] < 1.0 and "south" not in k]
    w = np.array([1 / r[2] ** 2 for r in rots])
    mean_rot = float(np.sum(w * np.array([r[1] for r in rots])) / w.sum())
    res["summary"] = {
        "templeAlongAxisOffsetM": None if west is None else round(west + 15.25, 2),
        "templeAlongAxisNote": "photo west krepis edge minus the model's (+ = photo further east); the east edge is merged with the ramp",
        "templeAcrossAxisOffsetM": None if south is None else round(south - 7.75, 2),
        "templeAcrossAxisNote": "photo south krepis edge minus the model's (+ = further south); probably widened by fallen drums; the north band sits 1.6 m outside the model column row, so the across-axis centre agrees within about 1 m",
        "rotationEstimatesDeg": [{"from": r[0], "deg": round(float(r[1]), 2)} for r in rots],
        "rotationWeightedMeanDeg": round(mean_rot, 2),
        "rotationNote": "+ = photo turned counter-clockwise from above relative to the model, i.e. the true axis bearing would be this much smaller; the terrace walls come from the 1911 plan registered to the temple, so they test plan + georef together",
        "bearingImpliedTrueDeg": round(float(georef["axisBearing"]["true"] - mean_rot), 2),
        "bearingFromTempleOnlyTrueDeg": round(float(georef["axisBearing"]["true"] - north_ang), 2),
    }
    write_json(out_path, res)
    if overlay_path:
        draw_overlay(overlay_path, im, bbox, fg, shapes, [{"id": p["id"], "egsa": p["egsa"]} for p in picks])
    return res


def main(argv=None):
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("fetch")
    f.add_argument("outdir")
    f.add_argument("--georef", default=str(MEASUREMENTS / "georef.json"))
    c = sub.add_parser("check")
    c.add_argument("image")
    c.add_argument("bbox")
    c.add_argument("--picks", default=str(MEASUREMENTS / "ortho-picks.json"))
    c.add_argument("--sanctuary", default=str(REPO / "src" / "data" / "sanctuary.json"))
    c.add_argument("--georef", default=str(MEASUREMENTS / "georef.json"))
    c.add_argument("--overlay", default=str(REPO / "refs" / "ortho" / "ortho-overlay.png"))
    c.add_argument("--out", default=str(MEASUREMENTS / "ortho-check.json"))
    a = ap.parse_args(argv)
    if a.cmd == "fetch":
        print("bbox", fetch(a.outdir, read_json(a.georef)))
    else:
        r = check(a.image, a.bbox, a.picks, a.sanctuary, a.georef, a.overlay, a.out)
        print(json.dumps(r["temple"], indent=1))
        for x in r["features"]:
            print(x)
    return 0


if __name__ == "__main__":
    sys.exit(main())
