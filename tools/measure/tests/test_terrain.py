"""Terrain heightfield (Step 3b b) on the synthetic scan with a known 8 deg terrace."""
import json
import os

import numpy as np
import pytest
from PIL import Image

from load import filter_mask, read_all
from make_synthetic import GT, make
from terrain import GROUND_MAX_SCALE, GROUND_OPACITY, decode_png16, heightfield, write_outputs


@pytest.fixture(scope="module")
def syn(tmp_path_factory):
    out = str(tmp_path_factory.mktemp("terrain"))
    gt = make(out, noise=0.015, seed=5, density=0.5)
    sp = read_all(os.path.join(out, "synthetic.ply"))
    sp = sp.subset(filter_mask(sp, GROUND_OPACITY, GROUND_MAX_SCALE))
    Rg, tg, sc = np.array(gt["rotation"]), np.array(gt["translation"]), gt["scale"]
    p = (sp.xyz - tg) @ Rg  # = scale * true coordinates; stylobate top at z = 0
    L, W = gt["truth"]["stylobateLength"], gt["truth"]["stylobateWidth"]
    hx, hy = sc * (L / 2 + 2 * GT["stepTread"] + 0.5), sc * (W / 2 + 2 * GT["stepTread"] + 0.5)
    fp = np.array([[hx, hy], [-hx, hy], [-hx, -hy], [hx, -hy]])
    ext = [-40.0, 40.0, -30.0, 30.0]
    Z, mask = heightfield(p, ext, 0.5, footprint=fp)
    return {"gt": gt, "Z": Z, "mask": mask, "ext": ext, "out": out, "sc": sc, "L": L, "W": W}


def terrace_truth(syn, xs, ys):
    """Synthetic terrace height (scaled) at frame xy; slope direction recovered from gt."""
    sc = syn["sc"]
    n = np.array(syn["gt"]["terraceNormalRaw"]) @ np.array(syn["gt"]["rotation"])  # back to the true frame
    zb = -3 * GT["stepRise"]
    # plane through (0,0,zb) with normal n: z = zb - (n_x x + n_y y)/n_z, in true units
    return sc * (zb - (n[0] * xs / sc + n[1] * ys / sc) / n[2])


def test_heights_match_the_terrace(syn):
    Z, mask, ext = syn["Z"], syn["mask"], syn["ext"]
    ny, nx = Z.shape
    xs = ext[0] + (np.arange(nx) + 0.5) * 0.5
    ys = ext[2] + (np.arange(ny) + 0.5) * 0.5
    gx, gy = np.meshgrid(xs, ys)
    # stay clear of the crepidoma (the terrace is cut out 1 m around it in the generator)
    away = (np.abs(gx) > syn["sc"] * (syn["L"] / 2 + 2.5)) | (np.abs(gy) > syn["sc"] * (syn["W"] / 2 + 2.5))
    m = (mask == 1) & away
    assert m.sum() > 2000
    err = np.abs(Z[m] - terrace_truth(syn, gx[m], gy[m]))
    assert np.median(err) < 0.05
    assert np.percentile(err, 90) < 0.15  # clutter blocks and drums raise a few cells


def test_temple_footprint_refilled_and_flagged(syn):
    mask, Z = syn["mask"], syn["Z"]
    assert (mask == 2).sum() > 0
    assert np.isfinite(Z[mask == 2]).all()
    assert (mask == 0).sum() == np.isnan(Z).sum()


def test_png16_round_trip_and_size(syn):
    out = os.path.join(syn["out"], "t")
    meta = write_outputs(out, syn["Z"], syn["mask"], {"cell": 0.5, "extent": syn["ext"]})
    v = np.array(Image.open(os.path.join(out, "terrain.png")))[::-1]
    Zd = decode_png16(v, meta["zMin"], meta["zMax"])
    fin = np.isfinite(syn["Z"])
    assert (np.isfinite(Zd) == fin).all()
    assert np.abs(Zd[fin] - syn["Z"][fin]).max() <= (meta["zMax"] - meta["zMin"]) / 65534 + 1e-9
    assert os.path.getsize(os.path.join(out, "terrain.png")) < 300_000
    with open(os.path.join(out, "terrain.json")) as f:
        assert json.load(f)["maskLegend"]["2"].startswith("filled")
