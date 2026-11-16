"""Scale synthesis, scale-invariant ratio check and merge gates (plan Steps 2.7 and 2.9).

Pure functions. Every key gets raw, k, scaled, compareTo, residual, published, diff,
ratio check and a decision ("scan" or "published") with the reasons for a downgrade.
"""
from __future__ import annotations

# Long distances: the scan is the authority; k is fitted on these only.
LONG_KEYS = ("stylobateLength", "stylobateWidth", "interaxialFront", "interaxialFlank")

# Scale-invariant ratio per dimension: (numerator key, denominator key). The numerator
# is the dimension that gets downgraded when the ratio disagrees by more than 2%.
RATIOS = {
    "stylobateLength": "interaxialFlank",
    "stylobateWidth": "stylobateLength",
    "interaxialFront": "interaxialFlank",
    "interaxialFlank": "stylobateLength",
    "cornerContractionFront": "interaxialFront",
    "cornerContractionFlank": "interaxialFlank",
    # Column dimensions are checked against each other (both local to the column), so a
    # large-scale distortion of the scan does not leak into them through the grid.
    "columnHeight": "lowerDiameter",
    "lowerDiameter": "columnHeight",
    "upperDiameter": "lowerDiameter",
}

RATIO_TOL = 0.02
RESIDUAL_TOL = 0.01
PUBLISHED_TOL = 0.05
MIN_N = {"edge_rms": 6, "grid_rms": 8, "flute_fit_rms": 3, "slice_sigma": 3}

K_NOT_ONE_WORDING = "the scan verifies proportions; absolute size is anchored to published values."


def ratio_check(key, meas, published):
    den = RATIOS.get(key)
    if den is None or den not in meas or key not in meas:
        return None
    if not published.get(key) or not published.get(den):
        return None
    rs = meas[key]["raw"] / meas[den]["raw"]
    rp = published[key] / published[den]
    diff = rs / rp - 1.0
    return {"against": den, "scanRatio": rs, "publishedRatio": rp, "diffPct": 100 * diff, "pass": bool(abs(diff) <= RATIO_TOL)}


def decide_key(key, m, published, scale, meas):
    k = scale["k"]
    raw = m["raw"]
    scaled = k * raw
    compare_to = "raw" if scale["metric"] else "scaled"
    value = raw if scale["metric"] else scaled
    pub = published.get(key)
    out = {
        "raw": raw,
        "k": k,
        "scaled": scaled,
        "compareTo": compare_to,
        "value": value,
        "residual": m["residual"] * (1.0 if scale["metric"] else k),
        "residualRaw": m["residual"],
        "residualType": m["residualType"],
        "n": int(m["n"]),
        "published": pub,
    }
    if "uncertaintyRaw" in m:
        out["uncertainty"] = m["uncertaintyRaw"] * (1.0 if scale["metric"] else k)
    reasons = []
    if pub:
        out["diffPct"] = 100 * (value / pub - 1.0)
    rc = ratio_check(key, meas, published)
    out["ratioCheck"] = rc
    if rc is not None and not rc["pass"]:
        reasons.append(f"ratio check: {key}/{rc['against']} differs from published by {rc['diffPct']:+.1f}% (> {100 * RATIO_TOL:.0f}%)")
    if m["n"] < MIN_N.get(m["residualType"], 1):
        reasons.append(f"insufficient coverage: n={m['n']} < {MIN_N[m['residualType']]}")
    if value > 0 and out["residual"] >= RESIDUAL_TOL * value:
        reasons.append(f"residual gate: {m['residualType']} {out['residual']:.4f} >= 1% of value ({RESIDUAL_TOL * value:.4f})")
    if pub and abs(value / pub - 1.0) > PUBLISHED_TOL:
        reasons.append(f"5% gate: {out['diffPct']:+.1f}% from published {pub}")
    if key in LONG_KEYS and not scale["metric"]:
        out["label"] = "consistent by construction"
    out["reasons"] = reasons
    out["decision"] = "published" if reasons else "scan"
    out["usedValue"] = pub if reasons else value
    return out


def decide_all(meas, published, scale):
    return {k: decide_key(k, m, published, scale, meas) for k, m in meas.items()}


def coverage_failures(measured_keys):
    """Keys the plan expects the scan to measure but the run could not."""
    expected = set(RATIOS)
    return sorted(expected - set(measured_keys))
