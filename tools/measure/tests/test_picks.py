"""Picks <-> frame binding (plan Step 2 Verify: test_picks.py)."""
import copy
import json
import os
import subprocess
import sys

import numpy as np
import pytest

from common import load_frame, make_frame, perimeter_labels, to_frame, to_raw, validate_column_labels, write_json
from make_synthetic import write_ply
from save_picks import FrameMismatch, frame_to_raw, load_picks, raw_to_frame

MEASURE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY = sys.executable


def random_frame(seed=3):
    from scipy.spatial.transform import Rotation

    R = Rotation.random(random_state=seed).as_matrix()
    t = np.random.default_rng(seed).uniform(-30, 30, 3)
    return make_frame(R, t)


def authoring_picks():
    cols = []
    for i, (r, c) in enumerate(sorted(perimeter_labels())):
        cols.append({"label": [r, c], "status": "standing", "complete": True, "seed": [c * 2.5 + 0.01 * i, r * 2.6]})
    return {
        "crop": [[-2, -2], [30, -2], [30, 15], [-2, 15]],
        "cellaExclude": [[3, 3], [25, 3], [25, 10], [3, 10]],
        "columns": cols,
        "stylobateEdges": {k: [[0, 0], [5, 0.01], [10, 0.02]] for k in ("north", "south", "east", "west")},
        "interior": [{"label": "pronaos-N", "seed": [20.0, 5.0]}],
    }


def test_raw_frame_round_trip_within_1e6():
    fr = random_frame()
    M = np.asarray(fr["matrix"])
    pts = np.random.default_rng(0).uniform(-50, 50, (1000, 3))
    assert np.abs(to_frame(M, to_raw(M, pts)) - pts).max() < 1e-6
    pf = authoring_picks()
    back = raw_to_frame(frame_to_raw(pf, fr), fr)
    for a, b in zip(pf["columns"], back["columns"]):
        assert np.abs(np.subtract(a["seed"], b["seed"])).max() < 1e-6
    for k in pf["stylobateEdges"]:
        assert np.abs(np.subtract(pf["stylobateEdges"][k], back["stylobateEdges"][k])).max() < 1e-6
    assert np.abs(np.subtract(pf["crop"], back["crop"])).max() < 1e-6


def test_32_unique_perimeter_labels_accepted():
    validate_column_labels(authoring_picks()["columns"])
    assert len(perimeter_labels()) == 32


def test_duplicate_label_rejected():
    cols = authoring_picks()["columns"]
    cols[1]["label"] = list(cols[0]["label"])
    with pytest.raises(ValueError, match="duplicate"):
        validate_column_labels(cols)


def test_missing_label_rejected():
    cols = authoring_picks()["columns"][:-1]
    with pytest.raises(ValueError, match="missing"):
        validate_column_labels(cols)


def test_interior_label_rejected():
    cols = authoring_picks()["columns"]
    cols[0]["label"] = [2, 5]
    with pytest.raises(ValueError, match="perimeter"):
        validate_column_labels(cols)


def test_tampered_frame_hash_detected(tmp_path):
    fr = random_frame()
    bad = copy.deepcopy(fr)
    bad["matrix"][0][3] += 0.001
    write_json(tmp_path / "frame.json", bad)
    with pytest.raises(ValueError, match="frameHash"):
        load_frame(tmp_path / "frame.json")


def test_load_picks_refuses_other_frame(tmp_path):
    fr1, fr2 = random_frame(3), random_frame(4)
    write_json(tmp_path / "picks.json", frame_to_raw(authoring_picks(), fr1))
    load_picks(tmp_path / "picks.json", fr1)
    with pytest.raises(FrameMismatch):
        load_picks(tmp_path / "picks.json", fr2)


def test_measure_from_picks_exits_nonzero_on_hash_mismatch(tmp_path):
    fr1, fr2 = random_frame(3), random_frame(4)
    write_json(tmp_path / "frame.json", fr2)
    write_json(tmp_path / "picks.json", frame_to_raw(authoring_picks(), fr1))
    ply = tmp_path / "tiny.ply"
    n = 10
    write_ply(str(ply), np.zeros((n, 3)), np.tile([1.0, 0, 0, 0], (n, 1)), np.full((n, 3), 0.01), np.zeros(n))
    with open(tmp_path / "published.json", "w") as f:
        json.dump({"dimensions": {}}, f)
    proc = subprocess.run(
        [PY, "-I", os.path.join(MEASURE, "measure_from_picks.py"), str(ply), "--frame", str(tmp_path / "frame.json"), "--picks", str(tmp_path / "picks.json"), "--published", str(tmp_path / "published.json"), "--outdir", str(tmp_path / "out"), "--no-images"],
        capture_output=True,
        text=True,
    )
    assert proc.returncode != 0
    assert "REFUSING" in proc.stderr
    assert not (tmp_path / "out" / "scan-report.json").exists()
