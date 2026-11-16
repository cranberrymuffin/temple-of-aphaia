"""Proposed merge of scan values into dimensions.json (plan Step 2.9).

Reads measurements/scan-report.json (decisions already made by decide.py: ratio check,
residual gate, 5% gate, coverage) and writes:
  measurements/dimensions.proposed.json   dimensions.json with every key decided "scan"
                                          replaced by its scan value (source "scan",
                                          residual, residualType, n, uncertainty, note)
  measurements/approved-deviations.json   one proposed entry per downgraded key
                                          {key, reason, scanScaled, usedValue, approvedBy: null, date: null}

Executors never set approvedBy. Re-running replaces this script's own unsigned entries
for the measured keys; signed entries are never touched. src/data/dimensions.json is only
written with --apply (the lead's merge step).

Usage: merge_dimensions.py [--report ...] [--dimensions src/data/dimensions.json]
                           [--out measurements/dimensions.proposed.json]
                           [--deviations measurements/approved-deviations.json] [--apply]
"""
from __future__ import annotations

import argparse
import copy
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from common import MEASUREMENTS, REPO, read_json, write_json  # noqa: E402
from decide import K_NOT_ONE_WORDING  # noqa: E402

SCAN_NOTE_TAG = "scan-derived (merge_dimensions.py)"


def propose(report, dims_doc, deviations):
    dims = copy.deepcopy(dims_doc)
    devs = [d for d in deviations if d.get("approvedBy") or d.get("key") not in report["keys"]]
    metric = report["scale"]["metric"]
    for key, v in report["keys"].items():
        if v["decision"] == "scan":
            e = dims["dimensions"].get(key)
            if e is None:
                continue
            note = f"{SCAN_NOTE_TAG}: {v['compareTo']} value, k={v['k']:.4f}; published {v.get('published')}"
            if not metric:
                note += "; " + K_NOT_ONE_WORDING
            if v.get("label"):
                note += f"; {v['label']}"
            e.update({"value": round(float(v["value"]), 4), "source": "scan", "residual": round(float(v["residual"]), 5), "residualType": v["residualType"], "n": int(v["n"]), "note": note})
            if v.get("uncertainty") is not None:
                e["uncertainty"] = round(float(v["uncertainty"]), 5)
            e.pop("provisional", None)
        else:
            if any(d["key"] == key and d.get("approvedBy") for d in devs):
                continue
            devs.append({"key": key, "reason": "; ".join(v["reasons"]), "scanScaled": round(float(v["scaled"]), 5), "usedValue": v.get("published"), "approvedBy": None, "date": None})
    for d in devs:  # hard guard: this script never signs
        if d not in deviations:
            assert d["approvedBy"] is None and d["date"] is None
    if dims.get("meta"):
        dims["meta"]["note"] = dims["meta"].get("note", "") + f" Scan merge proposed from scan-report.json (frameHash {report['frameHash'][:12]})."
    return dims, devs


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", default=str(MEASUREMENTS / "scan-report.json"))
    ap.add_argument("--dimensions", default=str(REPO / "src" / "data" / "dimensions.json"))
    ap.add_argument("--out", default=str(MEASUREMENTS / "dimensions.proposed.json"))
    ap.add_argument("--deviations", default=str(MEASUREMENTS / "approved-deviations.json"))
    ap.add_argument("--apply", action="store_true", help="also write the proposal over --dimensions (lead only)")
    a = ap.parse_args(argv)
    report = read_json(a.report)
    dims = read_json(a.dimensions)
    devs = read_json(a.deviations) if os.path.exists(a.deviations) else []
    proposed, new_devs = propose(report, dims, devs)
    write_json(a.out, proposed)
    write_json(a.deviations, new_devs)
    if a.apply:
        write_json(a.dimensions, proposed)
    n_scan = sum(1 for v in report["keys"].values() if v["decision"] == "scan")
    print(f"{n_scan} keys from the scan, {len(report['keys']) - n_scan} downgraded -> {a.deviations} ({len(new_devs)} entries); proposal -> {a.out}")


if __name__ == "__main__":
    main()
