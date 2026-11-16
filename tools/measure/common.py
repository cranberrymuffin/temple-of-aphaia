"""Shared helpers for the scan measurement pipeline.

Scripts run as `.venv/bin/python -I tools/measure/<script>.py`, and `-I` drops the
script directory from sys.path, so every entry script inserts its own directory
before importing this module.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
MEASUREMENTS = REPO / "measurements"

# Grid convention (plan section Step 2.5): row 0-5 across the width (front to back),
# col 0-11 along the flank. Perimeter positions only.
N_ROWS = 6
N_COLS = 12


def sigmoid(x):
    return 1.0 / (1.0 + np.exp(-x))


def quat_to_rot(q):
    """(N,4) quaternions w,x,y,z -> (N,3,3) rotation matrices (normalised first)."""
    q = np.asarray(q, dtype=np.float64)
    q = q / np.linalg.norm(q, axis=1, keepdims=True)
    w, x, y, z = q[:, 0], q[:, 1], q[:, 2], q[:, 3]
    R = np.empty((len(q), 3, 3))
    R[:, 0, 0] = 1 - 2 * (y * y + z * z)
    R[:, 0, 1] = 2 * (x * y - w * z)
    R[:, 0, 2] = 2 * (x * z + w * y)
    R[:, 1, 0] = 2 * (x * y + w * z)
    R[:, 1, 1] = 1 - 2 * (x * x + z * z)
    R[:, 1, 2] = 2 * (y * z - w * x)
    R[:, 2, 0] = 2 * (x * z - w * y)
    R[:, 2, 1] = 2 * (y * z + w * x)
    R[:, 2, 2] = 1 - 2 * (x * x + y * y)
    return R


def rot_to_quat(R):
    """(N,3,3) -> (N,4) w,x,y,z. Robust branch-free-ish (Shepperd)."""
    R = np.asarray(R, dtype=np.float64)
    out = np.empty((len(R), 4))
    tr = R[:, 0, 0] + R[:, 1, 1] + R[:, 2, 2]
    for i in range(len(R)):
        m = R[i]
        if tr[i] > 0:
            s = np.sqrt(tr[i] + 1.0) * 2
            out[i] = [0.25 * s, (m[2, 1] - m[1, 2]) / s, (m[0, 2] - m[2, 0]) / s, (m[1, 0] - m[0, 1]) / s]
        elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
            s = np.sqrt(1.0 + m[0, 0] - m[1, 1] - m[2, 2]) * 2
            out[i] = [(m[2, 1] - m[1, 2]) / s, 0.25 * s, (m[0, 1] + m[1, 0]) / s, (m[0, 2] + m[2, 0]) / s]
        elif m[1, 1] > m[2, 2]:
            s = np.sqrt(1.0 + m[1, 1] - m[0, 0] - m[2, 2]) * 2
            out[i] = [(m[0, 2] - m[2, 0]) / s, (m[0, 1] + m[1, 0]) / s, 0.25 * s, (m[1, 2] + m[2, 1]) / s]
        else:
            s = np.sqrt(1.0 + m[2, 2] - m[0, 0] - m[1, 1]) * 2
            out[i] = [(m[1, 0] - m[0, 1]) / s, (m[0, 2] + m[2, 0]) / s, (m[1, 2] + m[2, 1]) / s, 0.25 * s]
    return out


def rotation_between(a, b):
    """Rotation matrix taking unit vector a onto unit vector b."""
    a = np.asarray(a, float) / np.linalg.norm(a)
    b = np.asarray(b, float) / np.linalg.norm(b)
    v = np.cross(a, b)
    c = float(np.dot(a, b))
    if np.linalg.norm(v) < 1e-12:
        if c > 0:
            return np.eye(3)
        # 180 degrees: rotate about any axis orthogonal to a
        ax = np.cross(a, [1, 0, 0])
        if np.linalg.norm(ax) < 1e-6:
            ax = np.cross(a, [0, 1, 0])
        ax /= np.linalg.norm(ax)
        return 2 * np.outer(ax, ax) - np.eye(3)
    vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + vx + vx @ vx * (1.0 / (1.0 + c))


def angle_deg(a, b, axial=True):
    a = np.asarray(a, float) / np.linalg.norm(a)
    b = np.asarray(b, float) / np.linalg.norm(b)
    c = float(np.dot(a, b))
    if axial:
        c = abs(c)
    return float(np.degrees(np.arccos(np.clip(c, -1, 1))))


# ---------------------------------------------------------------- frame


def frame_matrix(frame):
    return np.asarray(frame["matrix"], dtype=np.float64)


def frame_hash(matrix):
    """SHA-256 of the canonicalised 4x4 matrix (row-major, 12 significant digits)."""
    M = np.asarray(matrix, dtype=np.float64).reshape(4, 4)
    canon = json.dumps([[float(f"{v:.12g}") + 0.0 for v in row] for row in M], separators=(",", ":"))
    return hashlib.sha256(canon.encode()).hexdigest()


def make_frame(R, t, extra=None):
    M = np.eye(4)
    M[:3, :3] = R
    M[:3, 3] = t
    M = np.array([[float(f"{v:.12g}") + 0.0 for v in row] for row in M])
    out = {"matrix": M.tolist(), "convention": "p_frame = M @ [p_raw, 1]; frame +Z is up"}
    if extra:
        out.update(extra)
    out["frameHash"] = frame_hash(M)
    return out


def load_frame(path):
    with open(path) as f:
        fr = json.load(f)
    actual = frame_hash(fr["matrix"])
    if fr.get("frameHash") != actual:
        raise ValueError(f"frame.json frameHash {fr.get('frameHash')} does not match its matrix ({actual})")
    return fr


def to_frame(M, pts):
    pts = np.asarray(pts, dtype=np.float64)
    return pts @ M[:3, :3].T + M[:3, 3]


def to_raw(M, pts):
    pts = np.asarray(pts, dtype=np.float64)
    Rinv = M[:3, :3].T  # rotation only (frames are rigid)
    return (pts - M[:3, 3]) @ Rinv.T


# ---------------------------------------------------------------- picks


def perimeter_labels():
    labs = set()
    for r in range(N_ROWS):
        for c in range(N_COLS):
            if r in (0, N_ROWS - 1) or c in (0, N_COLS - 1):
                labs.add((r, c))
    return labs


def validate_column_labels(columns):
    """Assert 32 unique perimeter (row,col) labels, no duplicates, no interior labels."""
    expected = perimeter_labels()
    seen = []
    for col in columns:
        lab = tuple(col["label"])
        if len(lab) != 2:
            raise ValueError(f"bad label {lab}")
        if lab not in expected:
            raise ValueError(f"label {lab} is not a perimeter position of the 6x12 grid")
        seen.append(lab)
    dups = sorted({x for x in seen if seen.count(x) > 1})
    if dups:
        raise ValueError(f"duplicate column labels: {dups}")
    missing = sorted(expected - set(seen))
    if missing:
        raise ValueError(f"missing column labels: {missing}")
    if len(seen) != 32:
        raise ValueError(f"expected 32 perimeter labels, got {len(seen)}")


def read_json(path):
    with open(path) as f:
        return json.load(f)


def write_json(path, data):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
