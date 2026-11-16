"""Automated fits inside picked regions (plan Step 2.6). Pure numpy/scipy, no I/O.

All functions take points already in the up-aligned frame (z up).
"""
from __future__ import annotations

import numpy as np
from scipy.optimize import least_squares

N_FLUTES = 20


# ------------------------------------------------------------------ geometry helpers


def point_in_polygon(xy, poly):
    """Even-odd rule. xy (N,2), poly (M,2)."""
    x, y = xy[:, 0], xy[:, 1]
    inside = np.zeros(len(xy), bool)
    px, py = poly[:, 0], poly[:, 1]
    j = len(poly) - 1
    for i in range(len(poly)):
        cond = ((py[i] > y) != (py[j] > y)) & (x < (px[j] - px[i]) * (y - py[i]) / (py[j] - py[i] + 1e-300) + px[i])
        inside ^= cond
        j = i
    return inside


def ransac_plane(pts, thresh, iters=400, rng=None, max_tilt_deg=None):
    """RANSAC plane, refined by SVD on inliers. Returns (normal(+z), point, inlier mask)."""
    rng = np.random.default_rng(11) if rng is None else rng
    if len(pts) < 3:
        raise ValueError("ransac_plane: too few points")
    best, best_cnt = None, -1
    cos_tilt = np.cos(np.radians(max_tilt_deg)) if max_tilt_deg else None
    for _ in range(iters):
        p = pts[rng.choice(len(pts), 3, replace=False)]
        n = np.cross(p[1] - p[0], p[2] - p[0])
        L = np.linalg.norm(n)
        if L < 1e-12:
            continue
        n /= L
        if cos_tilt is not None and abs(n[2]) < cos_tilt:
            continue
        cnt = int((np.abs((pts - p[0]) @ n) < thresh).sum())
        if cnt > best_cnt:
            best, best_cnt = (n, p[0]), cnt
    if best is None:
        raise ValueError("ransac_plane: no valid hypothesis")
    n, p0 = best
    for _ in range(3):
        inl = np.abs((pts - p0) @ n) < thresh
        c = pts[inl].mean(axis=0)
        _, _, vt = np.linalg.svd(pts[inl] - c, full_matrices=False)
        n = vt[2] if vt[2][2] >= 0 else -vt[2]
        p0 = c
    inl = np.abs((pts - p0) @ n) < thresh
    return n, p0, inl


def plane_z(n, p0, xy):
    """Height of the plane at xy."""
    return p0[2] - (n[0] * (xy[..., 0] - p0[0]) + n[1] * (xy[..., 1] - p0[1])) / n[2]


def fit_line_2d(pts):
    """Total least squares line. Returns (point, unit direction)."""
    c = pts.mean(axis=0)
    _, _, vt = np.linalg.svd(pts - c, full_matrices=False)
    return c, vt[0]


def kasa_circle(xy):
    """Algebraic circle fit. Returns (cx, cy, r)."""
    x, y = xy[:, 0], xy[:, 1]
    A = np.stack([x, y, np.ones_like(x)], axis=1)
    b = x * x + y * y
    sol, *_ = np.linalg.lstsq(A, b, rcond=None)
    cx, cy = sol[0] / 2, sol[1] / 2
    r = np.sqrt(max(sol[2] + cx * cx + cy * cy, 0.0))
    return cx, cy, r


def robust_circle(xy, iters=3, k=2.5):
    cx, cy, r = kasa_circle(xy)
    for _ in range(iters):
        d = np.hypot(xy[:, 0] - cx, xy[:, 1] - cy) - r
        s = 1.4826 * np.median(np.abs(d)) + 1e-6
        m = np.abs(d) < k * s
        if m.sum() < 10:
            break
        cx, cy, r = kasa_circle(xy[m])
    return cx, cy, r


def fit_line_3d(pts, w=None):
    w = np.ones(len(pts)) if w is None else w
    c = (pts * w[:, None]).sum(axis=0) / w.sum()
    X = (pts - c) * np.sqrt(w)[:, None]
    _, _, vt = np.linalg.svd(X, full_matrices=False)
    d = vt[0]
    if d[2] < 0:
        d = -d
    return c, d


def axis_basis(u, ref=np.array([1.0, 0.0, 0.0])):
    """Orthonormal e1, e2 perpendicular to axis u, e1 closest to ref."""
    e1 = ref - np.dot(ref, u) * u
    e1 /= np.linalg.norm(e1)
    e2 = np.cross(u, e1)
    return e1, e2


# ------------------------------------------------------------------ column axis


def column_points(tree, pts, center_xy, radius):
    idx = tree.query_ball_point(center_xy, radius)
    return np.asarray(idx, dtype=int)


def fit_column_axis(p, seed_xy, z0, z1, step=0.25, radius=0.85, min_pts=40):
    """Circle centres on slices every `step`, then a 3D line fit (two passes).

    p: (N,3) candidate points near the column. Returns dict or None.
    """
    c_xy = np.asarray(seed_xy, float)
    u = np.array([0.0, 0.0, 1.0])
    a0 = np.array([c_xy[0], c_xy[1], z0])
    centres = []
    for _pass in range(2):
        e1, e2 = axis_basis(u)
        rel = p - a0
        h = rel @ u
        lx, ly = rel @ e1, rel @ e2
        rr = np.hypot(lx, ly)
        centres = []
        for zc in np.arange(z0 + 0.15, z1, step):
            hc = zc - z0
            m = (np.abs(h - hc) < step / 2) & (rr < radius)
            if m.sum() < min_pts:
                continue
            cx, cy, r = robust_circle(np.stack([lx[m], ly[m]], 1))
            if not (0.2 < r < 0.75):
                continue
            centres.append(a0 + hc * u + cx * e1 + cy * e2)
        if len(centres) < 2:
            return None
        C = np.array(centres)
        if len(C) >= 4:
            c, d = fit_line_3d(C)
        else:
            c, d = C.mean(axis=0), np.array([0.0, 0.0, 1.0])
        u = d
        # axis point at z0
        t = (z0 - c[2]) / u[2]
        a0 = c + t * u
    C = np.array(centres)
    # residual of slice centres to the axis line
    rel = C - a0
    perp = rel - np.outer(rel @ u, u)
    resid = np.linalg.norm(perp, axis=1)
    n_c = len(C)
    if n_c >= 4:
        # angular uncertainty of the axis from the centre scatter
        span = np.ptp(rel @ u)
        sig = float(np.sqrt(np.mean(resid**2)) / max(span, 1e-6) * np.sqrt(12.0 / n_c))
    else:
        sig = np.inf
    return {"a0": a0, "u": u, "nSlices": n_c, "centreRms": float(np.sqrt(np.mean(resid**2))), "sigmaRad": sig, "span": float(np.ptp(rel @ u))}


def local_coords(p, a0, u, ref=np.array([1.0, 0.0, 0.0])):
    e1, e2 = axis_basis(u, ref)
    rel = p - a0
    return rel @ u, rel @ e1, rel @ e2


# ------------------------------------------------------------------ flute profile


def flute_shape(psi, d, R):
    """Normalised circular-arc flute: 1 at the flute bottom (psi=0), 0 at the arrises (psi=+-pi).

    psi = wrapped 20*(theta - phi). The flute is a circular arc through both arrises
    (chord 2h, h = R sin(pi/20)) with sagitta d.
    """
    h = R * np.sin(np.pi / N_FLUTES)
    d = np.maximum(d, 1e-5)
    rho = (h * h + d * d) / (2 * d)
    x = (psi / np.pi) * h
    return (np.sqrt(np.maximum(rho * rho - x * x, 0.0)) - (rho - d)) / d


def flute_shape_blurred(psi, d, R, sigma_t):
    """Flute shape seen through tangential position noise sigma_t (same units as R).

    Isotropic splat noise moves points along the circumference by ~sigma_t, i.e. by
    N_FLUTES*sigma_t/R in flute phase, which attenuates harmonic k of the profile by
    exp(-k^2 s^2 / 2). Without this the fitted depth (and so R_arris) is biased low once
    the noise approaches the flute width.
    """
    s_ = N_FLUTES * sigma_t / R
    g = np.linspace(-np.pi, np.pi, 256, endpoint=False)
    F = np.fft.rfft(flute_shape(g, d, R))
    k = np.arange(len(F))
    fb = np.fft.irfft(F * np.exp(-0.5 * (k * s_) ** 2), n=len(g))
    return np.interp(wrap(psi), g, fb, period=2 * np.pi)


def wrap(a):
    return (a + np.pi) % (2 * np.pi) - np.pi


def flute_model(theta, R, d, phi):
    psi = wrap(N_FLUTES * (theta - phi))
    return R - d * flute_shape(psi, d, R)


def fft_phase(theta, r, nbins=360):
    """Initial phase from the 20th harmonic of the angularly binned radii."""
    b = ((theta % (2 * np.pi)) / (2 * np.pi) * nbins).astype(int) % nbins
    s = np.bincount(b, weights=r, minlength=nbins)
    c = np.bincount(b, minlength=nbins)
    ok = c > 0
    ang = (np.arange(nbins) + 0.5) / nbins * 2 * np.pi
    rb = np.where(ok, s / np.maximum(c, 1), 0.0)
    rb[ok] -= rb[ok].mean()
    c20 = np.sum(rb[ok] * np.exp(-1j * N_FLUTES * ang[ok]))
    # r ~ -d*a1*cos(20(theta-phi)) => c20 ~ -K e^{-i 20 phi}
    phi = -np.angle(-c20) / N_FLUTES
    return float(phi), float(np.abs(c20) / max(ok.sum(), 1) * 2)


def fit_flute_slice(xy, d0=0.02, f_scale=None, r_range=(0.25, 0.75), centre_tol=0.12):
    """Least-squares 20-flute fit r(theta) = R_arris - d f(20(theta - phi)).

    xy are axis-local (the fitted column axis is the origin). Unknowns cx, cy, R, d, phi.
    Kasa initial centre/R on the shaft annulus (falls back to the axis when the Kasa
    centre is off by > centre_tol, e.g. on a partial arc), FFT initial phase, soft-L1.
    Returns dict with R, sigmaR (Jacobian), d, phi, rms, n, or None.
    """
    r_all = np.hypot(xy[:, 0], xy[:, 1])
    xy = xy[(r_all > r_range[0]) & (r_all < r_range[1])]
    if len(xy) < 30:
        return None
    r_med = float(np.median(np.hypot(xy[:, 0], xy[:, 1])))
    xy = xy[np.abs(np.hypot(xy[:, 0], xy[:, 1]) - r_med) < 0.15]
    if len(xy) < 30:
        return None
    cx, cy, r0 = robust_circle(xy)
    if np.hypot(cx, cy) > centre_tol or not (r_range[0] < r0 < r_range[1]):
        cx, cy, r0 = 0.0, 0.0, r_med
    th = np.arctan2(xy[:, 1] - cy, xy[:, 0] - cx)
    rr = np.hypot(xy[:, 0] - cx, xy[:, 1] - cy)
    keep = np.abs(rr - r0) < max(0.06, 4 * 1.4826 * np.median(np.abs(rr - r0)))
    xy, th, rr = xy[keep], th[keep], rr[keep]
    if len(xy) < 30:
        return None
    phi0, amp = fft_phase(th, rr)
    if f_scale is None:
        # robust-loss scale tied to the slice noise, so soft-L1 stays near least squares for
        # inliers (a too-small scale turns it into L1, which biases R on the skewed flute profile)
        f_scale = max(0.005, 1.4826 * float(np.median(np.abs(rr - np.median(rr)))))
    lb = [cx - centre_tol, cy - centre_tol, r_range[0], 0.0, -np.inf]
    ub = [cx + centre_tol, cy + centre_tol, r_range[1], 0.12 * r0, np.inf]
    best = None
    # Two phase hypotheses guard against a weak harmonic picking the arris instead of the bottom.
    for phi_init in (phi0, phi0 + np.pi / N_FLUTES):
        x0 = np.clip(np.array([cx, cy, r0 + d0 * 0.6, d0, phi_init]), np.array(lb) + 1e-9, np.array(ub) - 1e-9)

        def res(x):
            t = np.arctan2(xy[:, 1] - x[1], xy[:, 0] - x[0])
            r = np.hypot(xy[:, 0] - x[0], xy[:, 1] - x[1])
            return r - flute_model(t, x[2], x[3], x[4])

        sol = least_squares(res, x0, bounds=(lb, ub), loss="soft_l1", f_scale=f_scale)
        if best is None or sol.cost < best.cost:
            best = sol
    sol = best
    r = sol.fun
    n, p = len(r), 5
    rms = float(np.sqrt(np.mean(r**2)))
    J = sol.jac
    s2 = np.sum(r**2) / max(n - p, 1)
    cov = np.linalg.pinv(J.T @ J) * s2
    sigR = float(np.sqrt(max(cov[2, 2], 0.0)))
    # angular coverage (fraction of 10-degree sectors with points)
    cov_frac = float(len(np.unique((np.degrees(np.arctan2(xy[:, 1] - sol.x[1], xy[:, 0] - sol.x[0])) // 10).astype(int))) / 36.0)
    return {"cx": float(sol.x[0]), "cy": float(sol.x[1]), "R": float(sol.x[2]), "sigmaR": sigR, "d": float(sol.x[3]), "phi": float(sol.x[4] % (2 * np.pi / N_FLUTES)), "rms": rms, "n": int(n), "angularCoverage": cov_frac}


def _slice_points(h, lx, ly, lv, thick):
    m = (np.abs(h - lv) < thick / 2) & (np.hypot(lx, ly) < 0.8)
    return np.stack([lx[m], ly[m]], 1)


def shared_flute(slices, sigma_t=0.0):
    """Shared flute depth d and phase phi over many slices (flutes are vertical).

    slices: list of (xy, cx, cy) with the centre from the per-slice fit. For each phase on
    a 0.2 deg grid, r = R_s - d f(psi) is linear in (R_s..., d); the phase with the
    smallest trimmed SSE wins. Returns (d, phi) or None.
    """
    th, rr, idx = [], [], []
    for i, (xy, cx, cy) in enumerate(slices):
        th.append(np.arctan2(xy[:, 1] - cy, xy[:, 0] - cx))
        rr.append(np.hypot(xy[:, 0] - cx, xy[:, 1] - cy))
        idx.append(np.full(len(xy), i))
    th, rr, idx = np.concatenate(th), np.concatenate(rr), np.concatenate(idx)
    if len(rr) < 200:
        return None
    ns = len(slices)
    Rm = np.median(rr)
    best = None
    period = 2 * np.pi / N_FLUTES
    for phi in np.arange(0, period, period / 90):
        psi = wrap(N_FLUTES * (th - phi))
        f = flute_shape_blurred(psi, 0.02, Rm, sigma_t) if sigma_t > 0 else flute_shape(psi, 0.02, Rm)
        A = np.zeros((len(rr), ns + 1))
        A[np.arange(len(rr)), idx] = 1.0
        A[:, ns] = -f
        keep = np.ones(len(rr), bool)
        for _ in range(2):
            coef, *_ = np.linalg.lstsq(A[keep], rr[keep], rcond=None)
            res = rr - A @ coef
            sd = 1.4826 * np.median(np.abs(res[keep])) + 1e-4
            keep = np.abs(res) < 3 * sd
        sse = float(np.sum(res[keep] ** 2) / keep.sum())
        if best is None or sse < best[0]:
            best = (sse, max(float(coef[ns]), 0.0), float(phi))
    return best[1], best[2]


def fit_fixed_flute(xy, cx, cy, R, d, phi, f_scale, sigma_t=0.0):
    def res(x):
        t = np.arctan2(xy[:, 1] - x[1], xy[:, 0] - x[0])
        r = np.hypot(xy[:, 0] - x[0], xy[:, 1] - x[1])
        if sigma_t > 0:
            return r - (x[2] - d * flute_shape_blurred(N_FLUTES * (t - phi), d, x[2], sigma_t))
        return r - flute_model(t, x[2], d, phi)

    sol = least_squares(res, [cx, cy, R], bounds=([cx - 0.1, cy - 0.1, 0.05], [cx + 0.1, cy + 0.1, 2.0]), loss="soft_l1", f_scale=f_scale)
    r = sol.fun
    cov = np.linalg.pinv(sol.jac.T @ sol.jac) * (np.sum(r**2) / max(len(r) - 3, 1))
    return float(sol.x[0]), float(sol.x[1]), float(sol.x[2]), float(np.sqrt(max(cov[2, 2], 0))), float(np.sqrt(np.mean(r**2)))


def diameter_from_slices(h, lx, ly, levels, thick=0.05, min_pts=30, pool_levels=None):
    """Least-squares 20-flute fit on slices centred at `levels` (heights along the axis).

    Every slice is first fitted on its own (plan model, all five unknowns). When
    pool_levels is given, the flute depth d and phase phi are then re-estimated once from
    all pooled slices (shared, since flutes are vertical) and each target slice is refitted
    for cx, cy, R_arris with d, phi fixed. Pooling keeps d identifiable when the noise is as
    large as the flute depth; otherwise R_arris collapses toward the mean radius.
    """
    out = []
    for lv in levels:
        xy = _slice_points(h, lx, ly, lv, thick)
        if len(xy) < min_pts:
            continue
        f = fit_flute_slice(xy)
        if f is None:
            continue
        f["level"] = float(lv)
        f["_xy"] = xy
        out.append(f)
    if not out:
        return None
    if pool_levels is not None:
        pool = []
        for lv in pool_levels:
            xy = _slice_points(h, lx, ly, lv, thick)
            if len(xy) < min_pts:
                continue
            f = fit_flute_slice(xy)
            if f is None:
                continue
            rr = np.hypot(xy[:, 0] - f["cx"], xy[:, 1] - f["cy"])
            keep = np.abs(rr - np.median(rr)) < max(0.06, 4 * f["rms"])
            pool.append((xy[keep], f["cx"], f["cy"]))
        # tangential noise estimate: median per-slice radial residual RMS
        sig_t = float(np.median([o["rms"] for o in out]))
        sh = shared_flute(pool, sig_t) if len(pool) >= 3 else None
        if sh is not None:
            d, phi = sh
            for o in out:
                xy = o["_xy"]
                rr = np.hypot(xy[:, 0] - o["cx"], xy[:, 1] - o["cy"])
                xy = xy[np.abs(rr - np.median(rr)) < max(0.06, 4 * o["rms"])]
                cx, cy, R, sR, rms = fit_fixed_flute(xy, o["cx"], o["cy"], o["R"], d, phi, max(0.005, o["rms"]), sig_t)
                o.update({"cx": cx, "cy": cy, "R": R, "sigmaR": sR, "rms": rms, "d": d, "phi": phi, "sharedFlute": True, "nPooled": len(pool), "sigmaTangential": sig_t})
    for o in out:
        o.pop("_xy", None)
    return summarise_slices(out)


def summarise_slices(out):
    Rs = np.array([o["R"] for o in out])
    sj = np.array([o["sigmaR"] for o in out])
    Rmed = float(np.median(Rs))
    spread = float(np.std(Rs, ddof=1)) if len(Rs) > 1 else 0.0
    sig = float(np.sqrt(np.nanmedian(sj) ** 2 + spread**2))
    return {"D": 2 * Rmed, "sigmaD": 2 * sig, "slices": out, "rms": float(np.sqrt(np.mean([o["rms"] ** 2 for o in out]))), "nSlices": len(out)}


def lower_diameter(h, lx, ly, levels, ref_band=(0.5, 1.5), rms_factor=2.0, eval_at=0.25):
    """Plan method (flute fit on slices 0.1-0.4 above the stylobate), with a guard for
    floor contamination: a slice is rejected when its RMS exceeds rms_factor x the median
    RMS of clean shaft slices in ref_band or R sits on a bound. With >= 3 clean slices the
    plan value is used; otherwise D(h) is fitted linearly over the clean slices up to
    ref_band[1] and evaluated at eval_at ("extrapolated")."""
    ref = diameter_from_slices(h, lx, ly, np.round(np.arange(ref_band[0], ref_band[1] + 1e-9, 0.1), 3))
    ref_rms = float(np.median([s["rms"] for s in ref["slices"]])) if ref else None
    pool = np.round(np.arange(0.1, ref_band[1] + 1e-9, 0.05), 3)
    plan = diameter_from_slices(h, lx, ly, levels, pool_levels=pool)

    def clean(sl):
        ok = 0.26 < sl["R"] < 0.74
        if ref_rms is not None:
            ok &= sl["rms"] <= rms_factor * ref_rms
        return ok

    if plan:
        good = [s_ for s_ in plan["slices"] if clean(s_)]
        rejected = [s_["level"] for s_ in plan["slices"] if not clean(s_)]
        if len(good) >= 3:
            res = summarise_slices(good)
            res.update({"method": "slices", "rejectedLevels": rejected})
            return res
    if not ref:
        return None
    sl = [s_ for s_ in ((plan["slices"] if plan else []) + ref["slices"]) if clean(s_)]
    if len(sl) < 4:
        return None
    L = np.array([s_["level"] for s_ in sl])
    R = np.array([s_["R"] for s_ in sl])
    A = np.stack([np.ones_like(L), L], 1)
    keep = np.ones(len(L), bool)
    for _ in range(2):
        coef, *_ = np.linalg.lstsq(A[keep], R[keep], rcond=None)
        r = R - A @ coef
        s_ = 1.4826 * np.median(np.abs(r[keep])) + 1e-4
        keep = np.abs(r) < 3 * s_
    coef, *_ = np.linalg.lstsq(A[keep], R[keep], rcond=None)
    r = R[keep] - A[keep] @ coef
    cov = np.linalg.pinv(A[keep].T @ A[keep]) * (np.sum(r**2) / max(keep.sum() - 2, 1))
    x = np.array([1.0, eval_at])
    sigR = float(np.sqrt(max(x @ cov @ x, 0.0)))
    used = [s_ for s_, k in zip(sl, keep) if k]
    return {"D": float(2 * (coef[0] + coef[1] * eval_at)), "sigmaD": 2 * sigR, "slices": used, "rms": float(np.sqrt(np.mean([o["rms"] ** 2 for o in used]))), "nSlices": len(used), "method": f"extrapolated to {eval_at} m from a linear D(h) fit", "taperPerUnit": float(2 * coef[1])}


# ------------------------------------------------------------------ abacus / height


def squareness_profile(h, lx, ly, z_lo, z_hi, step, rmax=1.0, min_pts=25):
    """Per slice: envelope radius on faces vs diagonals (4-fold symmetry).

    lx/ly must be in a basis aligned with the abacus faces.
    Returns arrays (centres, S, faceR, faceCV, counts).
    """
    th = np.arctan2(ly, lx)
    rr = np.hypot(lx, ly)
    cs, S, FR, CV, N = [], [], [], [], []
    for zc in np.arange(z_lo, z_hi, step):
        m = (np.abs(h - zc) < step / 2) & (rr < rmax)
        N.append(int(m.sum()))
        cs.append(zc)
        if m.sum() < min_pts:
            S.append(np.nan)
            FR.append(np.nan)
            CV.append(np.nan)
            continue
        t, r = th[m], rr[m]
        faces, diags = [], []
        for k in range(4):
            a_f = k * np.pi / 2
            a_d = a_f + np.pi / 4
            mf = np.abs(wrap(t - a_f)) < np.radians(12)
            md = np.abs(wrap(t - a_d)) < np.radians(12)
            faces.append(np.percentile(r[mf], 95) if mf.sum() >= 3 else np.nan)
            diags.append(np.percentile(r[md], 95) if md.sum() >= 3 else np.nan)
        faces, diags = np.array(faces), np.array(diags)
        # Splat scans often cover only part of the circumference: use the visible
        # sectors, but require at least two faces and two diagonals.
        if np.isfinite(faces).sum() < 2 or np.isfinite(diags).sum() < 2:
            S.append(np.nan)
            FR.append(np.nan)
            CV.append(np.nan)
            continue
        fr = np.nanmean(faces)
        S.append(float(np.nanmean(diags) / fr))
        FR.append(float(fr))
        CV.append(float(np.nanstd(faces) / fr))
    return np.array(cs), np.array(S), np.array(FR), np.array(CV), np.array(N)


def abacus_top(h, lx, ly, z_lo, z_hi, step, s_thresh, cv_max=0.25, min_band=2, min_face=0.45, max_gap=1):
    """Top of the abacus: the LOWEST band of slices with a square (4-fold) signature.

    Below the abacus the shaft and echinus are round, so the first square band going up
    is the abacus. (Searching from the top instead can lock onto a restored architrave or
    entablature block.) Gaps of up to max_gap non-square slices inside the band are
    bridged, because splat scans often leave slices with too few visible sectors.
    """
    cs, S, FR, CV, N = squareness_profile(h, lx, ly, z_lo, z_hi, step)
    sq = (S > s_thresh) & (CV < cv_max) & (FR > min_face)
    sq = np.nan_to_num(sq, nan=False).astype(bool)
    i = 0
    while i < len(sq):
        if not sq[i]:
            i += 1
            continue
        j, last, gap = i, i, 0
        while j + 1 < len(sq):
            if sq[j + 1]:
                last, gap = j + 1, 0
            else:
                gap += 1
                if gap > max_gap:
                    break
            j += 1
        if int(sq[i:last + 1].sum()) >= min_band:
            top = cs[last] + step / 2
            band = (cs[i] - step / 2, top)
            return {"top": float(top), "band": [float(band[0]), float(band[1])], "faceR": float(np.nanmedian(FR[i:last + 1][sq[i:last + 1]]))}
        i = last + 1
    return None


def column_height(h, lx, ly, nz=None, z_hi=8.5, steps=(0.05, 0.025), thresholds=(1.12, 1.2)):
    """Abacus-top height and slice_sigma over slice steps x thresholds.

    Points above the abacus top (within the shaft footprint) are flagged as restored
    architrave/entablature and excluded.
    """
    ests = []
    faces = []
    sheet_used = 0
    for st in steps:
        for th in thresholds:
            a = abacus_top(h, lx, ly, 2.5, z_hi, st, th)
            if a is None:
                continue
            top = a["top"]
            if nz is not None:
                # A visible abacus top surface (horizontal splats inside the footprint)
                # also fills the slices just above it with a square signature; snap to it.
                inside = np.maximum(np.abs(lx), np.abs(ly)) < 0.9 * a["faceR"]
                horiz = np.abs(nz) > np.cos(np.radians(15))
                win = 0.12
                for _ in range(2):
                    sh = inside & horiz & (np.abs(h - top) < win)
                    if sh.sum() < 30:
                        break
                    top = float(np.median(h[sh]))
                    win = 0.05
                else:
                    sheet_used += 1
            ests.append(top)
            faces.append(a["faceR"])
    if not ests:
        return None
    ests = np.array(ests)
    H = float(np.median(ests))
    sig = float(np.std(ests, ddof=1)) if len(ests) > 1 else float(steps[0])
    above = (h > H + 0.05) & (np.hypot(lx, ly) < 0.7)
    n_above = int(above.sum())
    n_cap = int(((h > H - 0.3) & (h <= H)).sum())
    restored = n_above > max(50, 0.3 * n_cap)
    return {"H": H, "sigma": max(sig, 0.5 * min(steps)), "estimates": ests.tolist(), "abacusHalfWidth": float(np.median(faces)), "pointsAbove": n_above, "restoredAbove": bool(restored), "topSurfaceSnaps": sheet_used}


# ------------------------------------------------------------------ stylobate edge


def edge_line(pts_xy, edge_picks_xy, centroid_xy, band=1.0, bin_size=0.5, pct=99.0):
    """Outer boundary per 0.5 m bin (99th pct along the outward normal), then a line fit."""
    c0, d = fit_line_2d(edge_picks_xy)
    nrm = np.array([-d[1], d[0]])
    if np.dot(centroid_xy - c0, nrm) > 0:
        nrm = -nrm  # outward
    rel = pts_xy - c0
    s = rel @ d
    o = rel @ nrm
    s_picks = (edge_picks_xy - c0) @ d
    lo, hi = s_picks.min() - 1.0, s_picks.max() + 1.0
    m = (np.abs(o) < band) & (s > lo) & (s < hi)
    s, o = s[m], o[m]
    bins = np.floor((s - lo) / bin_size).astype(int)
    bpts = []
    for b in np.unique(bins):
        mb = bins == b
        if mb.sum() < 8:
            continue
        bpts.append([lo + (b + 0.5) * bin_size, np.percentile(o[mb], pct)])
    if len(bpts) < 3:
        return None
    B = np.array(bpts)
    # robust line o = a + b s with one sigma-clip pass
    keep = np.ones(len(B), bool)
    for _ in range(2):
        A = np.stack([np.ones(keep.sum()), B[keep, 0]], 1)
        coef, *_ = np.linalg.lstsq(A, B[keep, 1], rcond=None)
        r = B[:, 1] - (coef[0] + coef[1] * B[:, 0])
        s_ = 1.4826 * np.median(np.abs(r[keep])) + 1e-4
        keep = np.abs(r) < 3 * s_
        if keep.sum() < 3:
            keep = np.ones(len(B), bool)
            break
    A = np.stack([np.ones(keep.sum()), B[keep, 0]], 1)
    coef, *_ = np.linalg.lstsq(A, B[keep, 1], rcond=None)
    r = B[keep, 1] - (coef[0] + coef[1] * B[keep, 0])
    # back to frame xy: point and direction of the fitted line
    p_line = c0 + coef[0] * nrm
    dir_line = d + coef[1] * nrm
    dir_line /= np.linalg.norm(dir_line)
    bxy = c0 + np.outer(B[keep, 0], d) + np.outer(B[keep, 1], nrm)
    return {"point": p_line, "dir": dir_line, "outward": nrm, "edgeRms": float(np.sqrt(np.mean(r**2))), "nBins": int(keep.sum()), "boundaryXY": bxy, "sRange": [float(B[keep, 0].min()), float(B[keep, 0].max())]}


def line_distance(e1, e2):
    """Mean distance between two (nearly parallel) edge lines, evaluated at each
    one's boundary-point midpoint against the other. Also returns their angle."""

    def dist(pt, ln):
        n = np.array([-ln["dir"][1], ln["dir"][0]])
        return abs(np.dot(pt - ln["point"], n))

    m1 = e1["boundaryXY"].mean(axis=0)
    m2 = e2["boundaryXY"].mean(axis=0)
    dd = 0.5 * (dist(m1, e2) + dist(m2, e1))
    ang = float(np.degrees(np.arccos(min(1.0, abs(np.dot(e1["dir"], e2["dir"]))))))
    return float(dd), ang


# ------------------------------------------------------------------ grid


def grid_nodes(params, labels, n_rows=6, n_cols=12):
    """params = [ox, oy, theta, aFlank, cFlank, aFront, cFront].

    Along the flank (col): s(0)=0, s(1)=aFlank-cFlank, ..., s(11)=2(aFlank-cFlank)+9 aFlank.
    Across the front (row): same with aFront/cFront.
    """
    ox, oy, th, af, cf, aw, cw = params
    labels = np.asarray(labels)
    r, c = labels[:, 0].astype(float), labels[:, 1].astype(float)

    def pos(i, n, a, cc):
        corner = a - cc
        inner = np.clip(i - 1, 0, n - 3)
        return np.where(i <= 0, 0.0, corner + inner * a + np.where(i >= n - 1, corner, 0.0))

    s = pos(c, n_cols, af, cf)
    t = pos(r, n_rows, aw, cw)
    ct, st = np.cos(th), np.sin(th)
    x = ox + s * ct - t * st
    y = oy + s * st + t * ct
    return np.stack([x, y], 1)


def fit_grid(centres_xy, labels, init):
    centres_xy = np.asarray(centres_xy, float)

    def res(p):
        return (grid_nodes(p, labels) - centres_xy).ravel()

    sol = least_squares(res, np.asarray(init, float), loss="linear")
    r = sol.fun.reshape(-1, 2)
    per = np.linalg.norm(r, axis=1)
    J = sol.jac
    dof = max(len(sol.fun) - len(init), 1)
    s2 = np.sum(sol.fun**2) / dof
    cov = np.linalg.pinv(J.T @ J) * s2
    return {"params": sol.x, "rms": float(np.sqrt(np.mean(per**2))), "perColumn": per, "sigma": np.sqrt(np.clip(np.diag(cov), 0, None))}
