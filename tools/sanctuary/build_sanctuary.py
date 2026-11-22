"""Build src/data/sanctuary.json (plan Step 3b) from the research and the digitised site plan.

Inputs:
  measurements/sanctuary-plan.json  worker-2's digitisation of the public-domain Wikimedia plan, in the temple frame
  src/data/dimensions.json          for the terrace level (base of the lowest krepis step)
Values: verified text numbers (Furtwängler 1906, research brief ~/.omc/research/aphaia-sanctuary.md) win on
numbers; the plan places and shapes features; everything else is a labelled conjecture (provisional).

Run: python3 tools/sanctuary/build_sanctuary.py    (stdlib only)
"""
from __future__ import annotations

import json
import math
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PLAN = json.load(open(os.path.join(ROOT, "measurements/sanctuary-plan.json")))
DIMS = json.load(open(os.path.join(ROOT, "src/data/dimensions.json")))["dimensions"]
F = {f["id"]: f for f in PLAN["features"]}
WALLS = {w["id"]: w for w in PLAN["walls"]}

FW = "furtwangler-1906"
WP = "wikimedia-plan-aphaia-sanctuary"
MIN = "ministry-onsite-boards"  # Ministry on-site boards (user photos 2026-11-18), reference only; research brief section 21
URL = "https://archive.org/details/aeginadasheiligtunse"


def r3(v):
    return round(v, 3)


def pt(p):
    return [r3(p[0]), r3(p[1])]


# ---- measures ---------------------------------------------------------------------------------------------
def text(value, unit, page, note=None):
    """Read in Furtwängler's text (verified, with page)."""
    m = {"value": value, "unit": unit, "source": "published", "ref": FW, "page": page, "url": URL, "verified": True}
    if note:
        m["note"] = note
    return m


def derived(value, unit, note):
    """Arithmetic or inference from verified text values (not itself printed)."""
    return {"value": value, "unit": unit, "source": "published", "ref": FW, "verified": False, "provisional": True, "note": "DERIVED: " + note}


def conj(value, unit, note):
    """Conjecture (nothing printed); kept provisional until a source supplies it."""
    return {"value": value, "unit": unit, "source": "published", "ref": FW, "verified": False, "provisional": True, "note": "CONJECTURAL: " + note}


def board(value, unit, note, conf="analogy"):
    """Read or derived from the Ministry's drawn reconstructions (not a measurement); confidence in the note."""
    return {"value": value, "unit": unit, "source": "published", "ref": MIN, "verified": False, "provisional": True,
            "note": f"DERIVED from the Ministry board (confidence: {conf}): {note}"}


def plan(value, unit, unc, note=None):
    """Measured on the digitised plan."""
    m = {"value": r3(value), "unit": unit, "source": "plan", "ref": WP, "verified": True, "note": f"plan measurement, +/-{unc:.2f} m" + (f"; {note}" if note else "")}
    return m


def placement(fid=None, unc=None, conf="analogy", note=None, ref=WP, verified=True):
    p = {"source": "plan", "ref": ref, "verified": verified, "confidence": conf}
    u = unc if unc is not None else (F[fid]["uncertaintyM"] if fid else None)
    if u is not None:
        p["uncertaintyM"] = r3(u)
    if note:
        p["note"] = note
    return p


def phase(label, fr, to, conf, note=None, src=(FW,)):
    p = {"label": label, "fromYear": fr, "toYear": to, "confidence": conf, "sourceIds": list(src)}
    if note:
        p["note"] = note
    return p


NEW = phase("Late Archaic new layout", -510, None, "attested", "Fiechter: 'Wende vom VI. zum V. Jh.' (p. 160), terrace 'Anfang des 5. Jh.' (p. 472)")
BORDER = phase("c. 490-480 BC (borderline)", -490, None, "analogy", "Built about the temple's completion or a little later (p. 99)")

# ---- frame helpers ------------------------------------------------------------------------------------------
S_REL_BASE = -DIMS["crepidomaStepCount"]["value"] * DIMS["crepidomaStepRise"]["value"]  # base of the lowest step


def rot_of(angle_deg):
    """Data rotation for a local x axis pointing along math angle `angle_deg` in (x, z)."""
    return r3(-angle_deg)


def to_local(c, rot, p):
    a = math.radians(rot)
    dx, dz = p[0] - c[0], p[1] - c[1]
    # inverse of x' = c + cos a * x + sin a * z, z' = c - sin a * x + cos a * z
    return [r3(math.cos(a) * dx - math.sin(a) * dz), r3(math.sin(a) * dx + math.cos(a) * dz)]


def obb(points):
    """Minimum-area oriented rectangle: centre, L (along angle), W, angle (deg, math in x/z)."""
    pts = points[:-1] if points[0] == points[-1] else points
    best = None
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        ang = math.atan2(b[1] - a[1], b[0] - a[0])
        c, s = math.cos(ang), math.sin(ang)
        us = [p[0] * c + p[1] * s for p in pts]
        vs = [-p[0] * s + p[1] * c for p in pts]
        area = (max(us) - min(us)) * (max(vs) - min(vs))
        if best is None or area < best[0]:
            cu, cv = (max(us) + min(us)) / 2, (max(vs) + min(vs)) / 2
            best = (area, [cu * c - cv * s, cu * s + cv * c], max(us) - min(us), max(vs) - min(vs), math.degrees(ang))
    _, centre, L, W, ang = best
    # Normalise the angle to (-90, 90] so the rotation stays small.
    while ang > 90:
        ang -= 180
    while ang <= -90:
        ang += 180
    return centre, L, W, ang


def geom(fid, key=None, role="key"):
    for g in F[fid]["geometry"]:
        if (g["svgKey"] == key) if key is not None else (g["role"] == role):
            return g
    raise KeyError((fid, key))


features: dict = {}
hidden: dict = {}

# ---- BOARD_CHECK: proportions measured on the Ministry boards (user photos, refs/boards, 2026-11-18) ----------
# Method: pixel heights on downscaled photos, compared within one depth plane. Scales: IMG_8187 (aerial from the NE)
# the sphinx column's base slab (1.45 m, text) and the drawn figures; IMG_8191 (approach elevation) the propylon's
# plan width (9.32 m) and the sphinx column's drawn diameter (1.19 m, text), which agree within 11%; the drawn
# figures there are about 1.6x too large for that scale and are only used for the houses (same plane as the
# figures). Uncertainties are rough (+/-15-30%).
#   item                          board            model before   action
#   parapet above terrace         1.8 (aerial) /   1.80           kept (elevation 3.4-3.9 disagrees; aerial followed)
#   exposed wall below terrace    ~1.6             >=1.0 (clamp)  clamp drop 1.0 -> 1.6
#   propylon eave / width         0.53 x 9.32=4.9  4.4            kept (within 20%)
#   propylon roof rise            ~1.15            1.6            -> 1.15
#   propylon ridge sculpture      ~1.0 x 0.9       0.7 x 0.5      -> 1.0 x 0.8
#   propylon columns H/D          ~9 (slender)     ~6             kept (text: 6 and 5.5 diameters, p. 78)
#   altar rear top above court    ~2.5             2.2            screen 1.0 -> 1.3
#   altar length / court width    ~0.9-1.0         0.88           kept
#   court statue plinths          4, ~0.6 m, one row on the west edge   6 in two rows, 1.0 m   -> 3 + the legend-6 base
#   north long base (base-north)  ~2.5 tall        1.0            -> 2.5
#   sphinx column capital top     ~11.3-13.3       12.3           kept
#   cistern well-head             ~0.25 low ring   0.7            -> 0.25
#   NE corner                     enclosure wall + ashlar corner to the sloping hill; knoll plate   knoll hidden, wall added

# ---- walls (terrace retaining walls flush with the upper ground) ------------------------------------------
wn, ww, ws, wse, we = (WALLS[k] for k in ("terrace_wall_n", "terrace_wall_w", "terrace_wall_s", "terrace_wall_s_east", "terrace_wall_e"))
ZN = (wn["centreline"][0][1] + wn["centreline"][1][1]) / 2
XW = (ww["centreline"][0][0] + ww["centreline"][1][0]) / 2
ZS = (ws["centreline"][0][1] + ws["centreline"][1][1] + wse["centreline"][0][1] + wse["centreline"][1][1]) / 4
E0, E1, E2 = we["centreline"]
PROP = F["propylon"]
PX0, PX1 = 18.65, 27.97  # propylon side walls' outer faces (plan outline 18.6 / 28.0; inner 19.45 / 27.17)
PZ0, PZ1 = 12.71, 25.19


def east_x(z):
    """x of the east wall centre line at z (first leg)."""
    return E0[0] + (E1[0] - E0[0]) * (z - E0[1]) / (E1[1] - E0[1])


SE_CORNER = [east_x(ZS + 0.4), ZS + 0.4]
# Approach to the gate (Ministry approach board IMG_8191, user decision 2026-11-20): broad, low ashlar terraces
# running along the wall front from the fence wall to the SE houses' rock. The top tier is at the propylon floor
# (terrace height) and carries the propylon's southward projection; then TIER_N - 1 tiers of TIER_RISE each, then
# the plaza. Total climb DERIVED from the drawing, reduced from 4 m once spread over the slope (the board's lower
# courses lie nearer the viewer, so the elevation overstates their drop).
TIER_RISE, TIER_N, TIER_DEPTH = 0.30, 8, 0.9
TIER1_SOUTH = 26.2  # the top tier reaches 1 m beyond the propylon's front (25.19)
APPROACH_RISE = TIER_RISE * TIER_N  # plaza level below the terrace (2.4 m)
# A point 0.275 m back along the great wall's north leg from its east end (where wall-se now ends, buried in it).
_wn0, _wn1 = [r3(XW), r3(ZN)], pt(wn["centreline"][1])
_wl = math.hypot(_wn1[0] - _wn0[0], _wn1[1] - _wn0[1])
NWS_END_IN = [_wn1[0] - (_wn1[0] - _wn0[0]) / _wl * 0.275, _wn1[1] - (_wn1[1] - _wn0[1]) / _wl * 0.275]
# Enclosure parapet on the terrace wall (Ministry board a/c: natural-stone socle + mudbrick superstructure with a
# coping, hiding the temple's krepis from outside). Total height DERIVED from that constraint: an observer's eye
# (1.6 m) on the highest approach ground just outside the south wall (DEM: about 0.16 m above the terrace, west of
# the propylon) sees over anything lower, so the parapet must reach about 1.75 m above the terrace; rounded to
# 1.80 m (checked in tests/unit/sanctuary-data.test.ts against sight lines from the approach).
# BOARD CHECK (photos 2026-11-18, refs/boards, measured on the drawings; see BOARD_CHECK below): the NE aerial
# (IMG_8187) scaled by the sphinx column's base slab (1.45 m, Furtwängler) drawn beside the north wall gives a
# parapet of about 1.8 m (+/-0.4) above the terrace, coping included: confirmed. The approach elevation (IMG_8191)
# draws the wall top 0.77 x the propylon's eave height above its floor (3.4-3.9 m); the two boards disagree, and
# the aerial, with a physical scale in the same plane, is followed.
PARAPET_H = 1.80
SOCLE, COPING = 0.70, 0.15
PARAPET = {
    "socle": board(SOCLE, "m", "natural-stone socle below the mudbrick; height not legible on the board", "conjectural"),
    "mudbrick": board(r3(PARAPET_H - SOCLE - COPING), "m", f"mudbrick superstructure; total parapet {PARAPET_H:.2f} m above the terrace so the wall hides the krepis from the approach (eye 1.6 m on ground up to 0.16 m above the terrace outside the wall)", "analogy"),
    "coping": board(COPING, "m", "tiled coping course", "conjectural"),
    "overhang": board(0.10, "m", "coping projection beyond each face", "conjectural"),
}
NE_ASHLAR = {
    "socle": board(r3(PARAPET_H - COPING), "m", "the NE corner is ashlar up to the coping (IMG_8187: coursed blocks to the top, coping line level with the mudbrick parapet)", "analogy"),
    "mudbrick": board(0, "m", "no mudbrick at the NE corner (IMG_8187)", "analogy"),
    "coping": board(COPING, "m", "coping course, level with the parapet coping", "conjectural"),
    "overhang": board(0.10, "m", "coping projection beyond each face", "conjectural"),
}
features["terrace-wall-nws"] = {
    "kind": "wall", "name": "Great terrace and enclosure wall (south, west, north)", "role": "terrace",
    "polyline": [[PX0 + 0.35, r3(ZS)], [r3(XW), r3(ZS)], [r3(XW), r3(ZN)], pt(wn["centreline"][1])],
    "thickness": plan(ww["thickness"], "m", ww["uncertaintyM"], "one thickness for the run; text: north 1.43 m at the top, south 0.83 m upper wall (pp. 85-91)"),
    "height": derived(0, "m", "retaining wall top flush with the terrace (pp. 77, 86); the enclosure parapet stands on it"),
    "top": "level", "masonry": "rubble", "parapets": [dict(PARAPET, segments=[0, 1, 2])],
    "phase": NEW, "placement": placement(None, max(wn["uncertaintyM"], ww["uncertaintyM"], ws["uncertaintyM"]), "attested"),
    "sourceIds": [FW, WP, MIN], "confidence": "attested",
    "note": "Ends inside the propylon's west side wall; the north wall stops where the rock reaches terrace height (NE knoll, p. 85). Enclosure parapet (stone socle, mudbrick, tiled coping) after the Ministry board: from outside it hides the krepis. CONFLICT between the Ministry boards: the NE aerial (IMG_8187, scaled by the column's 1.45 m base slab) gives a parapet of about 1.8 m above the terrace; the approach elevation (IMG_8191) draws it about 3.4-3.9 m above the propylon floor. User decision 2026-11-18: keep 1.8 m (the aerial).",
}
features["terrace-wall-se"] = {
    "kind": "wall", "name": "South terrace wall east of the propylon, east peribolos (north leg), NE corner and north wall east of the knoll", "role": "terrace",
    # Continues past the NE corner along the terrace's north edge (IMG_8187: the enclosure wall runs north of the
    # cistern and the sphinx column) and ends inside the great wall's north leg (buried 0.27 m, no coplanar ends).
    "polyline": [[PX1 - 0.35, r3(ZS)], pt([wse["centreline"][1][0], ZS]), pt(SE_CORNER), pt(E0), [33.3, -18.63], [29.75, r3(ZN)], pt(NWS_END_IN)],
    "thickness": derived(0.85, "m", "one thickness for the run: south upper wall 0.83 m (p. 91), east wall 0.70-1.0 m (p. 86); the orthostate wall is 0.40 m (p. 91)"),
    "height": derived(0, "m", "retaining wall top flush with the terrace"),
    "top": "level", "masonry": ["rubble", "rubble", "ashlar", "ashlar", "rubble", "rubble"],
    # The last segment's coping is 1 cm lower so its buried end never shares the great wall's coping top plane.
    "parapets": [dict(PARAPET, segments=[0, 1, 4]), dict(NE_ASHLAR, segments=[2, 3]),
                 dict(PARAPET, coping=board(r3(COPING - 0.01), "m", "tiled coping course; 1 cm lower where this run ends inside the great wall (no coincident faces)", "conjectural"), segments=[5])],
    "phase": NEW, "placement": placement(None, max(wse["uncertaintyM"], we["uncertaintyM"]), "attested"),
    "sourceIds": [FW, WP, MIN], "confidence": "attested",
    "note": "Turns 9.70 m east of the propylon (p. 91) along the east wall's line; one mitred run so the corners stay clean. South legs and the north wall: enclosure parapet as on the great wall; east leg and NE corner: tall ashlar retaining wall up to the coping, down to the sloping hillside (Ministry board IMG_8187). The text has no wall where the rock reaches terrace height at the NE (p. 85); the board's enclosure is followed.",
}
se_dir = [E1[0] - SE_CORNER[0], E1[1] - SE_CORNER[1]]
se_len = math.hypot(*se_dir)
E_START = [SE_CORNER[0] + se_dir[0] / se_len * 0.9, SE_CORNER[1] + se_dir[1] / se_len * 0.9]
features["terrace-wall-e"] = {
    "kind": "wall", "name": "East peribolos wall south of the terrace (older)", "role": "terrace",
    "polyline": [pt(E_START), pt(E1), pt(E2)],
    "thickness": derived(0.85, "m", "text gives 0.70-1.0 m (p. 86); mid value"),
    "height": derived(0, "m", "top follows the ground it retains; low parapet only conjectured (p. 86)"),
    "top": "follow", "masonry": "older", "phase": phase("Middle period, mid-6th c. (reused)", -560, None, "attested", "Older than the other terrace walls; lower courses kept (p. 86)"),
    "placement": placement(None, we["uncertaintyM"], "attested"), "sourceIds": [FW, WP, MIN], "confidence": "attested",
    "note": "Older masonry, drawn in a different technique on the Ministry board (own material id).",
}
features["lower-south-wall"] = {
    "kind": "wall", "name": "Lower south retaining wall of the outer terrace", "role": "terrace",
    # Ends 0.7 m short of the plan's end so its plaza-level top stays clear of the higher SE houses' rock terrace.
    "polyline": [[11.41, 41.6], [r3(31.32 - 0.7 * 19.91 / 19.978), r3(43.25 - 0.7 * 1.65 / 19.978)]],
    "thickness": plan(0.65, "m", F["lower_south_wall"]["uncertaintyM"]),
    "height": derived(0, "m", "top flush with the outer terrace; 1.20 m stone fill behind (p. 101)"),
    "top": "level", "baseLevel": r3(S_REL_BASE - APPROACH_RISE),  # flush with the plaza, not with the highest ground under it
    "phase": NEW, "placement": placement("lower_south_wall", conf="attested"),
    "sourceIds": [FW, WP], "confidence": "attested",
    "hiddenReason": "Not drawn on the Ministry boards; walls are shown around the temple only, none beside the priests' houses (user decision 2026-11-21).",
    "note": "About 20 m south of the propylon, about 15 m continuous (p. 101). Side gate (0.95 m) at its east end not modelled.",
}
features["fence-wall"] = {
    "kind": "wall", "name": "Fence wall west of the propylon", "role": "fence",
    # Points at the approach tiers' edges so its top steps down with them (top 'follow').
    "polyline": [[15.07, 23.25]] + [[r3(15.07 + (15.65 - 15.07) * (z - 23.25) / (33.31 - 23.25)), r3(z)] for z in [TIER1_SOUTH + k * TIER_DEPTH for k in range(TIER_N)] if z < 33.31] + [[15.65, 33.31]],
    "thickness": text(0.30, "m", "101"), "height": text(0.7, "m", "101", "slabs about 0.7 m high"),
    "hiddenReason": "Flanked the broad approach terraces; the stair is now only as wide as the gate building and the Ministry boards draw no fence (user decision 2026-11-21).",
    "top": "follow", "phase": NEW, "placement": placement("fence_wall", conf="analogy", note="south part dashed (reconstructed) on the plan"),
    "sourceIds": [FW, WP], "confidence": "analogy",
}

# ---- terraces ------------------------------------------------------------------------------------------------
main_poly = [
    [r3(XW), r3(ZN)], pt(wn["centreline"][1]), [29.75, r3(ZN)], [33.3, -18.63], pt(E0),
    pt(SE_CORNER), pt([wse["centreline"][1][0], ZS]), [r3(XW), r3(ZS)],
]
knoll_poly = [pt(wn["centreline"][1]), [29.75, r3(ZN)], [33.3, -18.63], pt(E0), [40.8, -20.5], [34.0, -25.5], [18.0, -24.5]]
ROCK_W = 29.9  # west edge of the houses' rock: it reaches the lean-to's west face and runs back to the wall (user decision 2026-11-21)
plaza_full = [[15.0, r3(ZS)], [ROCK_W, r3(ZS)], [ROCK_W, 30.0], [31.3, 43.0], [11.4, 41.6], [11.67, 39.71], [12.85, 36.84], [14.47, 34.65], [15.65, 33.31], [15.07, 23.25]]


def clip_z(poly, z0, z1):
    """Part of a polygon between z0 and z1 (Sutherland-Hodgman against two half-planes; this outline is z-monotone enough)."""
    def half(pts, keep, zc):
        out = []
        for i, p in enumerate(pts):
            q = pts[(i + 1) % len(pts)]
            pin, qin = keep(p[1]), keep(q[1])
            if pin:
                out.append(p)
            if pin != qin:
                t = (zc - p[1]) / (q[1] - p[1])
                out.append([p[0] + t * (q[0] - p[0]), zc])
        return out
    pts = half(poly, lambda z: z >= z0 - 1e-9, z0) if z0 is not None else poly
    pts = half(pts, lambda z: z <= z1 + 1e-9, z1) if z1 is not None else pts
    clean = []
    for p in pts:
        p = [round(p[0], 9), round(p[1], 9)]  # full precision: shared edges must stay exactly on the neighbours' lines
        if not clean or abs(p[0] - clean[-1][0]) > 1e-6 or abs(p[1] - clean[-1][1]) > 1e-6:
            clean.append(p)
    if len(clean) > 1 and abs(clean[0][0] - clean[-1][0]) < 1e-6 and abs(clean[0][1] - clean[-1][1]) < 1e-6:
        clean.pop()
    return clean


tier_z = [ZS] + [TIER1_SOUTH + k * TIER_DEPTH for k in range(TIER_N)]  # tier k spans tier_z[k]..tier_z[k+1]
def clip_x(poly, x0, x1):
    """Part of a polygon between x0 and x1 (clip_z on the swapped axes)."""
    sw = lambda q: [[p[1], p[0]] for p in q]
    return sw(clip_z(sw(poly), x0, x1))


# The stair is only as wide as the gate building (user decision 2026-11-21); the plaza level fills either side.
STAIR_X0, STAIR_X1 = PX0, PX1
approach_tiers = [clip_x(clip_z(plaza_full, tier_z[k], tier_z[k + 1]), STAIR_X0, STAIR_X1) for k in range(TIER_N)]
plaza_poly = clip_z(plaza_full, tier_z[-1], None)
plaza_side_w = clip_x(clip_z(plaza_full, None, tier_z[-1]), None, STAIR_X0)
plaza_side_e = clip_x(clip_z(plaza_full, None, tier_z[-1]), STAIR_X1, None)
se_poly = [[ROCK_W, r3(ZS)], pt(SE_CORNER), pt(E1), [54.4, 41.5], [55.4, 47.2], [42.9, 47.2], [31.3, 43.0], [ROCK_W, 30.0]]
SUED = {"x0": -5.0, "x1": 20.0, "z0": r3(ZS + 33.0), "w": 6.0}
sued_poly = [[SUED["x0"], SUED["z0"]], [SUED["x1"], SUED["z0"]], [SUED["x1"], SUED["z0"] + SUED["w"]], [SUED["x0"], SUED["z0"] + SUED["w"]]]

OUTER = {"polygon": plaza_poly, "level": board(r3(S_REL_BASE - APPROACH_RISE), "m", f"plaza at the foot of the approach terraces, {APPROACH_RISE:.1f} m below the terrace (IMG_8191: about 4 m drawn, +/-1 m, read lower once spread over the slope); the propylon floor stays at terrace height (p. 77)", "analogy"),
                  "clampDrop": board(0, "m", "IMG_8191: the open slope west of the approach lies at about the plaza's level along the wall foot, so the ground next to the plaza is not held below it", "analogy"),
                  "fillDrop": board(0.5, "m", "CONJECTURAL softening: next to the plaza the ground is raised to at most 0.5 m below it, feathered back to the DEM, toward the board's gentle slope south of the gate (IMG_8191)", "conjectural"),
                  "falloff": {"edgeDrop": conj(2.0, "m", "lower south wall: three courses on rock, 1.20 m fill (p. 101)"), "slope": conj(0.35, "ratio", "rock slope to the south")},
                  "edgeFace": "rock",
                  "note": "Rock 'rises evenly' toward the propylon (p. 100); modelled flat south of the approach terraces, which take its northern part (Ministry approach board IMG_8191). The priests' houses stand on the rock outcrop above it (rock face on the SE terrace's edge)."}

terrain = {
    "confidence": "conjectural",
    "sourceIds": [FW, WP],
    "note": "Natural ground from the text (p. 21: steep fall east and north, gentler west and south; NE knoll at terrace height with a rock face to the cave; Südbau about 9 m below the stylobate, pp. 102-103); terrace surface at the base of the lowest step (pp. 69, 77). The scan covers only the temple (today's excavated ground) and is not used.",
    "terraces": {
        "temple-terrace": {"polygon": main_poly, "level": derived(r3(S_REL_BASE), "m", "base of the lowest krepis step = -(crepidomaStepCount x crepidomaStepRise); surface 'in der Höhe der Unterstufe' (p. 69)"),
                           "note": "Edges on the terrace walls' centre lines (plan)."},
        "ne-knoll": {"polygon": knoll_poly, "level": derived(r3(S_REL_BASE), "m", "rock rises to terrace height at the NE corner (p. 85)"),
                     "hiddenReason": "Trimmed (2026-11-18): the plan and text support the terrace only to its dashed north edge; the Ministry board (IMG_8187) shows the enclosure wall there with the hillside sloping below, so the real (corrected) hill takes over.",
                     "falloff": {"edgeDrop": conj(3.2, "m", "vertical rock face down to the cave entrance (cave 1.5-1.8 m high, p. 88)"), "slope": conj(0.8, "ratio", "steep east and north")},
                     # Edges 0-2 adjoin the temple terrace (same level, no face). East edges: the tall ashlar retaining
                     # wall of the NE corner (Ministry board b); north edges: the rock face above the cave (p. 88).
                     "edgeFaces": ["ashlar", "ashlar", "ashlar", "ashlar", "ashlar", "rock", "rock"],
                     "note": "Outline beyond the plan's dashed (no-wall) north edge is conjectural. East faces ashlar (Ministry board: tall ashlar retaining wall at the NE corner), north faces natural rock (Furtwängler p. 88)."},
        "outer-terrace": OUTER,
        **{f"outer-terrace-{side}": dict(OUTER, polygon=poly_, note="Plaza level beside the stair (the stair is only as wide as the gate building).")
           for side, poly_ in (("west", plaza_side_w), ("east", plaza_side_e))},
        **{f"approach-tier-{k + 1}": {
            "polygon": approach_tiers[k],
            "level": board(r3(S_REL_BASE - TIER_RISE * k), "m", f"approach terrace {k + 1} of {TIER_N}: {TIER_RISE:.2f} m below the one above (riser kept <= 0.35 m for walking; course height on IMG_8191 about 0.3-0.7 m)", "analogy"),
            "edgeFace": "ashlar",
            "note": ("Top tier at the propylon floor (terrace height), carrying the propylon's southward projection so it reads as set into the wall line. " if k == 0 else "")
                    + f"Broad, low ashlar course along the wall front, {TIER_DEPTH:.1f} m deep, from the fence wall to the SE houses' rock (IMG_8191: long low courses with stepped ends; DERIVED, conjectural depth).",
        } for k in range(TIER_N)},
        "se-houses-terrace": {"polygon": se_poly, "level": board(r3(S_REL_BASE), "m", f"the houses' rock outcrop about level with the top approach course, so the houses stand {APPROACH_RISE:.1f} m above the plaza (IMG_8191 draws them 2-3 m above it, +/-0.7 m); the text gives no absolute level here, only a rock ridge falling SE (p. 91). Reached from the top approach tier at the same level.", "analogy"),
                              "falloff": {"edgeDrop": conj(2.5, "m", "east wall's outer corner 'schon ganz tief' (p. 91)"), "slope": conj(0.7, "ratio", "steep fall to the east and south-east (p. 98)")},
                              "edgeFace": "rock", "note": "The houses stand on a rock outcrop (Ministry board; rock ridge, p. 91): exposed edges are battered, faceted rock faces down to the plaza and the slope. Level with the top approach tier, which leads onto it (the vestibule's entrance needs no stair)."},
        "suedbau-terrace": {"polygon": sued_poly, "level": text(-9.0, "m", "102", "about 9 m below the stylobat"),
                            "falloff": {"edgeDrop": conj(1.0, "m", "south edge of the Südbau terrace"), "slope": conj(0.3, "ratio", "south slope")},
                            "hiddenReason": "Südbau terrace: not depicted in the Ministry reconstruction; shape unknown (user decision 2026-11-18).",
                            "note": "Off the plan sheet; x position conjectural; width conjectural."},
    },
    "falloff": {
        "edgeDrop": {
            "n": derived(2.9, "m", "seven exposed courses of 0.41 m on the north wall (p. 88)"),
            "e": derived(2.5, "m", "made ground about 1.90 m deep behind the east wall at the altar (p. 72) plus the steep east slope"),
            "s": derived(2.0, "m", "south wall outside ground rising toward the propylon (pp. 90-91, 100)"),
            "w": derived(2.75, "m", "west end built up about 2.5-3 m over the rock (7 foundation courses, pp. 21-23)"),
        },
        "slope": {
            "n": conj(0.6, "ratio", "'fällt steil' to the north (p. 21)"),
            "e": conj(0.7, "ratio", "steep east slope ('steile Osthalde')"),
            "s": conj(0.28, "ratio", "about 15 degrees, set so the ground is about 1.8 m above the Südbau at its north wall"),
            "w": conj(0.25, "ratio", "'fällt gleichmässig' to the west (p. 21)"),
        },
        "radius": conj(60, "m", "extent of the modelled hilltop"),
    },
    "dem": {
        "file": "measurements/hilltop.json + measurements/landscape.json (PNG16 heightfields in the temple frame)",
        "ref": "copernicus-dem-glo30", "verified": True,
        "note": "User decision 2026-11-17: beyond the terraces the real hill and coast from the Copernicus DEM; the directional falloff above is only the fallback when no DEM is supplied.",
        "nearTerraceClamp": {
            "radius": conj(15, "m", "feather distance back to the DEM"),
            "drop": board(1.6, "m", "least exposed height of the retaining wall below the terrace: IMG_8191 draws the wall about 1.9 x the parapet above the outside ground (exposed about 0.9 x parapet = 1.6 m, +/-0.5); IMG_8187 shows about 1.5 m of ashlar below the parapet at the NE corner", "analogy"),
            "hold": conj(6.0, "m", "fully applied this close to the edge (one coarse-tier grid cell), then feathered"),
            "note": "CONJECTURAL correction (lead decision 2026-11-18): the DEM is a surface model with modern spoil heaps and trees, which rises near the parapet outside the SW wall. Within 6 m of a terrace edge the ground is held at least 1.6 m below that terrace (board-derived), feathered back to the DEM by 15 m.",
        },
    },
}

# ---- temple-adjacent values ------------------------------------------------------------------------------------
temple = {
    "foundationDepth": derived(3.0, "m", "west end of the terrace built up about 2.5-3 m (7 foundation courses, pp. 21-23); the skirt hides any gap to the terrain"),
    "rampWidth": plan(3.03, "m", F["ramp_way"]["uncertaintyM"], "the text gives no width"),
    "note": "Ramp: slope 1:6 and 4.80 m long to the second step (pp. 25, 69) - with the provisional step rise the resolver's ramp is shorter (see dimensions.json).",
}

# ---- altar, court, way, bases ----------------------------------------------------------------------------------
alt = F["altar"]
ac, aL, aW, aang = obb(geom("altar")["points"])
features["altar"] = {
    "kind": "altar", "name": "Great altar", "center": pt(ac), "rotation": 0,
    "length": plan(min(aL, aW), "m", alt["uncertaintyM"], "E-W; the text restores 10 ft = 3.27 m (p. 73), not verified"),
    "width": text(13.08, "m", "72-73", "foundation length N-S, 40 ft of 0.327 m"),
    "height": conj(1.2, "m", "superstructure not preserved; height by analogy (p. 73)"),
    "steps": {"count": conj(3, "count", "'eine grosse Freitreppe' (p. 73), number unknown"), "rise": conj(0.3, "m", "step rise"), "tread": conj(0.35, "m", "step tread"), "side": "w"},
    "backScreen": {"height": board(1.3, "m", "raised rear: IMG_8187 draws the altar's end face about 2.0 m high at the court side (scale: drawn figures and the column base), rising to about 2.5 m (+/-0.5) at the rear; rear top = altar 1.2 + 1.3", "analogy"), "thickness": board(0.6, "m", "thickness of the raised rear", "conjectural")},
    "phase": NEW, "placement": placement("altar", conf="attested", note=f"plan centre; text: 22.5 m from the stylobate step (p. 69), plan gives {ac[0]-min(aL,aW)/2-DIMS['stylobateLength']['value']/2:.2f} m"),
    "sourceIds": [FW, WP, MIN], "confidence": "attested",
    "note": "A long raised block with a raised rear on the paved court (Ministry board b, legend 4-5); heights conjectural (analogy with Agrigento, p. 73).",
}
altar_west = ac[0] - min(aL, aW) / 2
steps_w = 3 * 0.35
features["altar-court"] = {
    "kind": "pavement", "name": "Altar court",
    "polygon": [[29.95, -7.45], [r3(altar_west - steps_w + 0.05), -7.45], [r3(altar_west - steps_w + 0.05), 7.45], [29.95, 7.45]],
    "thickness": conj(0.10, "m", "slabs on a 0.40 m rammed bed (p. 71)"),
    "phase": NEW, "placement": placement("altar_court", conf="attested", note="width 14.90 m (+/-7.45 m, text p. 71); west edge at row 1 (plan detail lines); east edge under the altar steps"),
    "sourceIds": [FW, WP], "confidence": "attested",
}
features["paved-way"] = {
    "kind": "pavement", "name": "Paved way from the temple's east ramp to the altar court",
    "polygon": [[17.5, -1.5], [30.0, -1.5], [30.0, 1.5], [17.5, 1.5]],
    "thickness": conj(0.08, "m", "two slab layers on levelled rock (p. 69); thinner than the court so their tops never coincide"),
    "phase": NEW, "placement": placement("ramp_way", conf="attested", note="ten slab rows (p. 69); width from the plan (3.03 m), 3 cm narrower than the ramp so their sides never coincide; starts under the ramp foot, ends inside the court slab"),
    "sourceIds": [FW, WP, MIN], "confidence": "attested",
    "note": "Paved way joining the ramp to the altar court, as on the Ministry board b (legend 7).",
}
# Statue bases lining the court pavement (Ministry board b), placeholder figures; and the tall base in front (legend 6).
COURT_EAST = altar_west - steps_w + 0.05
# IMG_8187: four statues on plinths line the court's west edge, flanking the paved way's join; the northernmost is
# taken as the tall base of legend 6 (statue-base-front), the other three are court bases.
for fid, z in (("court-base-n1", -3.0), ("court-base-s1", 3.0), ("court-base-s2", 5.6)):
    features[fid] = {
        "kind": "base", "name": f"Statue base on the altar court's west edge ({'north' if z < 0 else 'south'} of the paved way)",
        "center": [30.5, z], "rotation": 0,
        "length": board(0.8, "m", "statue plinth", "conjectural"), "width": board(0.8, "m", "statue plinth", "conjectural"),
        "height": board(0.6, "m", "IMG_8187: plinths about a third of the figures' height (+/-0.2 m)", "analogy"),
        "figure": {"height": board(1.7, "m", "standing statue placeholder (life size)", "conjectural"), "width": board(0.5, "m", "placeholder", "conjectural"), "depth": board(0.35, "m", "placeholder", "conjectural")},
        "phase": NEW, "placement": placement(None, 1.5, "conjectural", note="Ministry board IMG_8187: statues on bases along the court's west edge, flanking the paved way; spacing from the drawing", ref=MIN, verified=False),
        "sourceIds": [MIN], "confidence": "analogy",
    }
features["statue-base-front"] = {
    "kind": "base", "name": "Statue base in front of the altar pavement (legend 6), mirror of court-base-s2 across the way", "center": [30.5, -5.6], "rotation": 0,
    "length": board(0.8, "m", "same base as the other court statues (user decision 2026-11-21: symmetric, same level and height)", "conjectural"), "width": board(0.8, "m", "same base as the other court statues", "conjectural"),
    "height": board(0.6, "m", "same height as the other court bases (user decision 2026-11-21)", "analogy"),
    "figure": {"height": board(1.7, "m", "same figure height as the other court statues", "conjectural"), "width": board(0.5, "m", "placeholder", "conjectural"), "depth": board(0.35, "m", "placeholder", "conjectural")},
    "phase": NEW, "placement": placement(None, 3.0, "conjectural", note="Ministry legend 6 'statue base in front of the altar pavement'; placed symmetrically to court-base-s2 on the north side of the paved way", ref=MIN, verified=False),
    "sourceIds": [MIN], "confidence": "attested",
    "note": "Existence attested by the Ministry board (legend 6); position and size conjectural.",
}
pc, pL, pW, pang = obb(geom("plinth_way")["points"])
for i, z in enumerate([pc[1], -pc[1]]):
    features[f"plinth-{'n' if i == 0 else 's'}"] = {
        "kind": "base", "name": f"Plinth beside the head of the way ({'north' if i == 0 else 'south'})",
        "center": [r3(pc[0]), r3(z)], "rotation": 0,
        "length": plan(pL, "m", F["plinth_way"]["uncertaintyM"]), "width": plan(pW, "m", F["plinth_way"]["uncertaintyM"]),
        "height": conj(0.6, "m", "only 4 cm sockets survive (p. 71)"),
        "phase": NEW, "placement": placement("plinth_way", conf="attested" if i == 0 else "analogy", note=None if i == 0 else "mirrored: the north side is symmetric (p. 71)"),
        "sourceIds": [FW, WP], "confidence": "analogy",
        "hiddenReason": "Only 4 cm sockets survive and the Ministry board draws no statue on them; shown as bare blocks they misread as statues (user decision 2026-11-21).",
    }
bn = F["base_north"]
features["base-north"] = {
    "kind": "base", "name": "North base beside the altar court", "center": [r3(bn["centroid"][0]), -12.70], "rotation": 0,
    "length": text(6.25, "m", "74", "superstructure; foundation 6.30 m"), "width": text(0.75, "m", "74"),
    "height": board(2.5, "m", "IMG_8187 draws this long base as a tall block about 2.5 m high (+/-0.7; scale: the column base slab beside it), perhaps a back wall for a sculptural group (legend 16)", "analogy"),
    "phase": NEW, "placement": placement("base_north", conf="attested", note="12.70 m north of the axis (p. 74); x from the plan"),
    "sourceIds": [FW, WP], "confidence": "attested",
}
bs = F["base_south"]
features["base-south"] = {
    "kind": "base", "name": "South base by the propylon", "center": pt(bs["centroid"]), "rotation": 0,
    "length": text(2.22, "m", "74-75", "plinth length"), "width": derived(1.70, "m", "plinth width 'about 1.70 m, not recognisable' (pp. 74-75)"),
    "height": conj(0.8, "m", "unknown"),
    "phase": NEW, "placement": placement("base_south", conf="attested"), "sourceIds": [FW, WP], "confidence": "attested",
}

# ---- water: cistern, settling basin, channel; votive column --------------------------------------------------
cis = F["cistern"]
ccx, ccz = cis["geometry"][1]["centre"]
cr = cis["geometry"][1]["radius"]
features["cistern"] = {
    "kind": "cistern", "name": "Cistern (upper shaft)", "shape": "circle", "center": [r3(ccx), r3(ccz)], "rotation": 0,
    "diameter": text(1.2, "m", "88", "upper shaft inner diameter 1.15-1.22 m"), "rimWidth": plan(cr - 0.6, "m", cis["uncertaintyM"], "rim = plan outer radius minus the shaft radius"),
    "rimHeight": board(0.25, "m", "round well-head drawn as a low ring next to the sphinx column (IMG_8187; about 0.25 m, +/-0.15, against the column base slab); the rim itself is gone (p. 87)", "analogy"),
    "depth": conj(4.0, "m", "depth not stated (Taf. 12,2 not seen); the older 2.5 m shaft below is not modelled"),
    "phase": phase("Older shaft, reworked in the new campaign", -650, None, "attested", "lower shaft older; upper shaft and cleft reworked (p. 88); open and in use c. 490"),
    "placement": placement("cistern", conf="attested", note="plan position kept (user decision 2026-11-18); the Ministry aerial (IMG_8187) draws the cistern and the sphinx column within about 1 m of the north wall, the plan about 5 m"), "sourceIds": [FW, WP, MIN], "confidence": "attested",
    "note": "Shown with a round well-head (Ministry board b).",
}
# Settling basin: pear from the bulb (west) to the tip (toward the cistern), shortened until its rim clears the cistern rim.
bulb, tip = [26.10, -14.15], [29.25, -14.90]
ang = math.degrees(math.atan2(tip[1] - bulb[1], tip[0] - bulb[0]))
dia, small, rim = 1.6, 0.3, 0.12
x_left = 25.48
length = 3.8
while True:
    # left end fixed at the bulb's west edge; centre along the axis
    ux, uz = math.cos(math.radians(ang)), math.sin(math.radians(ang))
    cx, cz = x_left + ux * length / 2, bulb[1] + uz * (length / 2 - dia / 2)
    tipx, tipz = cx + ux * (length / 2 + rim), cz + uz * (length / 2 + rim)
    if math.hypot(tipx - ccx, tipz - ccz) > cr + 0.05 or length < 2.5:
        break
    length -= 0.05
features["settling-basin"] = {
    "kind": "cistern", "name": "Settling basin (pear-shaped)", "shape": "pear", "center": [r3(cx), r3(cz)], "rotation": rot_of(ang),
    "length": plan(length, "m", F["settling_basin"]["uncertaintyM"], "shortened so its rim stops short of the cistern rim"),
    "diameter": plan(dia, "m", F["settling_basin"]["uncertaintyM"]), "smallDiameter": conj(small, "m", "outflow end"),
    "depth": conj(1.0, "m", "not stated"), "rimHeight": conj(0.08, "m", "not stated"), "rimWidth": conj(rim, "m", "mortared rim"),
    "phase": NEW, "placement": placement("settling_basin", conf="attested", note="'birnenförmiges Becken' (pp. 87-88)"),
    "sourceIds": [FW, WP], "confidence": "attested",
}
features["water-channel"] = {
    "kind": "channel", "name": "Water channel along the north steps",
    "polyline": [[-15.65, -8.05], [8.0, -8.05], [25.05, -13.75]],
    "width": plan(0.35, "m", F["water_channel"]["uncertaintyM"]), "depth": conj(0.3, "m", "shallow hollows in large stones (p. 87)"),
    "feeds": "settling-basin", "sunk": True,
    "phase": NEW, "placement": placement("water_channel", conf="attested", note="from the NW corner at the foot of the steps, turning near the third column from the east toward the basin (p. 87)"),
    "sourceIds": [FW, WP, MIN], "confidence": "attested",
    "note": "Partly cut into the rock (Ministry legend 15): its coping is flush with the ground; it leads through the settling basin to the cistern.",
}
features["votive-column"] = {
    "kind": "column", "name": "Sphinx votive column", "center": [28.15, -16.0],
    "baseDiameter": text(1.45, "m", "156-157", "scribed circle on the base slabs"), "baseHeight": conj(0.4, "m", "base slab height"),
    "lowerDiameter": text(1.19, "m", "156-157", "lowest drum"), "upperDiameter": text(0.91, "m", "156-157", "top drum 0.90-0.92 m"),
    "height": derived(11.9, "m", "about 10 lower diameters (p. 157); Wikipedia's 14 m is unverified"),
    "flutes": text(36, "count", "156-157"),
    "capital": {"kind": "ionic", "width": conj(1.9, "m", "volute capital after Cockerell/Haller drawings"), "height": conj(0.6, "m", "capital height")},
    "crowning": {"kind": "sphinx", "height": conj(1.6, "m", "sphinx restored by analogy with the Naxian column at Delphi")},
    "phase": phase("6th c. dedication", -560, None, "attested", "Standing c. 490 BC on the Ministry board b (Furtwängler p. 157 only 'nicht unmöglich')", src=(FW, MIN)),
    "placement": placement("votive_column", conf="analogy", note="moved 0.3 m south of the plan's arc so its base clears the basin (the text says the channel and basin cut its base)"),
    "sourceIds": [FW, WP, MIN], "confidence": "attested",
    "note": "A tall single column, much taller than the propylon, carrying a marble sphinx (Ministry board). Height (about 10 lower diameters) derived; capital and sphinx by analogy.",
}

# ---- propylon ------------------------------------------------------------------------------------------------------
pcx, pcz = (PX0 + PX1) / 2, (PZ0 + PZ1) / 2
door = geom("propylon", "path27016#35")["points"]
door_cx = (min(p[0] for p in door) + max(p[0] for p in door)) / 2
door_z = 20.82
cols = [g["centre"] for g in PROP["geometry"] if g["type"] == "circle"]
inner_hx = (27.17 - 19.45) / 2
features["propylon"] = {
    "kind": "building", "role": "propylon", "name": "Propylon (gate building)", "center": [r3(pcx), r3(pcz)], "rotation": 0,
    "length": plan(PX1 - PX0, "m", PROP["uncertaintyM"], "E-W over the side walls"), "width": plan(PZ1 - PZ0, "m", PROP["uncertaintyM"], "N-S, front to back"),
    "wallThickness": text(0.80, "m", "76", "side walls 0.80 m below, 0.785 m above the ledge"),
    "wallHeight": conj(4.4, "m", "columns assumed 6 and 5.5 lower diameters tall (p. 78) plus a timber architrave"),
    "doors": [], "openSides": ["n", "s"],
    "crossWalls": [{"axis": "x", "offset": r3(door_z - pcz), "from": r3(-inner_hx), "to": r3(inner_hx), "thickness": text(0.60, "m", "76", "door wall"),
                    "doors": [{"offset": r3(door_cx - pcx), "width": text(3.01, "m", "79", "opening without the (reconstructed) timber frame; 2.25 m inside it"), "height": conj(3.6, "m", "door height not preserved")}]}],
    "columns": {"shape": "octagonal", "diameter": plan(0.674, "m", PROP["uncertaintyM"], "text: octagonal, lower diameters only in Abb. 26-27 (not read)"),
                "positions": [to_local([pcx, pcz], 0, c) for c in cols]},
    "architraves": [{"axis": "x", "offset": r3(z - pcz), "from": r3(-inner_hx), "to": r3(inner_hx), "depth": conj(0.4, "m", "timber architrave (p. 79)"), "height": conj(0.35, "m", "timber architrave")}
                    for z in sorted({round(c[1], 1) for c in cols})],
    "roof": {"ridge": "x", "ridgeOffset": r3(door_z - pcz), "ridgeHeight": board(1.15, "m", "IMG_8191: the roof rises about 0.23 x the eave height above the eaves (scale: the propylon's width 9.32 m from the plan); +/-0.3", "analogy"), "overhang": conj(0.4, "m", "eaves"), "tiled": True,
             "confidence": "analogy", "note": "Ridge E-W over the door wall, eaves N and S, gables on the E and W side walls (pp. 79, 82-83)."},
    "roofOrnament": {"width": board(0.8, "m", "small sculpture on the roof ridge (placeholder block); IMG_8191 about 0.9 m wide", "analogy"), "height": board(1.0, "m", "IMG_8191: about 1.0 m (+/-0.3) above the ridge", "analogy")},
    "baseLevel": r3(S_REL_BASE),
    "phase": NEW, "placement": placement("propylon", conf="attested"), "sourceIds": [FW, WP, MIN], "confidence": "analogy",
    "complex": "south-gate",
    "note": "Matches the Ministry board: the only entrance, two columns between antae on each front, a central door, the approach rising from outside (south), a small sculpture on the roof. Floor at terrace height (orthostate cover slabs at terrace level, p. 77); the approach climbs to it over broad low ashlar terraces in front of the wall (terraces approach-tier-1..8; IMG_8191), which carry its southward projection, so no separate stair. The stair-side conflict with the plan is resolved by the board (sources.json choices.propylon-stairs-south).",
}

# ---- priests' houses (Ministry boards; blockout, rebuilt from scratch 2026-11-21) ------------------------------------
# Two blocks on the rock outcrop outside the boundary wall, under hipped tiled roofs (IMG_8187 aerial from the NE,
# IMG_8191 approach view; the boards win over Furtwängler's plan, user decision). Frame: u along the south wall's
# east leg from where the stretch beside the propylon ends (36.436/20.583: on IMG_8187 the wall runs 8.8 m east of
# the propylon and stops at the rear block), v toward the south. The blocks are parallel to the wall.
H_O = [36.436, 20.583]
H_A = math.atan2(20.983 - 20.583, 49.271 - 36.436)  # wall direction (math angle in x/z)
H_ROT = rot_of(math.degrees(H_A))
WALL_FACE = 0.85 / 2 + 0.10 + 0.02  # the wall's south face, its coping projection, a hair
WALL_IN = -(0.85 / 2 + 0.10 + 0.03)  # the houses' back wall: one with the boundary wall, a hair proud of its coping on the sanctuary side (Ministry boards)
H_PITCH = math.radians(17)  # common roof pitch (both boards: low tiled roofs), conjectural


def wall_frame(u0, u1, v0, v1):
    """Centre (world), length (along u) and width (along v) of the box u0..u1 x v0..v1 in the houses' frame."""
    cu, cv = (u0 + u1) / 2, (v0 + v1) / 2
    c, s_ = math.cos(H_A), math.sin(H_A)
    return [r3(H_O[0] + c * cu - s_ * cv), r3(H_O[1] + s_ * cu + c * cv)], r3(u1 - u0), r3(v1 - v0)


REAR = (0.2, 12.3, WALL_IN, WALL_FACE + 6.4)  # u0, u1, v0, v1
BURY = 0.3  # the front block's north wall runs 0.3 m into the rear block (they abut on IMG_8187; no shared face)
FRONT = (1.5, 12.2, REAR[3] - BURY, REAR[3] + 10.0)  # east face 0.1 m inside the rear block's (no shared plane)
REAR_EAVE, FRONT_EAVE = 4.9, 3.9
LEAN = (-3.0, 0.5, REAR[2] - 0.03, REAR[3] - 0.03)  # low shed on the rear block's west face, its full width (IMG_8191, left of the porch); 0.3 m into the rear block


def house_block(bid, name, box, eave, notes, porch=None, shed=None, doors=None):
    c, L, W = wall_frame(*box)
    rise = r3(shed if shed else min(L, W) / 2 * math.tan(H_PITCH))
    return {"id": bid, "name": name, "center": c, "rotation": H_ROT,
            "length": board(L, "m", notes["length"], "analogy"), "width": board(W, "m", notes["width"], "analogy"),
            "eaveHeight": board(eave, "m", notes["eave"], "analogy"),
            "roofRise": board(rise, "m", f"hipped roof at a pitch of about {math.degrees(H_PITCH):.0f} degrees (both boards draw low tiled roofs; +/-5 degrees)", "conjectural"),
            "overhang": conj(0.4, "m", "eaves"),
            **({"porch": porch} if porch else {}), **({"roof": "shed"} if shed else {}), **({"doors": doors} if doors else {})}


features["priests-houses"] = {
    "kind": "houses", "name": "Priests' houses (later priests' houses, legend 17)",
    "blocks": [
        house_block("lean-to", "Lean-to with a door, on the rear block", LEAN, 2.5, {
            "length": "lean-to projecting west from the rear block (IMG_8191, left of the porch)",
            "width": "the full width of the rear block it leans on (IMG_8191)",
            "eave": "low eave about 1.5 x the drawn figures; the roof rises toward the main block (IMG_8191), door in the west face"}, shed=0.5,
            doors=[{"side": "-x", "offset": 0.0, "width": board(1.4, "m", "doorway in the lean-to's west face (IMG_8191)", "analogy"), "height": board(2.2, "m", "door height (IMG_8191)", "analogy")}]),
        house_block("rear", "Rear block against the boundary wall", REAR, REAR_EAVE, {
            "length": "along the wall from the end of the stretch beside the propylon to the east wall (IMG_8187)",
            "width": "depth from the wall; the block is a long rectangle along it (IMG_8187, IMG_8191)",
            "eave": "the taller block (IMG_8191), eave above the outcrop by the drawn figures (1.7 m)"},
            doors=[{"side": "-z", "offset": 1.65, "width": board(1.4, "m", "door from the houses into the sanctuary through the wall line (IMG_8187)", "analogy"), "height": board(2.4, "m", "door height, a little over a figure (IMG_8187)", "analogy")}]),
        house_block("front", "Front block, roughly square", FRONT, FRONT_EAVE, {
            "length": "east face in line with the rear block's, west face set back from it (IMG_8187)",
            "width": "roughly square in plan (IMG_8187; near-pyramidal roof on IMG_8191)",
            "eave": "the lower block (IMG_8191), eave above the outcrop by the drawn figures (1.7 m)"},
            porch={"columns": 4, "depth": board(2.2, "m", "open porch recess on the west face (IMG_8191: columns on the face toward the gate)", "analogy"),
                   "endWall": board(2.6, "m", "solid wall at the south end of the face (IMG_8191), the rest open between four Doric columns (user decision 2026-11-21)", "analogy")}),
    ],
    "phase": BORDER, "placement": placement(None, 1.5, "analogy", note="placed from the Ministry boards against the boundary wall's south leg; the plan's room groups (I, II-IV) lie here, about 12 degrees askew", ref=MIN, verified=False),
    "sourceIds": [MIN, FW], "confidence": "analogy",
    "note": "Blockout massing after the Ministry boards: built against the outside of the boundary wall on the rock outcrop, reached only from outside; hipped tiled roofs (many tile fragments, p. 99). Group I and room II start with the new campaign, III and IV about the temple's completion (p. 99).",
}

# ---- Südbau (off the sheet; text placement) -------------------------------------------------------------------------
SUED_UNC = "Off the plan sheet: about 33 m south of the peribolos and about 9 m below the stylobat (p. 102); x and width conjectural."
sued_ph = phase("New period", -510, None, "attested", "p. 160")
sued_place = placement(None, 5.0, "conjectural", note=SUED_UNC, ref=FW, verified=False)
SUED_HIDDEN = "Not depicted in the Ministry reconstruction; shape unknown (user decision 2026-11-18)."
zN, zS2 = SUED["z0"], SUED["z0"] + SUED["w"]
features["suedbau-north-wall"] = {
    "kind": "wall", "name": "Südbau north wall", "role": "terrace", "polyline": [[SUED["x0"], zN], [SUED["x1"], zN]],
    "thickness": conj(0.7, "m", "not stated"), "height": derived(0, "m", "top flush with the slope above; restored about 1.80 m above the Südbau floor (p. 103)"),
    "top": "level", "phase": sued_ph, "placement": sued_place, "sourceIds": [FW, MIN], "confidence": "conjectural",
    "hiddenReason": SUED_HIDDEN,
    "note": "Südbau: placed from text distances only; a terrace structure (rest or camp area), not a roofed building (pp. 102-104). Kept in the data, hidden.",
}
features["suedbau-south-wall"] = dict(features["suedbau-north-wall"], name="Südbau south wall", polyline=[[SUED["x0"], zS2], [SUED["x1"], zS2]],
                                      height=derived(0, "m", "top flush with the Südbau terrace"))
for k, x in enumerate([SUED["x0"] + 25 / 3, SUED["x0"] + 50 / 3]):
    features[f"suedbau-cross-wall-{k + 1}"] = dict(features["suedbau-north-wall"], name=f"Südbau cross wall {k + 1}", role="other",
                                                   polyline=[[r3(x), r3(zN + 0.2)], [r3(x), r3(zS2 - 0.2)]], thickness=conj(0.6, "m", "not stated"),
                                                   height=text(1.80, "m", "103", "restored wall height"), baseLevel=-9.0)

# ---- hidden: earlier / later / unmodelled ---------------------------------------------------------------------------
def hide(hid, name, label, fr, to, reason, src=(FW, WP), conf="attested"):
    hidden[hid] = {"name": name, "phase": phase(label, fr, to, conf, src=src), "sourceIds": list(src), "reason": reason}


# Removed from the model at the user's request (2026-11-21): Room I 1 and the small bath east of the propylon.
for _hid, _name, _label, _fr in (("se-room-i1", "Room I 1 beside the propylon", "New period", -510), ("se-bath", "Small bath (V)", "New period", -480)):
    hide(_hid, _name, _label, _fr, None, "Removed from the model at the user's request (2026-11-21); previously modelled, see git history.")
hide("old-altar-6th", "Altar of the 6th c.", "Middle period", -580, -510, "Earlier: buried under the altar court (p. 155)")
hide("old-altar-7th", "Altar of the 7th c. (oldest)", "Oldest period", -700, -560, "Earlier: one course on rock next to the ramp (pp. 154-155)")
hide("old-propylon", "Older propylon", "6th c.", -580, -510, "Earlier: under the south part of the altar court (pp. 151-154)")
hide("old-houses", "Older priests' houses", "Oldest period", -700, -510, "Earlier: buried under the terrace (pp. 151-154)")
hide("old-peribolos-7th", "Peribolos of the 7th c.", "Oldest period", -700, -560, "Earlier (plan, blue)")
hide("old-peribolos-6th", "Peribolos of the 6th c.", "Middle period", -580, -510, "Earlier (plan, green)")
hide("old-structure-7th", "7th-c. foundation near the north base", "Oldest period", -700, -560, "Earlier (plan, blue)")
hide("circular-substructions", "Circular substructions (7th c.)", "Oldest period", -700, -560, "Earlier (plan, blue)")
hide("older-temple", "Older temple", "Middle period", -570, -510, "Earlier: dismantled; reused in the fill and the Südbau (pp. 116-150)", src=(FW,))
hide("remodelling-4th-c", "Mid-4th-c. remodelling of the altar and SE buildings", "4th c.", -360, -300,
     "Later; stated by the Ministry text only (conflict with Fiechter)", src=("moc-odysseus-aphaia",), conf="conjectural")
hide("west-buildings", "West buildings A-C (60-240 m west)", "New period", -510, None, "Outside the modelled site (pp. 105-114)", src=(FW,))
hide("cockerell-base", "Small base before the north half of the east front", "Unknown", None, None, "Date unknown (present in 1811, p. 75)")
hide("walls-south-of-temple", "Unlabelled wall traces south of the temple", "Unknown", None, None, "Function unknown; probably building-site walls under the fill (pp. 158-159)")
hide("se-staircase", "Staircase I 6 in the SE houses", "New period", -510, None, "Interior detail not modelled at this scale")
hide("outer-terrace-structures", "Unlabelled structures on the outer terrace", "Unknown", None, None, "Function unknown (plan only)", src=(WP,))

doc = {
    "meta": {
        "status": "provisional",
        "note": "Built by tools/sanctuary/build_sanctuary.py from the research brief (Furtwängler 1906, text) and measurements/sanctuary-plan.json (Wikimedia plan, digitised). Verified text numbers win on numbers; the plan places and shapes; CONJECTURAL entries are labelled and provisional.",
        "displayYear": -490,
        "displayLabel": "c. 490 BC, Late Archaic sanctuary as completed",
    },
    "temple": temple,
    "terrain": terrain,
    "features": features,
    "hidden": hidden,
}
out = os.path.join(ROOT, "src/data/sanctuary.json")
with open(out, "w") as fh:
    json.dump(doc, fh, indent=1, ensure_ascii=False)
    fh.write("\n")
print(f"{out}: {len(features)} features, {len(hidden)} hidden, {len(terrain['terraces'])} terraces")
