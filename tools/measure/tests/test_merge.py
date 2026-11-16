"""merge_dimensions.py and the decide.py gates."""
from decide import decide_all
from merge_dimensions import propose

PUB = {"stylobateLength": 28.8, "stylobateWidth": 13.8, "interaxialFlank": 2.57, "interaxialFront": 2.62, "columnHeight": 5.27, "lowerDiameter": 0.99}


def meas(**over):
    m = {
        "stylobateLength": {"raw": 28.8, "residual": 0.01, "residualType": "edge_rms", "n": 40},
        "stylobateWidth": {"raw": 13.8, "residual": 0.01, "residualType": "edge_rms", "n": 40},
        "interaxialFlank": {"raw": 2.57, "residual": 0.01, "residualType": "grid_rms", "n": 25},
        "interaxialFront": {"raw": 2.62, "residual": 0.01, "residualType": "grid_rms", "n": 25},
        "columnHeight": {"raw": 5.27, "residual": 0.02, "residualType": "slice_sigma", "n": 10},
        "lowerDiameter": {"raw": 0.99, "residual": 0.005, "residualType": "flute_fit_rms", "n": 10},
    }
    for k, v in over.items():
        m[k].update(v)
    return m


SCALE = {"k": 1.0, "ci": [0.99, 1.01], "metric": True}


def doc():
    return {"meta": {"status": "merged", "note": "x"}, "dimensions": {k: {"value": v, "unit": "m", "source": "published", "ref": "furtwangler-1906", "verified": True, "definition": "d"} for k, v in PUB.items()}}


def report(keys):
    return {"frameHash": "ab" * 32, "scale": SCALE, "keys": keys}


def test_all_good_merges_scan_and_no_deviations():
    keys = decide_all(meas(), PUB, SCALE)
    assert all(v["decision"] == "scan" for v in keys.values())
    dims, devs = propose(report(keys), doc(), [])
    assert devs == []
    assert dims["dimensions"]["columnHeight"]["source"] == "scan"
    assert dims["dimensions"]["columnHeight"]["residualType"] == "slice_sigma"


def test_each_downgrade_path_appends_unsigned_entry():
    m = meas(
        columnHeight={"raw": 5.27 * 1.04},  # ratio check (vs lowerDiameter) and nothing else
        lowerDiameter={"residual": 0.02},  # residual gate
        interaxialFront={"raw": 2.62 * 1.08},  # 5% gate (+ ratio)
        stylobateWidth={"n": 2},  # coverage
    )
    keys = decide_all(m, PUB, SCALE)
    assert any("ratio check" in r for r in keys["columnHeight"]["reasons"])
    assert any("residual gate" in r for r in keys["lowerDiameter"]["reasons"])
    assert any("5% gate" in r for r in keys["interaxialFront"]["reasons"])
    assert any("coverage" in r for r in keys["stylobateWidth"]["reasons"])
    _, devs = propose(report(keys), doc(), [])
    by = {d["key"]: d for d in devs}
    for k in ("columnHeight", "lowerDiameter", "interaxialFront", "stylobateWidth"):
        assert by[k]["approvedBy"] is None and by[k]["date"] is None
        assert by[k]["usedValue"] == PUB[k]


def test_rerun_is_idempotent_and_keeps_signed_entries():
    keys = decide_all(meas(lowerDiameter={"residual": 0.02}, columnHeight={"residual": 0.2}), PUB, SCALE)
    signed = {"key": "columnHeight", "reason": "r", "scanScaled": 5.3, "usedValue": 5.27, "approvedBy": "User", "date": "2026-11-20"}
    _, devs1 = propose(report(keys), doc(), [signed])
    _, devs2 = propose(report(keys), doc(), devs1)
    assert devs1 == devs2
    assert signed in devs2
    assert sum(1 for d in devs2 if d["key"] == "columnHeight") == 1


def test_k_not_one_labels_long_distances():
    sc = {"k": 0.96, "ci": [0.955, 0.965], "metric": False}
    keys = decide_all(meas(**{k: {"raw": PUB[k] / 0.96} for k in PUB}), PUB, sc)
    assert keys["stylobateLength"]["label"] == "consistent by construction"
    assert keys["stylobateLength"]["compareTo"] == "scaled"
    assert "label" not in keys["columnHeight"]
