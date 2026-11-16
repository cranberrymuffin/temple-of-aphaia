"""Bind picks to the frame (plan Step 2.5).

Picks are authored in the up-aligned frame (measurements/picks-frame.json, read off the
gridded views) and stored in RAW scan coordinates with the frameHash used
(measurements/picks.json). measure_from_picks.py refuses to run when the current
frame.json hash differs.

  save_picks.py scan.ply                  picks-frame.json -> picks.json (+ picks-overlay.png)
  save_picks.py scan.ply --rebind         explicit re-projection after frame.json changed:
                                          raw picks are kept, picks-frame.json is re-derived
                                          in the new frame and picks.json is re-bound to it.
  save_picks.py --no-overlay ...          skip the overlay render (tests)
"""
from __future__ import annotations

import argparse
import copy
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np  # noqa: E402

from common import MEASUREMENTS, frame_matrix, load_frame, read_json, to_frame, to_raw, validate_column_labels, write_json  # noqa: E402

SEED_Z = 0.0  # frame height given to 2D picks when lifted to 3D raw points


def _lift(M, xy, z=SEED_Z):
    xy = np.asarray(xy, float).reshape(-1, 2)
    p = np.column_stack([xy, np.full(len(xy), z)])
    return to_raw(M, p)


def frame_to_raw(picks_frame, frame):
    """Convert an authoring dict (frame xy) to the stored raw-coordinate dict."""
    M = frame_matrix(frame)
    validate_column_labels(picks_frame["columns"])
    out = {
        "coords": "raw",
        "frameHash": frame["frameHash"],
        "convention": picks_frame.get("convention", ""),
        "crop": _lift(M, picks_frame["crop"]).tolist(),
        "cellaExclude": _lift(M, picks_frame["cellaExclude"]).tolist() if picks_frame.get("cellaExclude") else None,
        "columns": [],
        "stylobateEdges": {k: _lift(M, v).tolist() for k, v in picks_frame["stylobateEdges"].items()},
        "interior": [],
    }
    for c in picks_frame["columns"]:
        cc = {k: v for k, v in c.items() if k != "seed"}
        cc["seed"] = None if c.get("seed") is None else _lift(M, c["seed"])[0].tolist()
        out["columns"].append(cc)
    for c in picks_frame.get("interior", []):
        cc = {k: v for k, v in c.items() if k != "seed"}
        cc["seed"] = _lift(M, c["seed"])[0].tolist()
        out["interior"].append(cc)
    for k in ("note", "authoredFrom"):
        if k in picks_frame:
            out[k] = picks_frame[k]
    return out


def raw_to_frame(picks_raw, frame):
    """Project stored raw picks into a frame (xy only)."""
    M = frame_matrix(frame)

    def proj(v):
        return to_frame(M, np.asarray(v, float).reshape(-1, 3))[:, :2]

    out = copy.deepcopy(picks_raw)
    out["coords"] = "frame"
    out.pop("frameHash", None)
    out["crop"] = proj(picks_raw["crop"]).tolist()
    if picks_raw.get("cellaExclude"):
        out["cellaExclude"] = proj(picks_raw["cellaExclude"]).tolist()
    out["stylobateEdges"] = {k: proj(v).tolist() for k, v in picks_raw["stylobateEdges"].items()}
    for c in out["columns"]:
        if c.get("seed") is not None:
            c["seed"] = proj(c["seed"])[0].tolist()
    for c in out.get("interior", []):
        c["seed"] = proj(c["seed"])[0].tolist()
    return out


def load_picks(path, frame=None):
    """Load picks.json, validate labels, and (if frame given) enforce the frameHash binding."""
    pk = read_json(path)
    if pk.get("coords") != "raw":
        raise ValueError("picks.json must be stored in raw scan coordinates")
    validate_column_labels(pk["columns"])
    for k, v in pk["stylobateEdges"].items():
        if len(v) < 3:
            raise ValueError(f"stylobate edge {k}: need >= 3 points, got {len(v)}")
    if frame is not None and pk.get("frameHash") != frame["frameHash"]:
        raise FrameMismatch(f"picks frameHash {pk.get('frameHash')} != frame.json {frame['frameHash']}; re-pick or run save_picks.py --rebind")
    return pk


class FrameMismatch(RuntimeError):
    pass


def overlay(scan, frame, picks_frame, out_png):
    import matplotlib

    matplotlib.use("Agg")
    from load import load
    from render_views import render

    M = frame_matrix(frame)
    s, _ = load(scan)
    p = to_frame(M, s.xyz)
    crop = np.asarray(picks_frame["crop"])
    lo, hi = crop.min(axis=0) - 1.5, crop.max(axis=0) + 1.5
    ext = [lo[0], hi[0], lo[1], hi[1]]
    m = (p[:, 0] > ext[0]) & (p[:, 0] < ext[1]) & (p[:, 1] > ext[2]) & (p[:, 1] < ext[3])
    p = p[m]
    colours = {"standing": "lime", "stump": "orange", "missing": "red", "unresolved": "magenta"}

    def draw(ax):
        ax.plot(*np.vstack([crop, crop[:1]]).T, "c--", lw=0.8)
        if picks_frame.get("cellaExclude"):
            ce = np.asarray(picks_frame["cellaExclude"])
            ax.plot(*np.vstack([ce, ce[:1]]).T, "y--", lw=0.6)
        for c in picks_frame["columns"]:
            if c.get("seed") is None:
                continue
            x, y = c["seed"]
            ax.plot(x, y, "o", mfc="none", mec=colours.get(c["status"], "k"), ms=9, mew=1.2)
            ax.text(x, y + 0.55, f"{c['label'][0]},{c['label'][1]}", fontsize=5.5, ha="center", color="k")
        for k, pts in picks_frame["stylobateEdges"].items():
            pts = np.asarray(pts)
            ax.plot(pts[:, 0], pts[:, 1], "x", color="blue", ms=6)
            ax.text(pts[:, 0].mean(), pts[:, 1].mean(), k, fontsize=6, color="blue")
        for c in picks_frame.get("interior", []):
            ax.plot(*c["seed"], "s", mfc="none", mec="purple", ms=6)
            ax.text(c["seed"][0], c["seed"][1] - 0.6, c["label"], fontsize=5, ha="center", color="purple")

    render(p[:, 0], p[:, 1], p[:, 2], ext, 0.04, out_png, "topdown + picks (o column seed: green standing, orange stump, red missing, magenta unresolved; x stylobate edge)", "x", "y", grid=1.0, overlay=draw)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("scan", nargs="?")
    ap.add_argument("--frame", default=str(MEASUREMENTS / "frame.json"))
    ap.add_argument("--authoring", default=str(MEASUREMENTS / "picks-frame.json"))
    ap.add_argument("--out", default=str(MEASUREMENTS / "picks.json"))
    ap.add_argument("--rebind", action="store_true")
    ap.add_argument("--no-overlay", action="store_true")
    ap.add_argument("--overlay-out", default=str(MEASUREMENTS / "picks-overlay.png"))
    a = ap.parse_args(argv)
    frame = load_frame(a.frame)
    if a.rebind:
        raw = read_json(a.out)
        validate_column_labels(raw["columns"])
        pf = raw_to_frame(raw, frame)
        pf["authoredFrom"] = f"re-projected from raw picks (old frameHash {raw.get('frameHash')})"
        write_json(a.authoring, pf)
        raw["frameHash"] = frame["frameHash"]
        write_json(a.out, raw)
        print(f"re-bound {a.out} to frameHash {frame['frameHash']}; re-derived {a.authoring}")
    else:
        pf = read_json(a.authoring)
        raw = frame_to_raw(pf, frame)
        write_json(a.out, raw)
        print(f"wrote {a.out} (raw coords, frameHash {frame['frameHash']})")
    if not a.no_overlay:
        if not a.scan:
            ap.error("scan path required for the overlay (or pass --no-overlay)")
        overlay(a.scan, frame, read_json(a.authoring), a.overlay_out)
        print("overlay ->", a.overlay_out)


if __name__ == "__main__":
    main()
