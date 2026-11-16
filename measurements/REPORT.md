# Scan measurement report (Step 2)

Scan `scan/aigina.ply` (898,477 splats, not committed). Frame `measurements/frame.json`, frameHash `ed0f78a0...`.
Picks were read off the gridded views by the executor, stored in raw coordinates in `picks.json`, and are shown in `picks-overlay.png`. Fit results are in `fit-overlay.png`, and the full tables are in `scan-report.md` / `scan-report.json`.

## Headline

**The scan is non-rigidly distorted, so it cannot give long distances to +-2%.** In plan view the temple comes out as a trapezoid, not a rectangle:

- The north column row runs at 0.45 deg, the south row at 5.74 deg, so opposite rows are **5.3 deg apart**. The east row runs at 93.2 deg and the west row at 87.9 deg, so the ends are 5.3 deg apart too. The stylobate edge lines are not parallel either: N/S 4.3 deg apart, E/W 3.3 deg apart.
- Mean column pitch by side: north 2.48, west 2.61, south 2.38, east 2.38 scan units. The north and west sides agree with the published spacing to within about +-2%, while the south and east sides come out about 7% short.
- The cella walls are not parallel either (south wall about 5.7 deg), and individual column axes scatter by 2.0 deg rms.
- A rigid 6 x 12 grid therefore fits with **grid_rms 0.57 m**, and the corner contraction comes out negative, which is meaningless.

This is reconstruction warp, not archaeology: Furtwaengler gives a rectilinear, level stylobate with no curvature. The evidence is in `fit-overlay.png` (grid nodes against fitted axes) and `views/topdown_slice.png`.

Measurements local to one column (diameters, heights) are much less affected than long distances.

## Measured vs published (compareTo = raw, since the scan counts as metric under the plan rule)

| key | scan (raw) | +- | published | diff | residual (type) | n | decision |
|---|---|---|---|---|---|---|---|
| stylobateWidth | 14.044 | | 13.80 | +1.8% | 0.100 (edge_rms) | 62 bins | scan (within the gates, but see the distortion above) |
| stylobateLength | 28.940 | | 28.80 | +0.5% | 0.051 (edge_rms) | 19 bins | published: L/interaxialFlank ratio +3.9% |
| interaxialFlank | 2.486 | 0.038 | 2.57 | -3.3% | 0.568 (grid_rms) | 27 | published: ratio -3.7%, residual gate |
| interaxialFront | 2.569 | 0.161 | 2.62 | -2.0% | 0.568 (grid_rms) | 27 | published: residual gate |
| cornerContractionFlank | -0.222 | 0.25 | 0.245 | n/a | 0.568 (grid_rms) | 27 | published: unmeasurable (distortion) |
| cornerContractionFront | -0.062 | 0.42 | 0.25 | n/a | 0.568 (grid_rms) | 27 | published: unmeasurable (distortion) |
| lowerDiameter (arrises, 20-flute fit) | 0.919 | 0.014 | 0.99 | -7.2% | 0.026 (flute_fit_rms) | 20 | published: ratio -5.1%, residual gate, 5% gate |
| columnHeight (stylobate to abacus top) | 5.225 | 0.062 | 5.27 | -0.9% | 0.024 (slice_sigma) | 12 | published: H/D ratio +5.4% (driven by the low D) |
| upperDiameter | 0.722 | 0.011 | 0.73 | -1.1% | 0.023 (flute_fit_rms) | 12 | published: Du/D ratio +6.7%, residual gate |

**k = 1.0071, 95% CI 0.9418-1.0562** (bootstrap over columns and edge bins, n = 1000). It is fitted on stylobate L/W and the two interaxials. By the plan rule (|k-1| <= 1% and the CI contains 1) the scan counts as metric and the raw values are compared. The wording is: "the scan's metric scale agrees with published values within the stated CI". **Caveat: the CI is +-5% wide because of the distortion, so this says little.** For the About panel, the safer statement is the k != 1 wording: "the scan verifies proportions; absolute size is anchored to published values."

**Diameter note.** Furtwaengler's 0.99 m does not say whether it is measured at the arrises. The scan value is an arris fit (R_arris of a circular-arc 20-flute profile). Per-column values range from 0.71 to 1.06, with the clean north columns at about 0.92-0.99. Most columns also needed the floor-contamination fallback, described below. So the -7% is not strong evidence against 0.99.

**Downgraded (8 of 9 keys):** stylobateLength, interaxialFlank, interaxialFront, cornerContractionFlank, cornerContractionFront, lowerDiameter, columnHeight, upperDiameter. Each has an unsigned entry in `approved-deviations.json` (approvedBy null). Only stylobateWidth is proposed from the scan, in `dimensions.proposed.json`. Its scan value is 1.8% over published, so the lead may still prefer 13.80 given the distortion.

## Up axis

- The normal-based up (band pole of the vertical-surface great circle, from rot/scale normals) and the mean of 19 fitted column axes are **0.33 deg apart (<= 1 deg)**. The frame is the inverse-variance consensus of the two (`up.py --consensus scan-report.json`, then `save_picks.py --rebind`).
- The RANSAC ground plane is 3.6 deg off, because of the hillside. It is a cross-check only.
- The stylobate base levels still vary by 0.6 m across the temple (1.28-1.88), more distortion evidence.

## Surviving points per column (r < 0.7 m, 0.1-4.0 m above the base)

| label | status | all | op>0.5 | op>0.2 |
|---|---|---|---|---|
| 0,0 | stump | 4774 | 3131 | 4521 |
| 0,1 | stump | 4687 | 3147 | 4440 |
| 0,3 | standing | 15635 | 11286 | 14909 |
| 0,4 | stump | 5456 | 4198 | 5242 |
| 0,5 | stump | 4345 | 3169 | 4150 |
| 0,6 | standing | 10300 | 7265 | 9785 |
| 0,7 | standing | 12374 | 9063 | 11913 |
| 0,8 | standing | 10343 | 7689 | 9968 |
| 0,9 | standing | 16093 | 11752 | 15435 |
| 0,10 | standing | 18201 | 12174 | 17271 |
| 0,11 | standing | 25282 | 16721 | 23986 |
| 1,0 | standing | 21451 | 14500 | 20445 |
| 1,11 | standing | 5950 | 3617 | 5586 |
| 2,0 | standing | 14113 | 9409 | 13405 |
| 2,11 | standing | 2690 | 1642 | 2516 |
| 3,11 | standing | 2073 | 1535 | 1967 |
| 4,11 | standing | 984 | 760 | 956 |
| 5,0 | standing | 15366 | 10914 | 14765 |
| 5,1 | standing | 7036 | 4983 | 6761 |
| 5,2 | standing | 6784 | 4843 | 6534 |
| 5,3 | standing | 5988 | 4218 | 5750 |
| 5,4 | standing | 4761 | 3462 | 4562 |
| 5,5 | stump | 1531 | 1114 | 1460 |
| 5,6 | stump | 887 | 629 | 833 |
| 5,7 | stump | 749 | 544 | 719 |
| 5,8 | standing | 1374 | 988 | 1319 |
| 5,9 | standing | 799 | 590 | 758 |
| 5,11 | standing | 541 | 439 | 524 |

No column lost more than 50% at the 0.5 threshold, so none was refiltered at 0.2. The missing or unresolved positions are (0,2), (3,0), (4,0) (a low block, not a shaft) and (5,10) (a faint arc that fits neither the south pitch nor the west corner). The SW columns (3,11), (4,11), (5,8), (5,9), (5,11) are faint, with fewer than 2.1k splats each.

## Departures from the plan's methods (all covered by the synthetic tests)

1. **Up search.** The axis is the band pole and is scored peak x band. A free mean-shift drifts onto the larger tilted terrace, and a peak + band score rewards horizontal axes. The global histogram and the +-X/Y/Z seeds are as planned.
2. **Base level.** The base is taken at the shaft foot. Columns stand on their own stylobate blocks, and the slabs around them are 0.3-0.4 m lower in the scan.
3. **Lower diameter.** Each slice is fitted as planned, then the flute depth and phase are re-estimated once, shared across slices 0.1-1.5 m. The profile also models the tangential noise blur. Without this, d (and so R_arris) is biased low once the noise approaches the flute width (-1.3% at sigma = 3 cm). When slices at 0.1-0.4 m are floor-contaminated (RMS more than 2x the clean-shaft RMS), the value is a linear D(h) extrapolation to 0.25 m instead, recorded per column as `method`.
4. **Abacus.** The abacus is the lowest square band, not the topmost (the topmost locks onto restored blocks). Partial angular coverage is tolerated, and the top snaps to a visible abacus top surface.
5. **Ratio checks.** Column dimensions are checked against each other (H/D, Du/D), so the grid distortion does not leak into them.

## Synthetic recovery (pytest, `npm run measure:test`)

The synthetic scan has 25 fluted columns, 7 missing, 3 restored architraves, an 8 deg terrace, a random rotation, scale 1.04, 10% outliers and clutter. At sigma = 0.5, 1.5 and 3 cm it recovers:

- up within 0.5 deg (about 0.02 deg), never the terrace;
- k within 0.5%;
- L, W and the interaxials within 0.5%;
- the arris diameter within 1%;
- the abacus height within 1%, with exactly the 3 restored columns flagged.

`test_picks.py` covers the frameHash refusal (exit 2), duplicate, missing and interior labels, and the raw<->frame round trip to 1e-6. `test_merge.py` covers every downgrade path and confirms that approvedBy is never set.
