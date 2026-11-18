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
#   houses front block eave       ~3.9             3.2            -> 3.9
#   houses rear block eave        ~4.9             4.2            -> 4.9
#   pent wing eave (high side)    ~2.6-3.3         2.6 (+0.8)     kept
#   porch piers                   ~0.45 square     0.45           kept
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
    "note": "Ends inside the propylon's west side wall; the north wall stops where the rock reaches terrace height (NE knoll, p. 85). Enclosure parapet (stone socle, mudbrick, tiled coping) after the Ministry board: from outside it hides the krepis.",
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
    "polyline": [[11.41, 41.6], [31.32, 43.25]],
    "thickness": plan(0.65, "m", F["lower_south_wall"]["uncertaintyM"]),
    "height": derived(0, "m", "top flush with the outer terrace; 1.20 m stone fill behind (p. 101)"),
    "top": "level", "phase": NEW, "placement": placement("lower_south_wall", conf="attested"),
    "sourceIds": [FW, WP], "confidence": "attested",
    "note": "About 20 m south of the propylon, about 15 m continuous (p. 101). Side gate (0.95 m) at its east end not modelled.",
}
features["fence-wall"] = {
    "kind": "wall", "name": "Fence wall west of the propylon", "role": "fence",
    "polyline": [[15.07, 23.25], [15.65, 33.31]],
    "thickness": text(0.30, "m", "101"), "height": text(0.7, "m", "101", "slabs about 0.7 m high"),
    "top": "follow", "phase": NEW, "placement": placement("fence_wall", conf="analogy", note="south part dashed (reconstructed) on the plan"),
    "sourceIds": [FW, WP], "confidence": "analogy",
}

# ---- terraces ------------------------------------------------------------------------------------------------
main_poly = [
    [r3(XW), r3(ZN)], pt(wn["centreline"][1]), [29.75, r3(ZN)], [33.3, -18.63], pt(E0),
    pt(SE_CORNER), pt([wse["centreline"][1][0], ZS]), [r3(XW), r3(ZS)],
]
knoll_poly = [pt(wn["centreline"][1]), [29.75, r3(ZN)], [33.3, -18.63], pt(E0), [40.8, -20.5], [34.0, -25.5], [18.0, -24.5]]
plaza_poly = [[15.0, r3(ZS)], pt([wse["centreline"][1][0], ZS]), [36.6, 30.0], [31.3, 43.0], [11.4, 41.6], [11.67, 39.71], [12.85, 36.84], [14.47, 34.65], [15.65, 33.31], [15.07, 23.25]]
se_poly = [pt([wse["centreline"][1][0], ZS]), pt(SE_CORNER), pt(E1), [54.4, 41.5], [55.4, 47.2], [42.9, 47.2], [31.3, 43.0], [36.6, 30.0]]
SUED = {"x0": -5.0, "x1": 20.0, "z0": r3(ZS + 33.0), "w": 6.0}
sued_poly = [[SUED["x0"], SUED["z0"]], [SUED["x1"], SUED["z0"]], [SUED["x1"], SUED["z0"] + SUED["w"]], [SUED["x0"], SUED["z0"] + SUED["w"]]]

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
        "outer-terrace": {"polygon": plaza_poly, "level": conj(r3(S_REL_BASE - 0.9), "m", "plaza before the gate; three steps of about 0.30 m up to the propylon floor at terrace height"),
                          "falloff": {"edgeDrop": conj(2.0, "m", "lower south wall: three courses on rock, 1.20 m fill (p. 101)"), "slope": conj(0.35, "ratio", "rock slope to the south")},
                          "edgeFace": "rock",
                          "note": "Rock 'rises evenly' toward the propylon (p. 100); modelled flat."},
        "se-houses-terrace": {"polygon": se_poly, "level": conj(r3(S_REL_BASE - 1.55), "m", "rock ridge falling SE under the houses (p. 91); one level for the group"),
                              "falloff": {"edgeDrop": conj(2.5, "m", "east wall's outer corner 'schon ganz tief' (p. 91)"), "slope": conj(0.7, "ratio", "steep fall to the east and south-east (p. 98)")},
                              "edgeFace": "rock", "note": "The houses stand on a rock outcrop (Ministry board; rock ridge, p. 91): exposed edges are rock faces."},
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
    "kind": "base", "name": "Tall statue base in front of the altar pavement", "center": [29.0, -5.4], "rotation": 0,
    "length": board(1.2, "m", "base footprint", "conjectural"), "width": board(1.2, "m", "base footprint", "conjectural"),
    "height": board(2.0, "m", "a tall base (legend 6)", "analogy"),
    "figure": {"height": board(1.9, "m", "statue placeholder", "conjectural"), "width": board(0.6, "m", "placeholder", "conjectural"), "depth": board(0.4, "m", "placeholder", "conjectural")},
    "phase": NEW, "placement": placement(None, 3.0, "conjectural", note="Ministry legend 6 'statue base in front of the altar pavement'; position estimated: west of the court, north of the paved way", ref=MIN, verified=False),
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
    "placement": placement("cistern", conf="attested"), "sourceIds": [FW, WP, MIN], "confidence": "attested",
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
    "steps": {"count": conj(3, "count", "a free flight on the outer (south) side; 'third step on a grid wall' (pp. 77-78)"), "rise": conj(0.30, "m", "step rise"), "tread": conj(0.35, "m", "step tread"), "side": "s"},
    "roofOrnament": {"width": board(0.8, "m", "small sculpture on the roof ridge (placeholder block); IMG_8191 about 0.9 m wide", "analogy"), "height": board(1.0, "m", "IMG_8191: about 1.0 m (+/-0.3) above the ridge", "analogy")},
    "baseLevel": r3(S_REL_BASE),
    "phase": NEW, "placement": placement("propylon", conf="attested"), "sourceIds": [FW, WP, MIN], "confidence": "analogy",
    "complex": "south-gate",
    "note": "Matches the Ministry board: the only entrance, two columns between antae on each front, a central door, steps rising from outside (south), a small sculpture on the roof. Floor at terrace height (orthostate cover slabs at terrace level, p. 77). The stair conflict with the plan is resolved by the board (sources.json choices.propylon-stairs-south).",
}

# ---- south-east houses (rooms = holes of the plan's wall network) ---------------------------------------------------
def room(key, fid="se_houses"):
    return obb(geom(fid, key)["points"])


def house(hid, name, key, t, conf="analogy", door_side="w", door_w=None, fid="se_houses", ph=NEW, role="house", note=None, open_n=False, x0=None):
    c, L, W, ang = room(key, fid)
    entry = {
        "kind": "building", "role": role, "name": name, "center": pt(c), "rotation": rot_of(ang),
        "length": plan(L + 2 * t, "m", F[fid]["uncertaintyM"], "room interior plus walls"), "width": plan(W + 2 * t, "m", F[fid]["uncertaintyM"], "room interior plus walls"),
        "wallThickness": conj(t, "m", "within the plan's wall band"), "wallHeight": conj(3.0, "m", "walls above the orthostates not preserved (p. 99)"),
        "doors": [{"wall": door_side, "offset": 0, "width": door_w or conj(1.0, "m", "door width not given"), "height": conj(2.1, "m", "door height")}],
        "roof": {"ridge": "x" if L >= W else "z", "ridgeHeight": conj(1.2, "m", "pitch unknown"), "overhang": conj(0.3, "m", "eaves"), "tiled": True,
                 "confidence": "conjectural", "note": "Many tile fragments found (p. 99); form generic (Abb. 61: 'da alle Einzelheiten fehlen')."},
        "phase": ph, "placement": placement(fid, conf=conf), "sourceIds": [FW, WP], "confidence": "conjectural", "complex": "se-houses",
    }
    if note:
        entry["note"] = note
    return entry


# Rooms II-IV in a row against the east wall, opening west onto a porch (Vorhalle) 4.30 m deep.
rooms = [room(k) for k in ("path27016#4", "path27016#3", "path27016#2")]  # II, III, IV (south to north... along the row)
ang = sum(r[3] for r in rooms) / 3
rot = rot_of(ang)
cmid = rooms[1][0]
loc = [to_local(cmid, rot, r[0]) for r in rooms]
Lr = sum(r[1] for r in rooms) / 3
Wr = sum(r[2] for r in rooms) / 3
t = 0.6
porch = 4.30
zs = [p[1] for p in loc]
z_lo, z_hi = min(zs) - Wr / 2 - t, max(zs) + Wr / 2 + t
x_lo, x_hi = -Lr / 2 - t - porch, Lr / 2 + t
cxl, czl = (x_lo + x_hi) / 2, (z_lo + z_hi) / 2
a = math.radians(rot)
centre = [cmid[0] + math.cos(a) * cxl + math.sin(a) * czl, cmid[1] - math.sin(a) * cxl + math.cos(a) * czl]
shift = lambda p: [r3(p[0] - cxl), r3(p[1] - czl)]  # noqa: E731
west_wall_x = -Lr / 2 - t / 2
order = sorted(range(3), key=lambda i: zs[i])
seps = [(zs[order[i]] + zs[order[i + 1]]) / 2 for i in range(2)]
features["se-rooms-ii-iv"] = {
    "kind": "building", "role": "house", "name": "SE houses: rooms II-IV with the porch (Vorhalle)", "center": pt(centre), "rotation": rot,
    "length": plan(x_hi - x_lo, "m", F["se_houses"]["uncertaintyM"], "rooms plus walls plus the 4.30 m porch (p. 99)"),
    "width": plan(z_hi - z_lo, "m", F["se_houses"]["uncertaintyM"], "three rooms plus walls"),
    "wallThickness": conj(t, "m", "footing courses with orthostates (p. 93)"), "wallHeight": conj(3.2, "m", "not preserved above the orthostates"),
    "doors": [], "openSides": ["w"],
    "crossWalls": [
        {"axis": "z", "offset": r3(west_wall_x - cxl), "from": r3(z_lo + t - czl), "to": r3(z_hi - t - czl), "thickness": conj(t, "m", "room fronts"),
         "doors": [{"offset": r3(zs[i] - czl), "width": text(1.36, "m", "92-100", "door of room II (later narrowed to 1.22 m)") if i == order[0] else conj(1.2, "m", "doors without bolt cuttings"), "height": conj(2.2, "m", "door height")} for i in range(3)]},
        *[{"axis": "x", "offset": r3(sz - czl), "from": r3(west_wall_x + t / 2 - cxl), "to": r3(Lr / 2 - cxl), "thickness": conj(0.75, "m", "plan wall band between rooms"), "doors": []} for sz in seps],
    ],
    "columns": {"shape": "square", "diameter": board(0.45, "m", "stout square piers of the porch as drawn (the text's small octagonal capital, shaft top 0.255 m, p. 99, would be a thin post); size from the drawn figures", "conjectural"),
                "positions": [[r3(x_lo + 0.4 - cxl), r3(z)] for z in [z_lo + t + (k + 0.5) * (z_hi - z_lo - 2 * t) / 4 - czl for k in range(4)]]},
    "architraves": [{"axis": "z", "offset": r3(x_lo + 0.4 - cxl), "from": r3(z_lo + t - czl), "to": r3(z_hi - t - czl), "depth": conj(0.3, "m", "timber beam (p. 99)"), "height": conj(0.3, "m", "timber beam")}],
    "roof": {"ridge": "z", "ridgeHeight": conj(1.5, "m", "pitch unknown"), "overhang": conj(0.35, "m", "eaves"), "tiled": True, "confidence": "conjectural",
             "note": "Tiled (many tile fragments, p. 99); form generic."},
    "phase": NEW, "placement": placement("se_houses", conf="attested", note="rooms II-IV = three equal rooms of the plan's wall network"),
    "sourceIds": [FW, WP], "confidence": "analogy", "complex": "se-houses",
    "note": "Room II early in the new campaign; III and IV about the temple's completion (p. 99).",
}
# Wall thickness 0.27 m per room: never half or all of the plan's 0.5-0.8 m wall bands, so neighbouring rooms'
# walls overlap inside the band without any two faces coinciding.
features["se-room-i7"] = house("se-room-i7", "SE houses: narrow room I 7 along the east wall", "path27016#6", 0.27, door_side="n")
features["se-room-a"] = house("se-room-a", "SE houses: room (I 4/I 5 group)", "path27016#9", 0.27)
features["se-room-b"] = house("se-room-b", "SE houses: room (I 4/I 5 group)", "path27016#11", 0.27)
features["se-forecourt"] = house("se-forecourt", "SE houses: vestibule and forecourt I 2/I 3", "path27016#14", 0.27, ph=BORDER,
                                 note="Entrance vestibule; 'Wächterzimmer' (p. 100). Borderline date.")
# Room I 1 beside the propylon: rear wall = the terrace wall, west wall = the propylon side wall.
i1 = geom("se_houses_bath", "path27016#31")["points"]
ix0, ix1 = min(p[0] for p in i1), max(p[0] for p in i1)
iz1 = max(p[1] for p in i1)
x0, x1, z0, z1 = PX1 - 0.07, ix1 + 0.4, ZS + 0.3, iz1 + 0.4
features["se-room-i1"] = {
    "kind": "building", "role": "ancillary", "name": "Room I 1 beside the propylon", "center": [r3((x0 + x1) / 2), r3((z0 + z1) / 2)], "rotation": 0,
    "length": plan(x1 - x0, "m", F["se_houses_bath"]["uncertaintyM"]), "width": text(r3(z1 - z0), "m", "92", "depth about 2.3 m inside (plus front wall)"),
    "wallThickness": conj(0.4, "m", "'low poor wall' at the front (p. 92)"), "wallHeight": conj(2.4, "m", "low"),
    "doors": [{"wall": "s", "offset": 0, "width": conj(1.3, "m", "opening in the front wall"), "height": conj(2.0, "m", "door height")}],
    "openSides": ["n", "w"],
    "roof": {"ridge": "x", "ridgeHeight": conj(0.9, "m", "lean roof"), "overhang": conj(0.3, "m", "eaves"), "tiled": True, "confidence": "conjectural",
             "note": "Fiechter: perhaps an open pen for animals (p. 92)."},
    "phase": NEW, "placement": placement("se_houses_bath", conf="attested"), "sourceIds": [FW, WP], "confidence": "analogy", "complex": "south-gate",
    "note": "Rear wall is the terrace wall, west wall the propylon's side wall (both shared, so those sides are open here).",
}
features["se-bath"] = house("se-bath", "Small bath (V)", "rect4260#0", 0.27, ph=BORDER, role="bath",
                            note="Inserted later than rooms I-IV, within about three decades (p. 99); basins not modelled. Borderline date.")
features["se-bath"]["complex"] = "south-gate"

# Priests' houses after the Ministry board: built against the outside of the boundary wall on the rock, reached
# only from outside; HIPPED tiled roofs; a taller block behind (rooms against the wall), a lower block in front with
# a columned porch facing the gate side (rooms II-IV, porch open west), and a lower pent-roof wing.
HIP_NOTE = "Hipped tiled roof (Ministry board); pitch conjectural."
for hid in ("se-rooms-ii-iv", "se-room-a", "se-room-b", "se-room-i7"):
    h = features[hid]
    h["roof"]["form"] = "hipped"
    h["roof"]["confidence"] = "analogy"
    h["roof"]["note"] = HIP_NOTE + " Tile fragments found (p. 99)."
    h["sourceIds"] = [FW, WP, MIN]
for hid in ("se-room-a", "se-room-b", "se-room-i7"):
    features[hid]["wallHeight"] = board(4.9, "m", "taller rear block: IMG_8191 eave about 4.9 m (+/-0.8) above the ground, by the drawn figures (1.7 m) beside the porch; about 1 m above the front block's", "analogy")
    features[hid]["name"] = features[hid]["name"].replace("SE houses:", "Priests' houses, taller rear block:")
features["se-rooms-ii-iv"]["name"] = "Priests' houses, lower front block: rooms II-IV with the columned porch (Vorhalle) facing the gate side"
features["se-rooms-ii-iv"]["wallHeight"] = board(3.9, "m", "lower front block with the columned porch: IMG_8191 eave about 3.9 m (+/-0.6) by the drawn figures beside it", "analogy")
features["se-forecourt"]["wallHeight"] = board(2.6, "m", "lower pent-roof wing", "analogy")
features["se-forecourt"]["roof"] = {"form": "pent", "highSide": "n", "ridge": "x", "ridgeHeight": board(0.8, "m", "pent roof rising toward the taller block", "conjectural"),
                                    "overhang": conj(0.3, "m", "eaves"), "tiled": True, "confidence": "analogy", "note": "Pent-roof wing (Ministry board), high side toward the rear block (east)."}
features["se-forecourt"]["name"] = "Priests' houses, pent-roof wing: vestibule and forecourt I 2/I 3"
features["se-forecourt"]["sourceIds"] = [FW, WP, MIN]
features["se-room-i1"]["roof"] = {"form": "pent", "highSide": "n", "ridge": "x", "ridgeHeight": conj(0.6, "m", "lean roof against the terrace wall"), "overhang": conj(0.2, "m", "eaves"),
                                  "tiled": True, "confidence": "conjectural", "note": "Lean roof against the terrace wall; Fiechter: perhaps an open pen for animals (p. 92)."}

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
