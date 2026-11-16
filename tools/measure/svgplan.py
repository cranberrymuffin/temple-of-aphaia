"""Minimal SVG reader for the sanctuary plan: flattens every path/rect/text to sheet
coordinates (all nested transforms applied) with its fill/stroke colour and dash style.
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET

import numpy as np
from svgpathtools import parse_path

NS = "{http://www.w3.org/2000/svg}"


def parse_transform(s):
    M = np.eye(3)
    if not s:
        return M
    for name, args in re.findall(r"(\w+)\s*\(([^)]*)\)", s):
        v = [float(x) for x in re.split(r"[\s,]+", args.strip()) if x]
        if name == "matrix":
            T = np.array([[v[0], v[2], v[4]], [v[1], v[3], v[5]], [0, 0, 1]])
        elif name == "translate":
            T = np.array([[1, 0, v[0]], [0, 1, v[1] if len(v) > 1 else 0], [0, 0, 1]])
        elif name == "scale":
            sy = v[1] if len(v) > 1 else v[0]
            T = np.diag([v[0], sy, 1.0])
        elif name == "rotate":
            a = np.radians(v[0])
            R = np.array([[np.cos(a), -np.sin(a), 0], [np.sin(a), np.cos(a), 0], [0, 0, 1]])
            if len(v) == 3:
                T = np.array([[1, 0, v[1]], [0, 1, v[2]], [0, 0, 1]]) @ R @ np.array([[1, 0, -v[1]], [0, 1, -v[2]], [0, 0, 1]])
            else:
                T = R
        else:
            raise ValueError(f"unsupported transform {name}")
        M = M @ T
    return M


def style_of(el):
    st = {}
    for kv in (el.get("style") or "").split(";"):
        if ":" in kv:
            k, v = kv.split(":", 1)
            st[k.strip()] = v.strip()
    for k in ("fill", "stroke", "stroke-width", "stroke-dasharray"):
        if el.get(k) is not None:
            st[k] = el.get(k)
    return st


def _apply(M, pts):
    pts = np.asarray(pts, float).reshape(-1, 2)
    return (np.column_stack([pts, np.ones(len(pts))]) @ M.T)[:, :2]


def path_subpaths(d, samples=8):
    """List of (points, closed) per subpath; curves sampled at `samples` points per segment."""
    out = []
    for sp in parse_path(d).continuous_subpaths():
        pts = []
        for seg in sp:
            if type(seg).__name__ == "Line":
                ts = [0.0]
            else:
                ts = list(np.linspace(0, 1, samples, endpoint=False))
            for t in ts:
                z = seg.point(t)
                pts.append((z.real, z.imag))
        z = sp[-1].point(1.0)
        pts.append((z.real, z.imag))
        out.append((np.array(pts), bool(sp.isclosed())))
    return out


def read(path):
    root = ET.parse(path).getroot()
    items = []

    def walk(el, M, inherited):
        tag = el.tag.replace(NS, "")
        M = M @ parse_transform(el.get("transform"))
        st = dict(inherited)
        st.update(style_of(el))
        eid = el.get("id")
        if tag == "path" and el.get("d"):
            for pts, closed in path_subpaths(el.get("d")):
                items.append({"id": eid, "kind": "path", "pts": _apply(M, pts), "closed": closed, "style": st})
        elif tag == "rect":
            x, y = float(el.get("x", 0)), float(el.get("y", 0))
            w, h = float(el.get("width")), float(el.get("height"))
            pts = [(x, y), (x + w, y), (x + w, y + h), (x, y + h), (x, y)]
            items.append({"id": eid, "kind": "rect", "pts": _apply(M, pts), "closed": True, "style": st})
        elif tag == "text":
            txt = "".join(el.itertext()).strip()
            x = float(el.get("x", 0) or 0)
            y = float(el.get("y", 0) or 0)
            for ts in el.iter(NS + "tspan"):
                if ts.get("x") is not None:
                    x, y = float(ts.get("x")), float(ts.get("y"))
                    break
            items.append({"id": eid, "kind": "text", "text": txt, "pts": _apply(M, [(x, y)]), "dir": _apply(M, [(x, y), (x + 1, y)]), "style": st})
            return
        for ch in el:
            walk(ch, M, {k: v for k, v in st.items() if k in ("fill", "stroke", "stroke-width", "stroke-dasharray")})

    walk(root, np.eye(3), {})
    return items


def colour(st):
    """(role, hex): role 'fill' when filled, else 'stroke'."""
    f = st.get("fill", "none")
    s = st.get("stroke", "none")
    if f not in ("none", "") and f != "#ffffff":
        return "fill", f.lower()
    return "stroke", s.lower()


PHASE_BY_COLOUR = {"#f57900": "5th c. BC", "#4e9a06": "6th c. BC", "#204a87": "7th c. BC", "#000000": "none"}
