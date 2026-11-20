# Cap matrix

Measured on the developed island fixture (`continued-0.json`, 39 buildings, 659 road pieces), seed 682615962.
Each run is **6 h simulated** at **0.1s steps** (216,000 steps), median of 3 runs.
Only the named option changes; the rest stay at: routeCount 6, flagTotal 18, per-ware 6, cart 8, carrier speed 5, production 1.5×.
Times are Node wall-clock on the current machine; treat them as relative, not as a game benchmark.

## Baseline

- step time: **895.5 ms** (4.146 µs/step)
- delivered 3529, produced 2245, loaded 3529, services 20716
- saturated 10/38, empty 24/38, cart load 8%

## Flag total capacity

| value | step ms | µs/step | delivered | produced | loaded | services | saturated | empty | cart load | conservation |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|:---:|
| 4 | 839.9 (-6.2%) | 3.888 | 2943 | 1915 | 2943 | 20872 | 16 | 17 | 7% | yes |
| 8 | 890.8 (-0.5%) | 4.124 | 3865 | 2421 | 3865 | 20650 | 11 | 21 | 9% | yes |
| 12 | 891.5 (-0.4%) | 4.127 | 3529 | 2245 | 3529 | 20716 | 10 | 24 | 8% | yes |
| 18 | 895.5 (+0.0%) | 4.146 | 3529 | 2245 | 3529 | 20716 | 10 | 24 | 8% | yes |
| 24 | 877.9 (-2.0%) | 4.064 | 3529 | 2245 | 3529 | 20716 | 10 | 24 | 8% | yes |
| 40 | 882 (-1.5%) | 4.083 | 3529 | 2245 | 3529 | 20716 | 10 | 24 | 8% | yes |

## Per-ware capacity

| value | step ms | µs/step | delivered | produced | loaded | services | saturated | empty | cart load | conservation |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|:---:|
| 1 | 940.7 (+5.0%) | 4.355 | 3964 | 2321 | 3964 | 20589 | 12 | 26 | 9% | yes |
| 2 | 933.6 (+4.3%) | 4.322 | 2856 | 1790 | 2856 | 20898 | 15 | 20 | 7% | yes |
| 3 | 932.6 (+4.1%) | 4.318 | 3496 | 2171 | 3496 | 20730 | 11 | 25 | 8% | yes |
| 4 | 940.9 (+5.1%) | 4.356 | 3799 | 2361 | 3799 | 20653 | 12 | 20 | 9% | yes |
| 6 | 923.6 (+3.1%) | 4.276 | 3529 | 2245 | 3529 | 20716 | 10 | 24 | 8% | yes |
| 8 | 929.1 (+3.8%) | 4.301 | 3832 | 2432 | 3832 | 20656 | 12 | 21 | 9% | yes |
| 12 | 915.1 (+2.2%) | 4.237 | 3992 | 2523 | 3992 | 20611 | 11 | 23 | 10% | yes |

## Cart capacity

| value | step ms | µs/step | delivered | produced | loaded | services | saturated | empty | cart load | conservation |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|:---:|
| 2 | 913.6 (+2.0%) | 4.23 | 3991 | 2473 | 3996 | 20590 | 7 | 27 | 38% | yes |
| 4 | 923.7 (+3.1%) | 4.276 | 4057 | 2545 | 4057 | 20584 | 12 | 21 | 19% | yes |
| 6 | 943.5 (+5.4%) | 4.368 | 4597 | 2785 | 4597 | 20454 | 12 | 23 | 15% | yes |
| 8 | 917.8 (+2.5%) | 4.249 | 3529 | 2245 | 3529 | 20716 | 10 | 24 | 8% | yes |
| 12 | 952.3 (+6.3%) | 4.409 | 4133 | 2525 | 4133 | 20582 | 14 | 18 | 7% | yes |
| 16 | 938.8 (+4.8%) | 4.346 | 3667 | 2349 | 3667 | 20695 | 11 | 19 | 4% | yes |

## Flag total × cart capacity — step ms

| row \ col | 2 | 6 | 8 | 16 |
|---|---:|---:|---:|---:|
| 4 | 902.7 | 915.9 | 920.9 | 908.4 |
| 8 | 906.4 | 928.5 | 929.9 | 938.5 |
| 18 | 904.5 | 920.5 | 922.4 | 935.6 |
| 40 | 908 | 942.1 | 914.6 | 937.9 |

## Flag total × cart capacity — delivered

| row \ col | 2 | 6 | 8 | 16 |
|---|---:|---:|---:|---:|
| 4 | 3904 | 3144 | 2943 | 3485 |
| 8 | 3991 | 4122 | 3865 | 4522 |
| 18 | 3991 | 4597 | 3529 | 3667 |
| 40 | 3991 | 4597 | 3529 | 3667 |

## Per-ware × cart capacity — step ms

| row \ col | 2 | 6 | 8 | 16 |
|---|---:|---:|---:|---:|
| 1 | 924.1 | 933.4 | 924.7 | 962.8 |
| 3 | 914.4 | 939.5 | 941.1 | 934.1 |
| 6 | 900.5 | 933.3 | 927.1 | 929.9 |
| 12 | 896.5 | 929 | 918.1 | 941.2 |

## Per-ware × cart capacity — delivered

| row \ col | 2 | 6 | 8 | 16 |
|---|---:|---:|---:|---:|
| 1 | 3890 | 3275 | 3964 | 3009 |
| 3 | 3991 | 3666 | 3496 | 3814 |
| 6 | 3991 | 4597 | 3529 | 3667 |
| 12 | 3991 | 4931 | 3992 | 5360 |

## Complexity reading

The per-step asymptotic shape does not change with the caps:

- buildings and their production/workers: **O(buildings)** per step;
- carriers: **O(carriers)** per step for movement, plus **O(cartCapacity)** for loading/unloading at a stop and **O(route stops × needs)** when selecting freight at the hub;
- flag operations are Map lookups, effectively **O(1)** per ware per operation; the stock itself has at most `ware types × per-ware cap` entries.

The caps change **constants and event frequency**, not the Big-O. A larger flag buffer reduces backpressure (more production and worker trips), a smaller per-ware cap saturates individual wares sooner, and a larger cart increases the inner load/unload loop and the amount carried per stop. The measured wall-time spread is small compared with the per-step baseline; the workload counters (delivered/produced/loaded/services) explain the direction of the change.
