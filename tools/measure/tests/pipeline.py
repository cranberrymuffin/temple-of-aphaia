"""End-to-end run of the measurement pipeline on a synthetic scan (used by the tests)."""
import json
import os

from common import make_frame, write_json
from load import load
from make_synthetic import make
from measure_from_picks import measure, published_values
from up import build_frame


def frame_from(splats, column_axes=None, seed=0):
    import numpy as np

    fr = build_frame(splats, rng=np.random.default_rng(seed), column_axes=column_axes)
    return make_frame(fr["R"], fr["t"], {"up": fr["report"]})


def run(outdir, noise, seed=1, n_boot=100):
    gt = make(outdir, noise=noise, seed=seed)
    ply = os.path.join(outdir, "synthetic.ply")
    s, _ = load(ply)
    published = published_values(os.path.join(outdir, "published.json"))
    with open(os.path.join(outdir, "picks.json")) as f:
        picks = json.load(f)
    # pass 1: frame from the normal-based up
    frame1 = frame_from(s)
    picks["frameHash"] = frame1["frameHash"]
    rep1, _ = measure(ply, frame1, picks, published, n_boot=n_boot, log=lambda *a: None)
    # pass 2: consensus with the column axes, picks explicitly re-bound
    frame2 = frame_from(s, column_axes=rep1["up"]["columnAxes"])
    picks["frameHash"] = frame2["frameHash"]
    rep2, _ = measure(ply, frame2, picks, published, n_boot=n_boot, log=lambda *a: None)
    write_json(os.path.join(outdir, "frame.json"), frame2)
    return {"gt": gt, "frame1": frame1, "frame": frame2, "report1": rep1, "report": rep2}
