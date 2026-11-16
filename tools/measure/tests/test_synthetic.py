"""Synthetic recovery tests (plan Step 2 Verify). Each noise level is a full pipeline run."""
import numpy as np
import pytest

from common import angle_deg
from pipeline import run

NOISE_LEVELS = [0.005, 0.015, 0.03]


@pytest.fixture(scope="module", params=NOISE_LEVELS, ids=lambda s: f"noise{s * 100:g}cm")
def result(request, tmp_path_factory):
    return run(str(tmp_path_factory.mktemp(f"syn{request.param}")), noise=request.param)


def scaled(result, key):
    return result["report"]["keys"][key]["scaled"]


def rel_err(result, key):
    return scaled(result, key) / result["gt"]["truth"][key] - 1.0


def test_up_is_column_normal_consensus_not_terrace(result):
    gt = result["gt"]
    up_raw = np.array(result["frame"]["up"]["upRaw"])
    assert angle_deg(up_raw, gt["upRaw"]) < 0.5
    assert angle_deg(up_raw, gt["terraceNormalRaw"]) > 6.0
    # normal-based estimate alone also avoids the terrace, and the consensus is within 1 deg
    up_n = np.array(result["frame"]["up"]["upNormalsRaw"])
    assert angle_deg(up_n, gt["upRaw"]) < 0.5
    assert result["frame"]["up"]["consensus"]["angleNormalsVsColumnsDeg"] <= 1.0
    assert result["report"]["up"]["consensus"]["withinOneDegree"]


def test_k_recovered_within_half_percent(result):
    sc = result["report"]["scale"]
    k_exp = result["gt"]["kExpected"]
    assert abs(sc["k"] / k_exp - 1) < 0.005
    assert sc["ci"][0] <= sc["k"] <= sc["ci"][1]
    assert not sc["metric"]  # scale 1.04 must not be mistaken for metric


@pytest.mark.parametrize("key", ["stylobateLength", "stylobateWidth", "interaxialFlank", "interaxialFront"])
def test_long_distances_within_half_percent(result, key):
    assert abs(rel_err(result, key)) < 0.005, f"{key}: {100 * rel_err(result, key):+.2f}%"


def test_arris_diameter_within_one_percent(result):
    assert abs(rel_err(result, "lowerDiameter")) < 0.01, f"{100 * rel_err(result, 'lowerDiameter'):+.2f}%"
    assert result["report"]["keys"]["lowerDiameter"]["residualType"] == "flute_fit_rms"


def test_abacus_height_within_one_percent_and_restored_flagged(result):
    assert abs(rel_err(result, "columnHeight")) < 0.01, f"{100 * rel_err(result, 'columnHeight'):+.2f}%"
    flagged = {tuple(c["label"]) for c in result["report"]["columns"] if c.get("height", {}).get("restoredAbove")}
    assert flagged == {tuple(x) for x in result["gt"]["restored"]}


def test_every_key_has_scale_fields(result):
    for k, v in result["report"]["keys"].items():
        for f in ("raw", "k", "scaled", "compareTo", "residual", "residualType", "decision"):
            assert f in v, (k, f)
        assert v["compareTo"] == "scaled"
