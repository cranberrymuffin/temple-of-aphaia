"""Memory-mapped read of a 3DGS PLY: only xyz, opacity, scale_0..2 and rot_0..3.

No voxel downsampling. Opacity filter sigmoid > 0.5 and a large-splat filter.
`refilter_low` gives the relaxed (sigmoid > 0.2) set used by the thin-edge check.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np  # noqa: E402
from plyfile import PlyData  # noqa: E402

from common import sigmoid  # noqa: E402

OPACITY_THRESHOLD = 0.5
OPACITY_THRESHOLD_LOW = 0.2
# Splats whose largest axis exceeds this (scan units) are background blobs/sky.
MAX_SPLAT_SCALE = 0.5


class Splats:
    """Column arrays for a set of splats. Arrays share the same index."""

    def __init__(self, xyz, opacity, scale, rot, normals_stored=None):
        self.xyz = xyz
        self.opacity = opacity  # sigmoid-activated
        self.scale = scale  # exp-activated
        self.rot = rot  # w,x,y,z (not yet normalised)
        self.normals_stored = normals_stored

    def __len__(self):
        return len(self.xyz)

    def subset(self, mask):
        ns = None if self.normals_stored is None else self.normals_stored[mask]
        return Splats(self.xyz[mask], self.opacity[mask], self.scale[mask], self.rot[mask], ns)


def read_all(path):
    """Read every splat (no filtering). Values are activated (sigmoid opacity, exp scale)."""
    ply = PlyData.read(path, mmap=True)
    v = ply["vertex"].data
    names = v.dtype.names
    for req in ("x", "y", "z", "opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"):
        if req not in names:
            raise ValueError(f"{path}: missing property {req}")
    xyz = np.stack([v["x"], v["y"], v["z"]], axis=1).astype(np.float64)
    op = sigmoid(np.asarray(v["opacity"], dtype=np.float64))
    sc = np.exp(np.stack([v["scale_0"], v["scale_1"], v["scale_2"]], axis=1).astype(np.float64))
    rot = np.stack([v["rot_0"], v["rot_1"], v["rot_2"], v["rot_3"]], axis=1).astype(np.float64)
    normals = None
    if "nx" in names:
        normals = np.stack([v["nx"], v["ny"], v["nz"]], axis=1).astype(np.float64)
    return Splats(xyz, op, sc, rot, normals)


def filter_mask(s: Splats, opacity_threshold=OPACITY_THRESHOLD, max_scale=MAX_SPLAT_SCALE):
    qn = np.linalg.norm(s.rot, axis=1)
    return (s.opacity > opacity_threshold) & (s.scale.max(axis=1) < max_scale) & (qn > 1e-8) & np.isfinite(s.xyz).all(axis=1)


def load(path, opacity_threshold=OPACITY_THRESHOLD):
    """Return (filtered Splats, all Splats)."""
    allsp = read_all(path)
    return allsp.subset(filter_mask(allsp, opacity_threshold)), allsp


def stored_normals_usable(s: Splats):
    """Stored nx,ny,nz are checked and ignored if they are (all) zero."""
    if s.normals_stored is None:
        return False
    return bool(np.abs(s.normals_stored).max() > 0)


if __name__ == "__main__":
    path = sys.argv[1]
    f, a = load(path)
    print(f"{path}: {len(a)} splats, {len(f)} after opacity>{OPACITY_THRESHOLD} and scale<{MAX_SPLAT_SCALE}")
    print("stored normals usable:", stored_normals_usable(a))
    print("extent (filtered, 1-99 pct):", np.percentile(f.xyz, 1, axis=0), np.percentile(f.xyz, 99, axis=0))
