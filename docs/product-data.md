# Product data and what “fits” means

The catalog contains **all 25 standard European K 470 Universal Box sizes**, from **13 L to 829 L**. Six of those models reproduce the reference image; the other 19 are available for building different arrangements. The image supplies capacities and an arrangement, rather than readable product numbers; model identification follows the manufacturer's catalog. Data was checked against official ZARGES pages on **12 October 2026**. All dimensions below are **length × width × height in millimetres**. Weights refer to empty cases; capacities are the manufacturer's nominal litre values.

“Full catalog” here means the 25 standard sizes listed in the [official European K 470 Universal Box range](https://www.zarges.com/en/products/k-470-universal-box/k-470-universal-box-40568). It does not include other product families, K 470 Plus, separate IP65/IP67 variants, accessories, custom dimensions, or additional US-specific variants. Those require their own verified product records and measurement conventions. Product availability and regional ordering are not implied by inclusion in the planner.

## Catalog

The first six rows are the reference models. Their order and the eight-case starter plan are preserved; `reference: true` identifies them in [`src/catalog.js`](../src/catalog.js). The remaining entries have `reference: false`. Only the two 60 L models share a capacity, so the longer 40847 is explicitly labelled **60 L long**.

| Model | Capacity | Maximum outside dimensions | Inside dimensions | Empty weight |
| --- | ---: | --- | --- | ---: |
| [40810](https://www.zarges.com/en/products/k-470-universal-box/k-470-universal-box-40810) | 29 L | 600 × 400 × 180 | 550 × 350 × 150 | 4.2 kg |
| [40568](https://www.zarges.com/en/products/k-470-universal-box/k-470-universal-box-40568) | 42 L | 600 × 400 × 250 | 550 × 350 × 220 | 4.8 kg |
| [40678](https://www.zarges.com/en/products/k-470-universal-box/k-470-universal-box-40678) | 60 L | 600 × 400 × 340 | 550 × 350 × 310 | 5.0 kg |
| [40564](https://www.zarges.com/en/products/k-470-universal-box/k-470-universal-box-40564) | 73 L | 600 × 400 × 410 | 550 × 350 × 380 | 5.3 kg |
| [40847](https://www.zarges.com/en/products/k-470-universal-box/k-470-universal-box-40847) | 60 L, long | 1200 × 400 × 180 | 1150 × 350 × 150 | 7.5 kg |
| [40565](https://www.zarges.com/en/products/k-470-universal-box/k-470-universal-box-40565) | 157 L | 800 × 600 × 410 | 750 × 550 × 380 | 10.0 kg |
| [40835](https://www.zarges.com/en/products/k-470-universal-box/k-470-universal-box-40835) | 13 L | 400 × 300 × 180 | 350 × 250 × 150 | 2.6 kg |
| [40677](https://www.zarges.com/en/products/k-470-universal-box/k-470-universal-box-40677) | 27 L | 400 × 300 × 340 | 350 × 250 × 310 | 3.1 kg |
| [40849](https://www.zarges.com/en/products/k-470-universal-box/k-470-universal-box-40849) | 66 L | 600 × 600 × 250 | 550 × 550 × 220 | 5.6 kg |
| [40859](https://www.zarges.com/en/products/k-470-universal-box/k-470-universal-box-40859) | 115 L | 600 × 600 × 410 | 550 × 550 × 380 | 6.6 kg |
| [40836](https://www.zarges.com/en/products/k-470-universal-box/k-470-universal-box-40836) | 175 L | 600 × 600 × 610 | 550 × 550 × 580 | 7.8 kg |
| [40837](https://www.zarges.com/en/products/k-470-universal-box/k-470-universal-box-40837) | 116 L | 650 × 480 × 480 | 600 × 430 × 450 | 6.5 kg |
| [40839](https://www.zarges.com/en/products/k-470-universal-box/k-470-universal-box-40839) | 148 L | 650 × 610 × 470 | 600 × 560 × 440 | 7.4 kg |
| [40841](https://www.zarges.com/en/products/k-470-universal-box/k-470-universal-box-40841) | 121 L | 740 × 510 × 410 | 690 × 460 × 380 | 6.9 kg |
| [40842](https://www.zarges.com/en/products/k-470-universal-box/k-470-universal-box-40842) | 150 L | 740 × 690 × 370 | 690 × 640 × 340 | 8.0 kg |
| [40843](https://www.zarges.com/en/products/k-470-universal-box/k-470-universal-box-40843) | 190 L | 740 × 690 × 460 | 690 × 640 × 430 | 8.6 kg |
| [40566](https://www.zarges.com/en/products/k-470-universal-box/k-470-universal-box-40566) | 239 L | 800 × 600 × 610 | 750 × 550 × 580 | 12.0 kg |
| [40844](https://www.zarges.com/en/products/k-470-universal-box/k-470-universal-box-40844) | 195 L | 830 × 530 × 550 | 780 × 480 × 520 | 11.1 kg |
| [40845](https://www.zarges.com/en/products/k-470-universal-box/k-470-universal-box-40845) | 173 L | 950 × 530 × 430 | 900 × 480 × 400 | 11.0 kg |
| [40846](https://www.zarges.com/en/products/k-470-universal-box/k-470-universal-box-40846) | 259 L | 950 × 690 × 480 | 900 × 640 × 450 | 13.4 kg |
| [40567](https://www.zarges.com/en/products/k-470-universal-box/k-470-universal-box-40567) | 162 L | 1000 × 500 × 410 | 950 × 450 × 380 | 10.9 kg |
| [40580](https://www.zarges.com/en/products/k-470-universal-box/k-470-universal-box-40580) | 414 L | 1200 × 800 × 510 | 1150 × 750 × 480 | 20.0 kg |
| [40848](https://www.zarges.com/en/products/k-470-universal-box/k-470-universal-box-40848) | 119 L | 1400 × 450 × 250 | 1350 × 400 × 220 | 9.5 kg |
| [40875](https://www.zarges.com/en/products/k-470-universal-box/k-470-universal-box-40875) | 396 L | 1600 × 600 × 495 | 1550 × 550 × 465 | 23.5 kg |
| [40876](https://www.zarges.com/en/products/k-470-universal-box/k-470-universal-box-40876) | 829 L | 1700 × 800 × 700 | 1650 × 750 × 670 | 30.0 kg |

The [official 40678 product page](https://www.zarges.com/en/products/k-470-universal-box/k-470-universal-box-40678) includes a variants table confirming the four 600 × 400 mm reference models. The [40677 page](https://www.zarges.com/en/products/k-470-universal-box/k-470-universal-box-40677) confirms the 13 L and 27 L dimensions and weights. The [40839 variants table](https://www.zarges.com/en/products/k-470-universal-box/k-470-universal-box-40839) supplies the square and intermediate cases, while the [40848 page and variants table](https://www.zarges.com/en/products/k-470-universal-box/k-470-universal-box-40848) confirms the larger and long cases. All 25 entries have published inside dimensions, maximum outside dimensions, capacity, and empty weight; none of those fields are estimated or missing.

The [UK K 470 range table](https://www.zarges.com/uk/products/k-470-universal-container) and [German K 470 range table](https://www.zarges.com/de/produkte/k-470-universalkiste) provide regional cross-checks of the same standard records. Links sometimes redirect according to locale; equivalent regional K 470 pages also expose the variants table. Research used the indexed official page content when direct page retrieval entered a locale redirect loop.

Catalog data lives in [`src/catalog.js`](../src/catalog.js). No live scraping, product photography, checkout, prices, or availability feed is required to run the planner.

## Why the two reference stacks line up

These are calculations using the published maximum envelopes, rather than measured stacking interfaces.

**Stack 1:** two 73 L cases sit side by side, giving a combined 1200 × 400 mm footprint at a common height of 410 mm. The 60 L long case has the same 1200 × 400 mm envelope and spans both cases. Adding its 180 mm height gives a conservative nominal stack height of **590 mm**, **206 L** of capacity, and **18.1 kg** empty weight.

**Stack 2:** the 157 L base occupies 800 × 600 mm. Rotate both middle cases by 90° so each occupies 400 × 600 mm: the 73 L and standard 60 L fit side by side. Above the 73 L case, the 29 L case completes a 410 + 180 = 590 mm column. Above the 60 L case, the 42 L case completes a 340 + 250 = 590 mm column. Both columns therefore finish at **1000 mm** including the 410 mm base. This stack provides **361 L** and weighs **29.3 kg** empty.

The complete reference plan contains **8 cases**, **567 L**, and **47.4 kg** empty weight:

| Model | Quantity |
| --- | ---: |
| 40810 / 29 L | 1 |
| 40568 / 42 L | 1 |
| 40678 / 60 L | 1 |
| 40564 / 73 L | 3 |
| 40847 / 60 L long | 1 |
| 40565 / 157 L | 1 |

## Geometric support and mechanical stacking are different

ZARGES describes cast aluminium stacking corners across the K 470 range. Its [US 40810 product page](https://zargesusa.com/products/k470-40810) explicitly groups 40810, 40568, 40678, and 40564 as sharing a footprint and stacking together. That supports the same-footprint pairs used at the top of Stack 2.

We did **not** find an official statement confirming corner engagement for either the long 40847 bridging two 40564 cases or the two rotated smaller cases on a 40565. These combinations have matching maximum rectangular envelopes, which is sufficient to visualize and plan their footprint. It is insufficient to claim a mechanical lock, a tested load path, or a transport rating. The app treats these mixed combinations as geometric fits requiring confirmation.

The geometry model treats each closed case as an axis-aligned rectangular envelope. It can detect overlap, overhang, and insufficient same-height support. It does not model the exact lid, feet, corner casting profiles, seams, handle movement, or load-bearing contact points. Touching envelopes and full rectangular support are planning results, not physical test results.

Stack heights add the published maximum case heights. Actual engaged corners may reduce the total height; the app does not subtract an unverified engagement depth. Cargo weight, centre of gravity, acceleration, restraint, floor strength, lids bending across a seam, and allowable stack loads are outside the model. The manufacturer's dangerous-goods gross-weight figure is **not** a stacking load and is deliberately not used as one.

Before buying specifically for a mixed stack, ask ZARGES to confirm the model numbers, orientation, corner engagement, loaded application, and actual assembled dimensions. This is the outstanding product question the prototype makes easier to communicate.

## Why US retail dimensions are not mixed into this catalog

The current official regional sources disagree. For example, [ZARGES USA's 40810 page](https://zargesusa.com/products/k470-40810) lists external dimensions of 22.95 × 15.28 × 6.96 inches (about 583 × 388 × 177 mm), while the European maximum outside dimensions are 600 × 400 × 180 mm. The [US 40847 page](https://zargesusa.com/products/k470-40847) lists an external length of 45.28 inches (about 1150 mm), while the European maximum is 1200 mm. It also currently lists a clearance length larger than its external length, so those fields should not be silently treated as interchangeable measurements.

The regional 40847 empty weights also differ: the European table gives 7.5 kg, whereas the US page gives 19.2 lb (about 8.7 kg). We cannot establish from these pages whether these differences reflect measuring conventions, regional products, or catalog errors.

The planner therefore uses **one explicit convention: the European maximum outside dimensions and European weights**. Imperial display, where offered, converts those same metric figures; it does not switch to the US retail values. This makes calculations internally consistent without resolving the underlying manufacturer discrepancy. For a tightly constrained vehicle or purchase, request the applicable drawings and actual measurements from ZARGES.

## Maintaining the catalog

1. Confirm the exact standard model and regional variant with the manufacturer.
2. Record outside maximum and inside dimensions separately, in millimetres, with a direct official source.
3. Preserve the distinction between nominal capacity and a computed internal volume.
4. Use the geometry suite to verify existing arrangements whenever dimensions change.
5. Introduce a separate, sourced compatibility rule only after mechanical engagement is confirmed; do not infer that rule solely from a matching bounding rectangle.

The rendered cases are original procedural illustrations. Product names and trademarks identify the equipment; this is an independent proposal for ZARGES, not an official configurator.
