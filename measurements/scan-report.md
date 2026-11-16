# Scan report

frameHash `ed0f78a01c25d8ea96474d5715388642d8f148e2a7d5d4b6cc92d82c530a3c0c`

k = 1.0071 (95% CI 0.9418..1.0562, n_boot 1000), fitted on stylobateLength, stylobateWidth, interaxialFront, interaxialFlank. Metric: True.

The scan's metric scale agrees with published values within the stated CI.

| key | raw | scaled | compareTo | published | diff % | residual (type) | uncertainty | n | ratio check | decision |
|---|---|---|---|---|---|---|---|---|---|---|
| stylobateWidth | 14.0442 | 14.1437 | raw | 13.8 | +1.77 | 0.0998 (edge_rms) | nan | 62 | +1.3% vs stylobateLength | scan |
| stylobateLength | 28.9395 | 29.1446 | raw | 28.8 | +0.48 | 0.0511 (edge_rms) | nan | 19 | +3.9% vs interaxialFlank | published (ratio check: stylobateLength/interaxialFlank differs from published by +3.9% (> 2%)) |
| interaxialFlank | 2.4859 | 2.5035 | raw | 2.57 | -3.27 | 0.5677 (grid_rms) | 0.0375 | 27 | -3.7% vs stylobateLength | published (ratio check: interaxialFlank/stylobateLength differs from published by -3.7% (> 2%); residual gate: grid_rms 0.5677 >= 1% of value (0.0249)) |
| interaxialFront | 2.5688 | 2.5870 | raw | 2.62 | -1.95 | 0.5677 (grid_rms) | 0.1613 | 27 | +1.4% vs interaxialFlank | published (residual gate: grid_rms 0.5677 >= 1% of value (0.0257)) |
| cornerContractionFlank | -0.2216 | -0.2231 | raw | 0.245 | -190.44 | 0.5677 (grid_rms) | 0.2515 | 27 | -193.5% vs interaxialFlank | published (ratio check: cornerContractionFlank/interaxialFlank differs from published by -193.5% (> 2%); 5% gate: -190.4% from published 0.245) |
| cornerContractionFront | -0.0618 | -0.0623 | raw | 0.25 | -124.74 | 0.5677 (grid_rms) | 0.4158 | 27 | -125.2% vs interaxialFront | published (ratio check: cornerContractionFront/interaxialFront differs from published by -125.2% (> 2%); 5% gate: -124.7% from published 0.25) |
| lowerDiameter | 0.9189 | 0.9254 | raw | 0.99 | -7.18 | 0.0258 (flute_fit_rms) | 0.0137 | 20 | -6.4% vs columnHeight | published (ratio check: lowerDiameter/columnHeight differs from published by -6.4% (> 2%); residual gate: flute_fit_rms 0.0258 >= 1% of value (0.0092); 5% gate: -7.2% from published 0.99) |
| columnHeight | 5.2250 | 5.2620 | raw | 5.27 | -0.85 | 0.0243 (slice_sigma) | 0.0615 | 12 | +6.8% vs lowerDiameter | published (ratio check: columnHeight/lowerDiameter differs from published by +6.8% (> 2%)) |
| upperDiameter | 0.7219 | 0.7270 | raw | 0.73 | -1.11 | 0.0233 (flute_fit_rms) | 0.0113 | 12 | +6.5% vs lowerDiameter | published (ratio check: upperDiameter/lowerDiameter differs from published by +6.5% (> 2%); residual gate: flute_fit_rms 0.0233 >= 1% of value (0.0072)) |

## Up axis

- normal-based up vs column-axis mean: 0.33 deg (<= 1 deg: True); frame up vs consensus 0.05 deg
- column axes: n=19, scatter 2.03 deg, sigma of mean 0.47 deg; stylobate normal vs columns 0.79 deg

## Grid sides

- north(row0): n=11, direction 0.45 deg, straightness rms 0.196, mean pitch 2.482878706072272
- south(row5): n=10, direction 5.74 deg, straightness rms 0.094, mean pitch 2.382020431904726
- east(col0): n=4, direction 93.19 deg, straightness rms 0.040, mean pitch 2.3785014128828488
- west(col11): n=5, direction 87.92 deg, straightness rms 0.026, mean pitch 2.6060391403748033

## Surviving points per column (r < 0.7, 0.1-4.0 above base)

| label | status | all splats | op>0.5 | op>0.2 | refiltered at 0.2 |
|---|---|---|---|---|---|
| 0,0 | stump | 4774 | 3131 | 4521 | False |
| 0,1 | stump | 4687 | 3147 | 4440 | False |
| 0,3 | standing | 15635 | 11286 | 14909 | False |
| 0,4 | stump | 5456 | 4198 | 5242 | False |
| 0,5 | stump | 4345 | 3169 | 4150 | False |
| 0,6 | standing | 10300 | 7265 | 9785 | False |
| 0,7 | standing | 12374 | 9063 | 11913 | False |
| 0,8 | standing | 10343 | 7689 | 9968 | False |
| 0,9 | standing | 16093 | 11752 | 15435 | False |
| 0,10 | standing | 18201 | 12174 | 17271 | False |
| 0,11 | standing | 25282 | 16721 | 23986 | False |
| 1,0 | standing | 21451 | 14500 | 20445 | False |
| 1,11 | standing | 5950 | 3617 | 5586 | False |
| 2,0 | standing | 14113 | 9409 | 13405 | False |
| 2,11 | standing | 2690 | 1642 | 2516 | False |
| 3,11 | standing | 2073 | 1535 | 1967 | False |
| 4,11 | standing | 984 | 760 | 956 | False |
| 5,0 | standing | 15366 | 10914 | 14765 | False |
| 5,1 | standing | 7036 | 4983 | 6761 | False |
| 5,2 | standing | 6784 | 4843 | 6534 | False |
| 5,3 | standing | 5988 | 4218 | 5750 | False |
| 5,4 | standing | 4761 | 3462 | 4562 | False |
| 5,5 | stump | 1531 | 1114 | 1460 | False |
| 5,6 | stump | 887 | 629 | 833 | False |
| 5,7 | stump | 749 | 544 | 719 | False |
| 5,8 | standing | 1374 | 988 | 1319 | False |
| 5,9 | standing | 799 | 590 | 758 | False |
| 5,11 | standing | 541 | 439 | 524 | False |
