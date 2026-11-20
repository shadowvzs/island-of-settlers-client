# Cap recommendations from the benchmark

All numbers are the standalone flag simulation on the developed island fixture, 6 h simulated at
0.1 s steps (216,000 steps), median of 3–4 runs. The current model loads and unloads **one unit at a
time** (0.5 s per unit, with a 0.35 s per-item animation pulse). Times exclude the real game
renderer, pathfinding and door logic; use them to compare the flag model's own work, not as a game
benchmark.

## Candidate combinations

| setup (total / per-ware / cart) | step ms | delivered | produced | services | avg cart load | saturated | empty | delivered per ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 18 / 6 / 8 (baseline) | 888.7 | 3,529 | 2,245 | 20,716 | 8% | 10 | 24 | 3.97 |
| **18 / 6 / 6** | 903.5 | 4,597 | 2,785 | 20,454 | 15% | 12 | 23 | **5.09** |
| 18 / 8 / 6 | 882.3 | 4,094 | 2,526 | 20,575 | 13% | 11 | 22 | 4.64 |
| 8 / 8 / 6 | 872.8 | 4,208 | 2,562 | 20,546 | 13% | 11 | 23 | 4.82 |
| **8 / 3 / 4** | 929.9 | **4,636** | 2,878 | 20,437 | 22% | 12 | 23 | 4.99 |
| 8 / 6 / 6 | 931.6 | 4,122 | 2,550 | 20,569 | 13% | 11 | 20 | 4.42 |

**Reading:** 18/6/6 has the best delivered-per-wall-clock, with a moderate 15% cart load. 8/3/4 has
the highest absolute delivered count and the most visible cart utilization (22%), at a ~3% wall-time
cost. 18/6/8 is fastest in raw wall-clock but carries the least; the cart is overcapacity at an 8%
average load.

The cart-capacity effect is **not monotonic** across all sweeps. That is a property of this demo's
loading policy — it leaves two cart slots free for exports — and of the route/service equilibrium,
not a general rule. Change the loading policy and the optimum can move. Tune cart capacity and
loading policy together, not in isolation.

## 1 Farm vs 5 Farms

The four extra Farms were added at runtime; routes and carriers were rebuilt. Same 6 routes and
6 carriers in every row, so this isolates the effect of a denser production graph.

| farms | cart | step ms | delivered | produced | services | saturated | empty | buildings |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 8 | 847.3 | 3,529 | 2,245 | 20,716 | 10 | 24 | 39 |
| 5 | 8 | 928.0 | 1,995 | 1,348 | 25,297 | 16 | 20 | 43 |
| 1 | 4 | 858.1 | 4,057 | 2,545 | 20,584 | 12 | 21 | 39 |
| 5 | 4 | 951.7 | 1,841 | 1,247 | 25,319 | 15 | 25 | 43 |
| 1 | 2 | 895.8 | 3,991 | 2,473 | 20,590 | 7 | 27 | 39 |
| 5 | 2 | 997.3 | 1,482 | 1,061 | 25,415 | 16 | 26 | 43 |

**Reading:** five farms add production but the fixed six routes/carriers cannot absorb it. Services
rise ~22%, wall time rises 9–11%, and delivered **falls** 43–63% depending on cart size. More flag
capacity alone does not fix this; the route/carrier/flow balance has to scale with the production
graph.

## Practical rule

Size the caps from flow, not from a global constant:

- `perWareCap ≈ production rate × carrier revisit interval × safety`
- `flagTotalCap ≥ sum of per-ware targets + slack`
- `cartCapacity ≈ largest delivery demand between visits`; if average cart load is below ~20%, the
  cart is probably too large; if carts and flags are both full, it is too small.
- `carrierCount/routes ≈ total flow × round-trip time / cartCapacity`

On this island, **18 / 6 / 6** is a reasonable default. Use **8 / 3 / 4** to demonstrate
backpressure, and add routes/carriers only when the building mix becomes denser.
