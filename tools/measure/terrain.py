"""Terrain heightfield from the ground splats (Step 3b b).

Grid in the temple frame (frame.json x/y, z shifted so the stylobate top = 0), 0.5 m
cells over the site crop. Per cell, ground = median of the lowest dense 0.3 m layer of
splats with opacity > 0.2 (robust to floaters above and below); cells with < MIN_PTS
splats are empty. A 5x5 NaN-aware median cut removes outlier cells (> 0.5 m off) and
isolated cells (< 4 measured neighbours), then an 11x11 pass at 1 m. The temple
footprint (lowest step + 0.5 m)
is excluded and refilled from its surroundings; holes up to FILL_RADIUS from measured
cells are filled by inverse-distance weighting. Everything farther away stays no-data:
the scan only covers the temple and a few metres around it, so the rest must come from
the published/parametric terrain.

Outputs (default measurements/):
  terrain.json        meta: origin, cell, dims, zMin/zMax (PNG decode), stylobate offset,
                      k and whether it was applied, coverage, mask legend
  terrain.png         16-bit grey; 0 = no data, else z = zMin + (v-1)/65534*(zMax-zMin)
  terrain-mask.png    8-bit: 0 no data, 1 measured, 2 filled (temple footprint), 3 filled hole
  terrain-preview.png colour preview for review

Usage: terrain.py scan.ply [--frame ...] [--report measurements/scan-report.json]
                  [--extent x0,x1,y0,y1] [--cell 0.5] [--outdir measurements]
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402
from scipy.ndimage import distance_transform_edt, generic_filter  # noqa: E402
from scipy.spatial import cKDTree  # noqa: E402

import fits  # noqa: E402
from common import MEASUREMENTS, frame_matrix, load_frame, read_json, to_frame, write_json  # noqa: E402
from load import filter_mask, read_all  # noqa: E402

MIN_PTS = 4
MIN_NEIGHBOURS = 4  # measured cells required in the 5x5 window besides the cell itself
GROUND_OPACITY = 0.2
GROUND_MAX_SCALE = 1.5
OUTLIER_M = 0.5
FILL_RADIUS = 5.0
MASK = {"0": "no data", "1": "measured", "2": "filled: temple footprint", "3": "filled: hole"}


def ground_level(zs, window=0.3, frac=0.5):
    """Lowest dense layer in a cell (zs sorted): the lowest 0.3 m window holding at least
    half as many splats as the densest window; its median. Sparse floaters above or
    below the ground do not move it, unlike a plain low percentile."""
    hi = np.searchsorted(zs, zs + window, side="right")
    cnt = hi - np.arange(len(zs))
    i = int(np.argmax(cnt >= max(MIN_PTS - 1, frac * cnt.max())))
    return float(np.median(zs[i:hi[i]]))


def heightfield(p, extent, cell, footprint=None, min_pts=MIN_PTS):
    """p: (N,3) frame points with z relative to the stylobate top. Returns (Z, mask)."""
    x0, x1, y0, y1 = extent
    nx, ny = int(round((x1 - x0) / cell)), int(round((y1 - y0) / cell))
    ix = np.floor((p[:, 0] - x0) / cell).astype(int)
    iy = np.floor((p[:, 1] - y0) / cell).astype(int)
    ok = (ix >= 0) & (ix < nx) & (iy >= 0) & (iy < ny)
    flat = iy[ok] * nx + ix[ok]
    z = p[ok, 2]
    order = np.lexsort((z, flat))
    flat, z = flat[order], z[order]
    starts = np.flatnonzero(np.r_[True, np.diff(flat) > 0])
    counts = np.diff(np.r_[starts, len(flat)])
    Z = np.full(nx * ny, np.nan)
    for st, cn in zip(starts[counts >= min_pts], counts[counts >= min_pts]):
        Z[flat[st]] = ground_level(z[st:st + cn])
    Z = Z.reshape(ny, nx)
    # outlier cells vs the 5x5 median of measured neighbours
    n_raw = int(np.isfinite(Z).sum())
    med = generic_filter(Z, np.nanmedian, size=5, mode="constant", cval=np.nan)
    nb = generic_filter(np.isfinite(Z).astype(float), np.sum, size=5, mode="constant", cval=0.0)
    Z[(np.abs(Z - med) > OUTLIER_M) | (nb < MIN_NEIGHBOURS + 1)] = np.nan  # isolated cells are floaters
    # second, wider pass catches small floater clusters that survive the 5x5 test
    med11 = generic_filter(Z, np.nanmedian, size=11, mode="constant", cval=np.nan)
    Z[np.abs(Z - med11) > 2 * OUTLIER_M] = np.nan
    mask = np.where(np.isfinite(Z), 1, 0).astype(np.uint8)
    if footprint is not None:
        cx = x0 + (np.arange(nx) + 0.5) * cell
        cy = y0 + (np.arange(ny) + 0.5) * cell
        gx, gy = np.meshgrid(cx, cy)
        inside = fits.point_in_polygon(np.stack([gx.ravel(), gy.ravel()], 1), footprint).reshape(ny, nx)
        Z[inside] = np.nan
        mask[inside] = 2
    # inverse-distance fill of the footprint and of holes near measured cells
    meas = np.isfinite(Z)
    if meas.any():
        dist = distance_transform_edt(~meas) * cell
        todo = ~meas & ((mask == 2) | (dist <= FILL_RADIUS))
        mi = np.argwhere(meas)
        tree = cKDTree(mi)
        ti = np.argwhere(todo)
        if len(ti):
            d, j = tree.query(ti, k=8)
            w = 1.0 / np.maximum(d, 1e-6) ** 2
            vals = Z[mi[j, 0], mi[j, 1]]
            Z[ti[:, 0], ti[:, 1]] = (w * vals).sum(axis=1) / w.sum(axis=1)
            mask[ti[:, 0], ti[:, 1]] = np.where(mask[ti[:, 0], ti[:, 1]] == 2, 2, 3)
    mask[~np.isfinite(Z)] = 0
    heightfield.last_stats = {"cellsWithData": n_raw, "cellsAfterOutlierCut": int((mask == 1).sum())}
    return Z, mask


def encode_png16(Z):
    fin = np.isfinite(Z)
    zmin, zmax = (float(np.nanmin(Z)), float(np.nanmax(Z))) if fin.any() else (0.0, 1.0)
    span = max(zmax - zmin, 1e-6)
    v = np.zeros(Z.shape, np.uint16)
    v[fin] = (1 + np.round((Z[fin] - zmin) / span * 65534)).astype(np.uint16)
    return v, zmin, zmax


def decode_png16(v, zmin, zmax):
    v = np.asarray(v).astype(np.float64)
    Z = zmin + (v - 1) / 65534.0 * (zmax - zmin)
    Z[v == 0] = np.nan
    return Z


def write_outputs(outdir, Z, mask, meta):
    os.makedirs(outdir, exist_ok=True)
    v, zmin, zmax = encode_png16(Z)
    # PNG rows run north (top) to south: flip so row 0 = max y
    Image.fromarray(v[::-1].astype(np.uint16)).save(os.path.join(outdir, "terrain.png"), optimize=True)
    Image.fromarray(mask[::-1]).save(os.path.join(outdir, "terrain-mask.png"), optimize=True)
    meta = dict(meta)
    meta.update({"zMin": zmin, "zMax": zmax, "encoding": "terrain.png: uint16 grey, 0 = no data, z = zMin + (v-1)/65534*(zMax-zMin); row 0 = north edge (max y), column 0 = west edge (min x)", "mask": "terrain-mask.png (same layout)", "maskLegend": MASK})
    write_json(os.path.join(outdir, "terrain.json"), meta)
    return meta


def preview(path, Z, mask, extent, footprint=None):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(9, 8), dpi=90)
    im = ax.imshow(Z, origin="lower", extent=extent, cmap="terrain")
    ax.contour(np.where(mask == 3, 1, 0), levels=[0.5], origin="lower", extent=extent, colors="k", linewidths=0.4)
    if footprint is not None:
        ax.plot(*np.vstack([footprint, footprint[:1]]).T, "r-", lw=0.8)
    fig.colorbar(im, ax=ax, label="height above stylobate top (m)")
    ax.set_title("terrain heightfield (white = no scan data; red = temple footprint, refilled; black = filled holes)", fontsize=7)
    ax.grid(True, lw=0.3)
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)


def temple_from_report(report):
    """Stylobate corners from the four fitted edge lines, the footprint polygon (lowest step
    + 0.5 m) and the stylobate-top level (median column base level)."""
    E = report["edges"]

    def inter(a, b):
        pa, da = np.asarray(E[a]["point"]), np.asarray(E[a]["dir"])
        pb, db = np.asarray(E[b]["point"]), np.asarray(E[b]["dir"])
        A = np.array([da, -db]).T
        t = np.linalg.solve(A, pb - pa)
        return pa + t[0] * da

    pairs = [("north", "east"), ("north", "west"), ("south", "west"), ("south", "east")]
    corners = np.array([inter(a, b) for a, b in pairs])
    c = corners.mean(axis=0)
    off = 0.85 + 0.5  # lowest step (30.5 vs 28.8 m published) + margin
    fp = np.array([cc + off * (np.asarray(E[a]["outward"]) + np.asarray(E[b]["outward"])) for cc, (a, b) in zip(corners, pairs)])
    bases = [col["baseLevel"] for col in report["columns"] if "baseLevel" in col]
    return corners, c, fp, float(np.median(bases)), float(np.percentile(bases, 90) - np.percentile(bases, 10))


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("scan")
    ap.add_argument("--frame", default=str(MEASUREMENTS / "frame.json"))
    ap.add_argument("--report", default=str(MEASUREMENTS / "scan-report.json"))
    ap.add_argument("--extent", help="x0,x1,y0,y1 in frame units (default: 90 x 80 m centred on the stylobate)")
    ap.add_argument("--cell", type=float, default=0.5)
    ap.add_argument("--outdir", default=str(MEASUREMENTS))
    a = ap.parse_args(argv)
    frame = load_frame(a.frame)
    report = read_json(a.report)
    if report["frameHash"] != frame["frameHash"]:
        print("REFUSING TO RUN: scan-report.json was measured in a different frame", file=sys.stderr)
        return 2
    corners, centre, fp, z_sty, z_spread = temple_from_report(report)
    allsp = read_all(a.scan)
    # ground is seen obliquely and far from the cameras: accept fainter and larger splats
    s = allsp.subset(filter_mask(allsp, opacity_threshold=GROUND_OPACITY, max_scale=GROUND_MAX_SCALE))
    p = to_frame(frame_matrix(frame), s.xyz)
    p[:, 2] -= z_sty
    ext = [float(v) for v in a.extent.split(",")] if a.extent else [round(centre[0] - 45), round(centre[0] + 45), round(centre[1] - 40), round(centre[1] + 40)]
    Z, mask = heightfield(p, ext, a.cell, footprint=fp)
    k = report["scale"]["k"]
    meta = {
        "frameHash": frame["frameHash"],
        "frame": "measurements/frame.json; x = temple long axis (+x east), y = +north, z up",
        "origin": {"x": ext[0], "y": ext[2], "note": "south-west corner of cell (0,0) in frame units"},
        "cell": a.cell,
        "dims": {"nx": int(Z.shape[1]), "ny": int(Z.shape[0])},
        "extent": ext,
        "stylobateTopFrameZ": z_sty,
        "stylobateTopSpread": z_spread,
        "stylobateCentreXY": centre.tolist(),
        "stylobateCornersXY": corners.tolist(),
        "templeFootprintXY": fp.tolist(),
        "k": k,
        "kApplied": False,
        "kNote": "scan counted as metric (|k-1| <= 1% and CI contains 1); heights/positions are raw scan units = metres. The scan is non-rigidly distorted (see REPORT.md): expect decimetre-level errors away from the temple.",
        "coverage": {"measured": float((mask == 1).mean()), "filledFootprint": float((mask == 2).mean()), "filledHoles": float((mask == 3).mean()), "noData": float((mask == 0).mean())},
        "cellStats": heightfield.last_stats,
        "method": f"per-cell lowest dense 0.3 m layer (median) of splats with opacity > {GROUND_OPACITY} and max scale < {GROUND_MAX_SCALE} (>= {MIN_PTS}), 5x5 median outlier cut {OUTLIER_M} m, IDW fill of the footprint and of holes within {FILL_RADIUS} m",
    }
    meta = write_outputs(a.outdir, Z, mask, meta)
    preview(os.path.join(a.outdir, "terrain-preview.png"), Z, mask, ext, fp)
    sz = os.path.getsize(os.path.join(a.outdir, "terrain.png"))
    print(f"terrain {meta['dims']} cells, z {meta['zMin']:.2f}..{meta['zMax']:.2f}, coverage {meta['coverage']}, terrain.png {sz} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
