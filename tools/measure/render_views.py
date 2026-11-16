"""Render gridded views in the up-aligned frame for picking (plan Step 2.4).

Outputs (default into measurements/views/):
  topdown.png             height-coloured density, labelled 1 m grid (scan units)
  topdown_slice.png       same, restricted to a height band (--slice) to show column sections
  elev_{xpos,xneg,ypos,yneg}.png   4 elevations
  row_<name>.png          one zoomed elevation per row of columns (needs --rows from picks)
Optional --crop xmin,xmax,ymin,ymax (frame units) limits the region.

Usage: render_views.py scan.ply [--frame measurements/frame.json] [--crop ...] [--outdir ...]
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import matplotlib  # noqa: E402

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

from common import MEASUREMENTS, frame_matrix, load_frame, to_frame  # noqa: E402
from load import load  # noqa: E402


def density_image(u, v, val, extent, res, mode="max"):
    """Rasterise points (u,v) with value val. Returns (count, value) images [rows=v, cols=u]."""
    u0, u1, v0, v1 = extent
    nu = int(np.ceil((u1 - u0) / res))
    nv = int(np.ceil((v1 - v0) / res))
    iu = ((u - u0) / res).astype(int)
    iv = ((v - v0) / res).astype(int)
    m = (iu >= 0) & (iu < nu) & (iv >= 0) & (iv < nv)
    iu, iv, val = iu[m], iv[m], val[m]
    flat = iv * nu + iu
    cnt = np.bincount(flat, minlength=nu * nv).reshape(nv, nu)
    img = np.full(nu * nv, np.nan)
    if mode == "max":
        order = np.argsort(val)
        img[flat[order]] = val[order]  # last write wins = max
    else:
        s = np.bincount(flat, weights=val, minlength=nu * nv)
        with np.errstate(invalid="ignore"):
            img = s / np.bincount(flat, minlength=nu * nv)
    return cnt, img.reshape(nv, nu)


def render(u, v, val, extent, res, path, title, xlabel, ylabel, grid=1.0, label_every=2, overlay=None, vlim=None, dpi=100):
    cnt, img = density_image(u, v, val, extent, res)
    shade = np.log1p(cnt)
    shade = shade / max(shade.max(), 1e-9)
    w = (extent[1] - extent[0]) / res
    h = (extent[3] - extent[2]) / res
    fig_w = min(max(w / dpi, 6), 16)
    fig_h = fig_w * h / w + 0.8
    fig, ax = plt.subplots(figsize=(fig_w, fig_h), dpi=dpi)
    vmin, vmax = vlim if vlim else (np.nanpercentile(img, 2), np.nanpercentile(img, 98))
    cmap = plt.get_cmap("turbo")
    norm = np.clip((img - vmin) / max(vmax - vmin, 1e-9), 0, 1)
    rgb = cmap(np.nan_to_num(norm))[..., :3]
    rgb = rgb * (0.25 + 0.75 * shade[..., None])
    rgb[cnt == 0] = 1.0
    ax.imshow(rgb, origin="lower", extent=extent, interpolation="nearest")
    gx = np.arange(np.ceil(extent[0] / grid) * grid, extent[1] + 1e-9, grid)
    gy = np.arange(np.ceil(extent[2] / grid) * grid, extent[3] + 1e-9, grid)
    for x in gx:
        major = abs(round(x / grid) % (label_every * 5)) == 0
        ax.axvline(x, color="k", lw=0.6 if major else 0.2, alpha=0.6 if major else 0.35)
    for y in gy:
        major = abs(round(y / grid) % (label_every * 5)) == 0
        ax.axhline(y, color="k", lw=0.6 if major else 0.2, alpha=0.6 if major else 0.35)
    ax.set_xticks(gx[:: label_every])
    ax.set_yticks(gy[:: label_every])
    ax.tick_params(labelsize=6)
    plt.setp(ax.get_xticklabels(), rotation=90)
    ax.set_xlim(extent[0], extent[1])
    ax.set_ylim(extent[2], extent[3])
    ax.set_xlabel(xlabel)
    ax.set_ylabel(ylabel)
    ax.set_title(f"{title}  (colour = {'height' if 'top' in title else 'depth'} {vmin:.1f}..{vmax:.1f}, grid {grid} scan units)", fontsize=8)
    if overlay:
        overlay(ax)
    fig.tight_layout()
    fig.savefig(path, dpi=dpi)
    plt.close(fig)


def parse_crop(s):
    return [float(x) for x in s.split(",")] if s else None


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("scan")
    ap.add_argument("--frame", default=str(MEASUREMENTS / "frame.json"))
    ap.add_argument("--crop", help="xmin,xmax,ymin,ymax in frame units")
    ap.add_argument("--zrange", help="zmin,zmax in frame units")
    ap.add_argument("--res", type=float, default=0.05)
    ap.add_argument("--outdir", default=str(MEASUREMENTS / "views"))
    ap.add_argument("--only", default="all", help="comma list: topdown,elev,rows")
    ap.add_argument("--rows", help="row bands for zoomed elevations: name:axis:lo:hi;... (axis x|y = band coordinate)")
    ap.add_argument("--grid", type=float, default=1.0)
    ap.add_argument("--slice", help="z0,z1: also write topdown_slice.png from points in this height band (column cross-sections)")
    a = ap.parse_args(argv)
    os.makedirs(a.outdir, exist_ok=True)
    M = frame_matrix(load_frame(a.frame))
    s, _ = load(a.scan)
    p = to_frame(M, s.xyz)
    crop = parse_crop(a.crop)
    if crop:
        m = (p[:, 0] >= crop[0]) & (p[:, 0] <= crop[1]) & (p[:, 1] >= crop[2]) & (p[:, 1] <= crop[3])
        p = p[m]
    else:
        lo, hi = np.percentile(p, 0.5, axis=0), np.percentile(p, 99.5, axis=0)
        crop = [lo[0], hi[0], lo[1], hi[1]]
    if a.zrange:
        z0, z1 = parse_crop(a.zrange)
        p = p[(p[:, 2] >= z0) & (p[:, 2] <= z1)]
    zlo, zhi = np.percentile(p[:, 2], [0.5, 99.5])
    only = set(a.only.split(","))
    if "all" in only or "topdown" in only:
        render(p[:, 0], p[:, 1], p[:, 2], crop, a.res, os.path.join(a.outdir, "topdown.png"), "topdown", "x", "y", grid=a.grid)
    if a.slice and ("all" in only or "topdown" in only):
        z0, z1 = parse_crop(a.slice)
        m = (p[:, 2] >= z0) & (p[:, 2] <= z1)
        render(p[m, 0], p[m, 1], p[m, 2], crop, a.res, os.path.join(a.outdir, "topdown_slice.png"), f"topdown slice z {z0}..{z1}", "x", "y", grid=a.grid)
    if "all" in only or "elev" in only:
        ext_x = [crop[0], crop[1], zlo, zhi]
        ext_y = [crop[2], crop[3], zlo, zhi]
        render(p[:, 0], p[:, 2], -p[:, 1], ext_x, a.res, os.path.join(a.outdir, "elev_yneg.png"), "elevation from -y", "x", "z", grid=a.grid)
        render(-p[:, 0], p[:, 2], p[:, 1], [-crop[1], -crop[0], zlo, zhi], a.res, os.path.join(a.outdir, "elev_ypos.png"), "elevation from +y (x mirrored)", "-x", "z", grid=a.grid)
        render(p[:, 1], p[:, 2], p[:, 0], ext_y, a.res, os.path.join(a.outdir, "elev_xpos.png"), "elevation from +x", "y", "z", grid=a.grid)
        render(-p[:, 1], p[:, 2], -p[:, 0], [-crop[3], -crop[2], zlo, zhi], a.res, os.path.join(a.outdir, "elev_xneg.png"), "elevation from -x (y mirrored)", "-y", "z", grid=a.grid)
    if a.rows and ("all" in only or "rows" in only):
        for spec in a.rows.split(";"):
            name, axis, lo, hi = spec.split(":")
            lo, hi = float(lo), float(hi)
            if axis == "y":  # band in y, view along y
                m = (p[:, 1] >= lo) & (p[:, 1] <= hi)
                render(p[m, 0], p[m, 2], p[m, 1], [crop[0], crop[1], zlo, zhi], a.res / 2, os.path.join(a.outdir, f"row_{name}.png"), f"row {name} (y in {lo}..{hi})", "x", "z", grid=a.grid / 2, label_every=2)
            else:
                m = (p[:, 0] >= lo) & (p[:, 0] <= hi)
                render(p[m, 1], p[m, 2], p[m, 0], [crop[2], crop[3], zlo, zhi], a.res / 2, os.path.join(a.outdir, f"row_{name}.png"), f"row {name} (x in {lo}..{hi})", "y", "z", grid=a.grid / 2, label_every=2)
    print("views ->", a.outdir)


if __name__ == "__main__":
    main()
