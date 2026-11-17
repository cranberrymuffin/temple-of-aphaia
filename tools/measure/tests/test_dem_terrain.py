"""Georeference round trip and DEM resampling on a synthetic GeoTIFF."""
import json
import os

import numpy as np
import pytest

rasterio = pytest.importorskip("rasterio")
from rasterio.transform import from_origin  # noqa: E402

from dem_terrain import Georef, georef_from_osm, grid_heights, open_dem, read_png16, sample_dem, write_png16  # noqa: E402

ORIGIN = (723166.108, 4181578.51)  # UTM 34N, near the temple


def test_frame_utm_lonlat_round_trip():
    g = Georef(ORIGIN, 67.548)
    rng = np.random.default_rng(0)
    x, z = rng.uniform(-3000, 3000, 500), rng.uniform(-3000, 3000, 500)
    e, n = g.frame_to_utm(x, z)
    x2, z2 = g.utm_to_frame(e, n)
    assert np.abs(x2 - x).max() < 1e-6 and np.abs(z2 - z).max() < 1e-6
    lon, lat = g.frame_to_lonlat(x, z)
    x3, z3 = g.lonlat_to_frame(lon, lat)
    assert np.abs(x3 - x).max() < 1e-4 and np.abs(z3 - z).max() < 1e-4
    lon0, lat0 = g.frame_to_lonlat(0.0, 0.0)
    assert abs(lat0 - 37.754) < 0.002 and abs(lon0 - 23.533) < 0.002


def test_axes_orientation():
    g = Georef(ORIGIN, 90.0)  # axis due east: +x east, +z must be south
    e, n = g.frame_to_utm(10.0, 0.0)
    assert e - ORIGIN[0] == pytest.approx(10.0) and n == pytest.approx(ORIGIN[1])
    e, n = g.frame_to_utm(0.0, 10.0)
    assert n - ORIGIN[1] == pytest.approx(-10.0) and e == pytest.approx(ORIGIN[0])


def test_georef_from_osm_rectangle():
    # a 30 x 15 m rectangle rotated to grid bearing 67.5 deg, given in lon/lat
    g = Georef(ORIGIN, 67.5)
    corners = np.array([[15, 7.5], [-15, 7.5], [-15, -7.5], [15, -7.5], [15, 7.5]])
    lon, lat = g.frame_to_lonlat(corners[:, 0], corners[:, 1])
    osm = {"elements": [{"type": "way", "id": 613801136, "geometry": [{"lon": a, "lat": b} for a, b in zip(lon, lat)]}]}
    t = georef_from_osm(osm)
    assert abs(t["bearingGrid"] - 67.5) < 1e-6
    assert np.allclose(t["centroidEN"], ORIGIN, atol=1e-4)
    assert abs(t["length"] - 30) < 1e-4 and abs(t["width"] - 15) < 1e-4


def plane(lon, lat):
    # a smooth analytic surface in degrees: plane + gentle quadratic
    return 100.0 + 5000.0 * (lon - 23.5) - 3000.0 * (lat - 37.75) + 2e5 * (lon - 23.53) ** 2


@pytest.fixture
def synthetic_dem(tmp_path):
    res = 1.0 / 3600.0
    west, north, n = 23.50, 37.78, 200
    tr = from_origin(west, north, res, res)
    cols, rows = np.meshgrid(np.arange(n), np.arange(n))
    lon = west + (cols + 0.5) * res
    lat = north - (rows + 0.5) * res
    path = tmp_path / "dem.tif"
    with rasterio.open(path, "w", driver="GTiff", height=n, width=n, count=1, dtype="float32", crs="EPSG:4326", transform=tr) as ds:
        ds.write(plane(lon, lat).astype(np.float32), 1)
    return str(path)


def test_resampling_matches_analytic_surface(synthetic_dem):
    ds = open_dem(synthetic_dem)
    g = Georef(ORIGIN, 67.5)
    H, m = grid_heights(ds, g, size=600.0, cell=10.0)
    c = m["x0"] + (np.arange(m["nx"]) + 0.5) * m["cell"]
    X, Z = np.meshgrid(c, c)
    lon, lat = g.frame_to_lonlat(X, Z)
    truth = plane(lon, lat)
    err = np.abs(H - truth)
    assert err.max() < 0.05  # float32 storage + cubic on a quadratic
    # single-point sampling agrees with the grid
    assert abs(sample_dem(ds, [lon[5, 7]], [lat[5, 7]])[0] - H[5, 7]) < 1e-3  # window-dependent spline prefilter


def test_png16_round_trip(tmp_path):
    H = np.random.default_rng(2).uniform(-180, 60, (50, 60))
    zmin, zmax = write_png16(tmp_path / "h.png", H)
    H2 = read_png16(tmp_path / "h.png", zmin, zmax)
    assert np.abs(H2 - H).max() <= (zmax - zmin) / 65535 / 2 + 1e-9


def test_committed_georef_consistent():
    p = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), "measurements", "georef.json")
    if not os.path.exists(p):
        pytest.skip("georef.json not generated")
    with open(p) as f:
        g = json.load(f)
    assert 60 < g["axisBearing"]["true"] < 80  # east front faces ENE
    assert abs(g["origin"]["lat"] - 37.754) < 0.002 and abs(g["origin"]["lon"] - 23.533) < 0.002
    assert "Copernicus WorldDEM-30" in g["attribution"]
