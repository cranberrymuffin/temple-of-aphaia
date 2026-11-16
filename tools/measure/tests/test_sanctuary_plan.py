"""Sanctuary plan digitiser: SVG transforms, scale bar and the plan -> temple-frame fit."""
import os

import numpy as np
import pytest

import svgplan
from sanctuary_plan import apply, build, fit_columns, load_plan, perimeter_nodes, rigid_fit

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
REAL_SVG = os.path.join(REPO, "refs", "incoming", "Plan_Aphaia_sanctuary-en.svg")

PPM = 25.0  # synthetic sheet scale
THETA = np.radians(107.0)  # frame -> sheet rotation
OFFSET = np.array([700.0, 1700.0])


def frame_to_sheet(xz):
    c, s = np.cos(THETA), np.sin(THETA)
    R = np.array([[c, -s], [s, c]])
    return PPM * np.asarray(xz) @ R.T + OFFSET


def circle_d(cx, cy, r):
    return f"M {cx + r},{cy} A {r},{r} 0 1,1 {cx - r},{cy} A {r},{r} 0 1,1 {cx + r},{cy} z"


def synthetic_svg(path, jitter=0.0, seed=0):
    rng = np.random.default_rng(seed)
    dots = frame_to_sheet(perimeter_nodes() + rng.normal(0, jitter, (32, 2)))
    altar = frame_to_sheet([[38.0, 0.0]])[0]
    # the dots sit inside a translated + scaled group, as Inkscape writes them
    g_t = np.array([10.0, -20.0])
    g_s = 2.0
    inner = (dots - g_t) / g_s
    paths = "\n".join(f'<path d="{circle_d(x, y, 12.0 / g_s)}" style="fill:#f57900;stroke:none" />' for x, y in inner)
    bar = "\n".join(f'<rect x="{100 + i * 5 * PPM}" y="400" width="{5 * PPM}" height="9" style="fill:#ffffff;stroke:#000000" />' for i in range(4))
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="1780" height="2780">
<text x="98" y="380">0</text><text x="581" y="381">20 m</text>
{bar}
<text x="{altar[0]}" y="{altar[1]}">Altar of 5th c.</text>
<g transform="translate({g_t[0]},{g_t[1]})"><g transform="scale({g_s})">{paths}</g></g>
</svg>"""
    with open(path, "w") as f:
        f.write(svg)


def test_parse_transform_composes_like_svg():
    M = svgplan.parse_transform("translate(10,5) rotate(90) scale(2)")
    p = M @ np.array([1.0, 0.0, 1.0])
    assert np.allclose(p[:2], [10.0, 7.0])
    M2 = svgplan.parse_transform("matrix(0,1,-1,0,3,4)")
    assert np.allclose((M2 @ np.array([1.0, 0.0, 1.0]))[:2], [3.0, 5.0])


def test_rigid_fit_recovers_known_pose():
    rng = np.random.default_rng(1)
    src = rng.uniform(-50, 50, (40, 2))
    a = np.radians(33.0)
    R = np.array([[np.cos(a), -np.sin(a)], [np.sin(a), np.cos(a)]])
    dst = 0.04 * src @ R.T + np.array([3.0, -7.0])
    s, R2, t = rigid_fit(src, dst)
    assert abs(s - 0.04) < 1e-12 and np.allclose(R2, R) and np.allclose(t, [3.0, -7.0])


def test_synthetic_plan_scale_and_column_fit(tmp_path):
    p = tmp_path / "plan.svg"
    synthetic_svg(p)
    items, bar, peri, fit = load_plan(str(p))
    assert abs(bar["pxPerM"] - PPM) < 1e-6
    assert len(peri) == 32 and fit["matched"] == 32
    assert fit["rms"] < 1e-6
    assert abs(fit["freeScalePxPerM"] - PPM) < 1e-6
    # sheet -> frame inverts frame -> sheet exactly
    xz = np.array([[38.0, 0.0], [-20.0, 15.0]])
    assert np.allclose(apply(fit["s"], fit["R"], fit["t"], frame_to_sheet(xz)), xz, atol=1e-6)


def test_synthetic_plan_with_drawing_error(tmp_path):
    p = tmp_path / "plan.svg"
    synthetic_svg(p, jitter=0.2, seed=3)
    _, _, _, fit = load_plan(str(p))
    assert fit["matched"] == 32
    assert 0.1 < fit["rms"] < 0.35  # the residual reports the drawing error


def test_east_hint_picks_the_altar_side():
    nodes = perimeter_nodes()
    sheet = frame_to_sheet(nodes)
    fit = fit_columns(sheet, PPM, east_hint_px=frame_to_sheet([[38.0, 0.0]])[0])
    assert apply(fit["s"], fit["R"], fit["t"], frame_to_sheet([[38.0, 0.0]]))[0, 0] > 0
    fit_w = fit_columns(sheet, PPM, east_hint_px=frame_to_sheet([[-38.0, 0.0]])[0])
    assert apply(fit_w["s"], fit_w["R"], fit_w["t"], frame_to_sheet([[38.0, 0.0]]))[0, 0] < 0


@pytest.mark.skipif(not os.path.exists(REAL_SVG), reason="reference plan not present (refs/ is not committed)")
def test_real_plan_registration():
    doc, _, fit = build(REAL_SVG)
    m = doc["meta"]
    assert fit["matched"] == 32 and m["columnFit"]["rmsM"] < 0.5
    assert abs(m["northArrowDeviationDeg"]) < 5
    feats = {f["id"]: f for f in doc["features"]}
    # Fiechter: altar about 22.5 m east of the stylobate edge, 13.08 m long
    assert abs(feats["altar"]["extent"]["min"][0] - 14.4 - 22.5) < 1.5
    assert abs(feats["altar"]["extent"]["max"][1] - feats["altar"]["extent"]["min"][1] - 13.08) < 0.8
    assert feats["propylon"]["centroid"][1] > 10  # in the south wall
    assert m["unassignedSvgItems"] == []
