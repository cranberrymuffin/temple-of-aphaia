"""Real landscape heightfields from the Copernicus GLO-30 DEM, in the temple frame.

Temple frame (src/data/resolveDimensions.ts): origin = stylobate centre, x = along the
temple axis toward the east front, z = temple south (x rotated 90 deg clockwise seen from
above), y up. Heights are relative to the stylobate top (y = 0 there).

Georeference: temple outline from OpenStreetMap (way 613801136, building=temple, a JSON
file from the Overpass API passed with --osm): centroid = origin, long-axis grid bearing =
axis. UTM 34N (EPSG:32634) is the planar CRS.

Outputs (default measurements/):
  georef.json            frame <-> UTM 34N / WGS84 transform, sources, uncertainties
  landscape.json/.png    outer heightfield, --outer-size m square, --outer-cell m cells
  hilltop.json/.png      inner heightfield, --inner-size m square, --inner-cell m cells
  landscape-preview.png  hillshade + sea tint + terrace outline from sanctuary-plan.json

PNG16 layout: uint16 grey, z = zMin + v/65535*(zMax-zMin) (no no-data value: the DEM covers
the window). Row i is at frame z = z0 + (i + 0.5) cell (row 0 = the -z side, i.e. temple
north); column j is at frame x = x0 + (j + 0.5) cell (column 0 = temple west).

Usage: dem_terrain.py DEM.tif --osm osm.json [--outdir measurements]
       [--sanctuary measurements/sanctuary-plan.json] [--stylobate-elev M]
"""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402
from pyproj import Geod, Transformer  # noqa: E402
from scipy.ndimage import map_coordinates  # noqa: E402

from common import MEASUREMENTS, read_json, write_json  # noqa: E402

UTM = "EPSG:32634"
TEMPLE_WAY = 613801136
ATTRIBUTION = "produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved"
LIABILITY = "The organisations in charge of the Copernicus programme by law or by delegation do not incur any liability for any use of the Copernicus WorldDEM-30"
LICENCE_URL = "https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Data/DEM/resources/license/License-COPDEM-30.pdf"
STYLOBATE_ABOVE_GROUND = 1.0  # lead's rule: DEM at the temple centroid minus about 1 m (krepis 0.78 m + DSM bias)


# ------------------------------------------------------------------ georeference


class Georef:
    """Frame (x, z) <-> UTM 34N (E, N). bearing_deg = grid bearing of the +x axis."""

    def __init__(self, origin_en, bearing_deg):
        self.o = np.asarray(origin_en, float)
        b = np.radians(bearing_deg)
        self.ex = np.array([np.sin(b), np.cos(b)])  # +x in (E, N)
        self.ez = np.array([np.sin(b + np.pi / 2), np.cos(b + np.pi / 2)])  # +z: clockwise 90 deg
        self.bearing = float(bearing_deg)
        self._to_ll = Transformer.from_crs(UTM, "EPSG:4326", always_xy=True)
        self._from_ll = Transformer.from_crs("EPSG:4326", UTM, always_xy=True)

    def frame_to_utm(self, x, z):
        x, z = np.asarray(x, float), np.asarray(z, float)
        return self.o[0] + x * self.ex[0] + z * self.ez[0], self.o[1] + x * self.ex[1] + z * self.ez[1]

    def utm_to_frame(self, e, n):
        d = np.stack([np.asarray(e, float) - self.o[0], np.asarray(n, float) - self.o[1]], -1)
        return d @ self.ex, d @ self.ez

    def frame_to_lonlat(self, x, z):
        return self._to_ll.transform(*self.frame_to_utm(x, z))

    def lonlat_to_frame(self, lon, lat):
        return self.utm_to_frame(*self._from_ll.transform(lon, lat))


def georef_from_osm(osm, way_id=TEMPLE_WAY):
    el = [e for e in osm["elements"] if e.get("id") == way_id]
    if not el:
        raise ValueError(f"OSM way {way_id} not found")
    g = np.array([[p["lon"], p["lat"]] for p in el[0]["geometry"]])
    if np.allclose(g[0], g[-1]):
        g = g[:-1]
    T = Transformer.from_crs("EPSG:4326", UTM, always_xy=True)
    E, N = T.transform(g[:, 0], g[:, 1])
    P = np.column_stack([E, N])
    c = P.mean(axis=0)
    _, _, vt = np.linalg.svd(P - c, full_matrices=False)
    ax = vt[0]
    # the east front: the end of the long axis with a positive easting component
    if ax[0] < 0:
        ax = -ax
    bearing = float(np.degrees(np.arctan2(ax[0], ax[1])) % 360)
    along = (P - c) @ ax
    across = (P - c) @ np.array([ax[1], -ax[0]])
    return {"centroidEN": c, "bearingGrid": bearing, "length": float(np.ptp(along)), "width": float(np.ptp(across)), "tags": el[0].get("tags", {}), "lonlat": g}


# ------------------------------------------------------------------ DEM sampling


def open_dem(path):
    import rasterio

    ds = rasterio.open(path)
    if ds.crs.to_epsg() != 4326:
        raise ValueError(f"expected an EPSG:4326 DEM, got {ds.crs}")
    return ds


def sample_dem(ds, lon, lat, order=3, pad=8):
    """Bicubic (order 3) sampling of the DEM at lon/lat arrays; reads only the needed window."""
    import rasterio.windows

    inv = ~ds.transform
    col, row = inv * (np.asarray(lon), np.asarray(lat))
    r0, r1 = int(np.floor(row.min())) - pad, int(np.ceil(row.max())) + pad
    c0, c1 = int(np.floor(col.min())) - pad, int(np.ceil(col.max())) + pad
    r0, c0 = max(r0, 0), max(c0, 0)
    r1, c1 = min(r1, ds.height), min(c1, ds.width)
    a = ds.read(1, window=rasterio.windows.Window(c0, r0, c1 - c0, r1 - r0)).astype(np.float64)
    if ds.nodata is not None:
        a[a == ds.nodata] = np.nan
    # pixel centres: rasterio maps the pixel corner to integer indices, centre at +0.5
    return map_coordinates(a, [row - r0 - 0.5, col - c0 - 0.5], order=order, mode="nearest")


def grid_heights(ds, geo, size, cell, order=3):
    n = int(round(size / cell))
    c = -size / 2 + (np.arange(n) + 0.5) * cell
    X, Z = np.meshgrid(c, c)  # rows = z, columns = x
    lon, lat = geo.frame_to_lonlat(X.ravel(), Z.ravel())
    H = sample_dem(ds, lon, lat, order=order).reshape(n, n)
    return H, {"x0": float(-size / 2), "z0": float(-size / 2), "cell": cell, "nx": n, "nz": n}


def write_png16(path, H):
    zmin, zmax = float(np.min(H)), float(np.max(H))
    v = np.round((H - zmin) / max(zmax - zmin, 1e-9) * 65535).astype(np.uint16)
    Image.fromarray(v).save(path, optimize=True)
    return zmin, zmax


def read_png16(path, zmin, zmax):
    v = np.array(Image.open(path)).astype(np.float64)
    return zmin + v / 65535.0 * (zmax - zmin)


# ------------------------------------------------------------------ preview


def hillshade(H, cell, az=315, alt=45):
    gz, gx = np.gradient(H, cell)
    slope = np.arctan(np.hypot(gx, gz))
    # rows run toward +z (south): an image drawn with row 0 at the top has north up only
    # if the temple axis were due east; good enough for a shaded preview
    aspect = np.arctan2(-gx, gz)
    a, h = np.radians(az), np.radians(alt)
    return np.clip(np.sin(h) * np.cos(slope) + np.cos(h) * np.sin(slope) * np.cos(a - aspect), 0, 1)


def preview(path, outer, inner, sea_level, sanct):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, axs = plt.subplots(1, 2, figsize=(14, 7), dpi=90)
    for ax, (H, m, title) in zip(axs, (outer, inner)):
        ext = [m["x0"], m["x0"] + m["nx"] * m["cell"], m["z0"] + m["nz"] * m["cell"], m["z0"]]
        hs = hillshade(H, m["cell"])
        rgb = np.dstack([hs] * 3) * 0.85 + 0.15
        sea = H <= sea_level + 0.5
        rgb[sea] = [0.55, 0.72, 0.9]
        ax.imshow(rgb, extent=ext, interpolation="bilinear")
        cs = ax.contour(np.linspace(ext[0], ext[1], m["nx"]), np.linspace(ext[3], ext[2], m["nz"]), H, levels=np.arange(np.floor(H.min() / 20) * 20, H.max(), 20 if m["cell"] > 5 else 2), colors="sienna", linewidths=0.3)
        ax.clabel(cs, fontsize=4, fmt="%.0f")
        if sanct is not None:
            o = np.array(sanct["wallNetwork"]["outer"])
            ax.plot(o[:, 0], o[:, 1], "-", color="darkorange", lw=0.7)
            for w in sanct["walls"]:
                cl = np.array(w["centreline"])
                ax.plot(cl[:, 0], cl[:, 1], "-", color="red", lw=0.6)
        ax.plot([-14.4, 14.4, 14.4, -14.4, -14.4], [-6.9, -6.9, 6.9, 6.9, -6.9], "k-", lw=0.8)
        ax.set_title(title, fontsize=8)
        ax.set_xlabel("x (m, toward the east front)")
        ax.set_ylabel("z (m, temple south)")
        ax.set_aspect("equal")
    fig.suptitle("Copernicus GLO-30 in the temple frame (heights rel. to the stylobate; blue = sea). Orange/red = sanctuary walls from the 1911 plan, black = stylobate.\n" + ATTRIBUTION, fontsize=7)
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)


# ------------------------------------------------------------------ main


def terrace_mismatch(inner, m, sanct, terrace_y=-0.78):
    """DEM height minus the ancient terrace level (foot of the lowest step) along the wall centre lines."""
    out = {}
    xs = m["x0"] + (np.arange(m["nx"]) + 0.5) * m["cell"]
    zs = m["z0"] + (np.arange(m["nz"]) + 0.5) * m["cell"]
    from scipy.interpolate import RegularGridInterpolator

    f = RegularGridInterpolator((zs, xs), inner, bounds_error=False, fill_value=np.nan)
    for w in sanct["walls"]:
        cl = np.array(w["centreline"])
        L = np.linalg.norm(np.diff(cl, axis=0), axis=1)
        pts = np.vstack([cl[i] + np.outer(np.linspace(0, 1, max(int(Li), 2)), cl[i + 1] - cl[i]) for i, Li in enumerate(L)])
        d = f(pts[:, ::-1]) - terrace_y
        out[w["id"]] = {"mean": round(float(np.nanmean(d)), 2), "min": round(float(np.nanmin(d)), 2), "max": round(float(np.nanmax(d)), 2)}
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("dem")
    ap.add_argument("--osm", required=True, help="Overpass JSON containing the temple way")
    ap.add_argument("--outdir", default=str(MEASUREMENTS))
    ap.add_argument("--sanctuary", default=str(MEASUREMENTS / "sanctuary-plan.json"))
    ap.add_argument("--outer-size", type=float, default=6000.0, help="6 km shows the north and east coasts")
    ap.add_argument("--outer-cell", type=float, default=20.0)
    ap.add_argument("--inner-size", type=float, default=300.0)
    ap.add_argument("--inner-cell", type=float, default=2.0)
    ap.add_argument("--stylobate-elev", type=float, help="absolute stylobate-top elevation (m, EGM2008) from a source; default: derived from the DEM")
    a = ap.parse_args(argv)
    with open(a.osm) as f:
        osm = json.load(f)
    t = georef_from_osm(osm)
    geo = Georef(t["centroidEN"], t["bearingGrid"])
    lon0, lat0 = geo.frame_to_lonlat(0.0, 0.0)
    gd = Geod(ellps="WGS84")
    lon1, lat1 = geo.frame_to_lonlat(100.0, 0.0)
    true_bearing = float(gd.inv(lon0, lat0, lon1, lat1)[0] % 360)
    ds = open_dem(a.dem)
    dem_c = float(sample_dem(ds, [lon0], [lat0])[0])
    if a.stylobate_elev is not None:
        sty, sty_src = a.stylobate_elev, "given on the command line"
    else:
        sty = dem_c - STYLOBATE_ABOVE_GROUND
        sty_src = f"derived: Copernicus GLO-30 (bicubic) at the OSM temple centroid ({dem_c:.2f} m) minus {STYLOBATE_ABOVE_GROUND} m; no primary absolute level found in Furtwaengler 1906 text or the research briefs (Wikipedia: hill about 160 m, secondary)"
    sea = -sty
    outer, mo = grid_heights(ds, geo, a.outer_size, a.outer_cell)
    inner, mi = grid_heights(ds, geo, a.inner_size, a.inner_cell)
    outer -= sty
    inner -= sty
    os.makedirs(a.outdir, exist_ok=True)
    common_meta = {
        "frame": "temple frame: origin stylobate centre, x toward the east front (temple axis), z temple south, y up; see georef.json",
        "datum": "y = 0 at the stylobate top; heights are EGM2008 (about MSL) minus the stylobate elevation",
        "stylobateElevation": round(sty, 2),
        "seaLevelY": round(sea, 2),
        "source": "Copernicus DEM GLO-30 (COP-DEM-GLO-30-F), tile Copernicus_DSM_COG_10_N37_00_E023_00_DEM, a DSM (vegetation and buildings included)",
        "licence": LICENCE_URL,
        "attribution": ATTRIBUTION,
        "liability": LIABILITY,
        "resampling": "bicubic (scipy map_coordinates order 3) at cell centres via frame -> UTM 34N -> WGS84",
        "encoding": "uint16 grey, z = zMin + v/65535*(zMax-zMin); row i at z = z0 + (i+0.5)*cell (row 0 = temple north), column j at x = x0 + (j+0.5)*cell (column 0 = temple west)",
    }
    files = {}
    for name, H, m in (("landscape", outer, mo), ("hilltop", inner, mi)):
        zmin, zmax = write_png16(os.path.join(a.outdir, f"{name}.png"), H)
        meta = dict(common_meta)
        meta.update({"png": f"{name}.png", "origin": {"x0": m["x0"], "z0": m["z0"]}, "cell": m["cell"], "dims": {"nx": m["nx"], "nz": m["nz"]}, "zMin": zmin, "zMax": zmax, "quantisation": (zmax - zmin) / 65535})
        write_json(os.path.join(a.outdir, f"{name}.json"), meta)
        files[name] = os.path.getsize(os.path.join(a.outdir, f"{name}.png"))
    sanct = read_json(a.sanctuary) if os.path.exists(a.sanctuary) else None
    mismatch = terrace_mismatch(inner, mi, sanct) if sanct else None
    land = outer > sea + 0.5
    georef = {
        "crs": {"planar": "UTM zone 34N (EPSG:32634)", "geographic": "WGS84 (EPSG:4326)", "vertical": "EGM2008 (Copernicus DEM)"},
        "origin": {"utmE": round(float(geo.o[0]), 3), "utmN": round(float(geo.o[1]), 3), "lon": round(float(lon0), 7), "lat": round(float(lat0), 7), "elevation": round(sty, 2)},
        "axisBearing": {"grid": round(geo.bearing, 3), "true": round(true_bearing, 3), "meaning": "bearing of the frame +x axis (toward the east front), degrees clockwise from north"},
        "frameToUtm": {"E": "utmE + x*ex[0] + z*ez[0]", "N": "utmN + x*ex[1] + z*ez[1]", "ex": np.round(geo.ex, 9).tolist(), "ez": np.round(geo.ez, 9).tolist()},
        "source": {
            "outline": f"OpenStreetMap way {TEMPLE_WAY} (building=temple, ruins=yes, wikidata Q596988) via the Overpass API; © OpenStreetMap contributors, ODbL",
            "outlineSize": {"length": round(t["length"], 2), "width": round(t["width"], 2), "note": "close to the lowest step (30.5 x 15.5 m), so its centroid is taken as the stylobate centre"},
            "stylobateElevation": sty_src,
            "crossCheck": "expected about 37.754 N, 23.533 E and an east-facing front: met. The OSM archaeological-site polygon (way 273253076) has its long edge at grid bearing 66.5 deg, agreeing with the temple outline. The 1911 sanctuary plan's north arrow is schematic: it implies a near due-east axis (about 20 deg off), so the plan was registered to the temple only and its arrow is not used.",
        },
        "uncertainty": {"originM": 3.0, "bearingDeg": 2.0, "stylobateElevationM": 3.0, "note": "OSM outlines are traced from imagery (metres); DSM at 30 m posting with tree/ruin bias (metres)"},
        "demAtCentroid": round(dem_c, 2),
        "landscapeWindow": {"sizeM": a.outer_size, "heightRange": [round(float(outer.min()), 2), round(float(outer.max()), 2)], "absoluteRange": [round(float(outer.min() + sty), 2), round(float(outer.max() + sty), 2)], "seaFraction": round(float(1 - land.mean()), 3)},
        "hilltopWindow": {"sizeM": a.inner_size, "heightRange": [round(float(inner.min()), 2), round(float(inner.max()), 2)]},
        "terraceVsDem": {"terraceY": -0.78, "byWall": mismatch, "note": "DEM minus the ancient terrace level (foot of the lowest step) along the 1911-plan wall centre lines; positive = DEM above the terrace"},
        "files": files,
        "attribution": ATTRIBUTION,
    }
    write_json(os.path.join(a.outdir, "georef.json"), georef)
    preview(os.path.join(a.outdir, "landscape-preview.png"), (outer, mo, f"{a.outer_size:.0f} m window, {a.outer_cell:g} m cells"), (inner, mi, f"{a.inner_size:.0f} m window, {a.inner_cell:g} m cells"), sea, sanct)
    print(json.dumps({k: georef[k] for k in ("origin", "axisBearing", "demAtCentroid", "landscapeWindow", "hilltopWindow", "terraceVsDem", "files")}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
