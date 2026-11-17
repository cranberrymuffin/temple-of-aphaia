"""EPSG:2100 (GGRS87 / Greek Grid) transform used by ortho_check.py."""
import numpy as np
import pytest
from pyproj import Transformer

from ortho_check import FrameGreekGrid, _rect

GEOREF = {"origin": {"utmE": 723166.108, "utmN": 4181578.51}, "axisBearing": {"grid": 67.548}}


def test_frame_egsa_round_trip():
    fg = FrameGreekGrid(GEOREF)
    rng = np.random.default_rng(0)
    x, z = rng.uniform(-200, 200, 300), rng.uniform(-200, 200, 300)
    e, n = fg.to_egsa(x, z)
    x2, z2 = fg.from_egsa(e, n)
    # pyproj picks separate forward and inverse datum operations (GGRS87 <-> WGS84): about 1 mm apart
    assert np.abs(np.asarray(x2) - x).max() < 5e-3 and np.abs(np.asarray(z2) - z).max() < 5e-3


def test_origin_matches_a_direct_wgs84_to_egsa_transform():
    fg = FrameGreekGrid(GEOREF)
    e, n = fg.to_egsa(0.0, 0.0)
    lon, lat = Transformer.from_crs("EPSG:32634", "EPSG:4326", always_xy=True).transform(723166.108, 4181578.51)
    e2, n2 = Transformer.from_crs("EPSG:4326", "EPSG:2100", always_xy=True).transform(lon, lat)
    assert abs(e - e2) < 0.01 and abs(n - n2) < 0.01
    # Greek Grid: TM, central meridian 24 E, false easting 500 km -> the site is west of it
    assert 450_000 < e < 470_000 and 4_170_000 < n < 4_190_000


def test_axis_bearing_in_egsa_follows_grid_convergence():
    fg = FrameGreekGrid(GEOREF)
    # UTM 34N convergence at 23.53 E is about +1.55 deg, EGSA87 (CM 24 E) about -0.29 deg,
    # so the EGSA grid bearing is the UTM grid bearing + about 1.84 deg
    assert fg.axis_bearing_egsa() == pytest.approx(67.548 + 1.84, abs=0.05)


def test_scale_is_metric_to_1e3():
    fg = FrameGreekGrid(GEOREF)
    e0, n0 = fg.to_egsa(0.0, 0.0)
    e1, n1 = fg.to_egsa(100.0, 0.0)
    assert np.hypot(e1 - e0, n1 - n0) == pytest.approx(100.0, rel=1e-3)  # grid scale factors of both TMs


def test_rect_convention():
    r = _rect((0, 0), 4.0, 2.0, 90.0)  # +x turned to -z
    assert np.allclose(np.ptp(r, axis=0), [2.0, 4.0])
