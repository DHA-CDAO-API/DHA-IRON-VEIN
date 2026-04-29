# Consumer-type pattern

The casualty-driven medical readiness model in this directory is built
around a single structural idea: **demand for materiel comes from
counting *consumers* of a given type and multiplying by a per-consumer
bill-of-materials**.

Today the only consumer type is `patient`, but the same shape works
unchanged for any future consumer that uses up supply over time:

| Consumer type   | Example domain        | "Per-consumer" requirement              |
|-----------------|-----------------------|------------------------------------------|
| `patient`       | Class VIII medical    | Trauma-severe patient → 4 PRBC, 2 LTOW… |
| `vehicle`       | Class IX repair parts | LMTV → 1 oil filter / 30 days, 4 tires… |
| `troop`         | Class I subsistence   | One Marine on the line → 3 MREs / day  |
| `aircraft`      | Class III(A) fuel     | F-35A → ~5,800 lb JP-8 / sortie         |

## Files involved (today)

* `lib/db/src/schema/items.ts` — items now carry `commodityType`,
  `unspscCommodity`, `size`, `productNoun`, and `staffingTag` so
  consumer-driven demand can group / look up items by commodity rather
  than by hand-curated id.
* `lib/db/src/schema/casualty.ts` — `patient_types`,
  `patient_item_requirements`, `event_types`, `event_patient_mix`. This
  is the *patient* consumer type.
* `lib/sim/src/staffing.ts` — clinician + PPE staffing model. PPE is
  resolved by the items table's `staffingTag` so swapping in different
  PPE skus doesn't touch this file.
* `lib/sim/src/casualty.ts` — `computeCasualtyDemand`,
  `evaluateSiteSufficiency`, `suggestPatientReroutes`. These are the
  patient-shaped engine.

## Recipe: adding a new consumer type

To add another consumer type (say `vehicle_types` driving Class IX
repair parts):

1. **Add a `<consumer>_types` table** with at minimum: `id`, `name`,
   plus a few attributes the engine will reduce over (e.g. for vehicles
   you might add `mileagePerDayMean`, `dutyCycle`).
2. **Add a `<consumer>_item_requirements` table** with a `(consumerId,
   itemId, quantityPerConsumer, notes)` shape mirroring
   `patient_item_requirements`.
3. **Add an `event_<consumer>_mix` table** if events drive a default
   mix of consumer counts (mirrors `event_patient_mix`).
4. **Tag the relevant items** with `commodityType`, `unspscCommodity`,
   `size`, `productNoun`. If the engine resolves by tag (the way
   PPE resolves by `staffingTag`), add a corresponding `<role>Tag`
   column or reuse `staffingTag`.
5. **Add a `<consumer>.ts` engine** in `lib/sim/src/` exporting:
   * `compute<Consumer>Demand(input, items, types, requirements) →
     <Requirement>Row[]`
   * `evaluateSiteSufficiency(siteId, demand) → SufficiencyRow[]`
     (or share the existing one if the shape matches).
   * Optionally `suggest<Consumer>Reroutes(siteId, unmet) →
     RerouteCandidate[]` if it makes sense for that consumer type.
6. **Surface in the API** under a parallel route file (e.g. routes
   `/vehicle/evaluate`, `/vehicle-types`) and regenerate the
   `api-client-react` and `api-zod` packages with `pnpm --filter
   @workspace/api-spec run codegen`.
7. **Surface in the UI** as a sibling page to Casualty Planner.
   Reuse the bulk-promote button (`promoteShortfallsToOrders`) — it
   doesn't care which engine produced the shortfall list.

## What does *not* need to change

* The recommendation/supplier ranker (`rankSuppliersForShortfall`).
  It already takes a generic `(itemId, suggestedQty,
  shortfallHorizonDays)` and returns ranked suppliers — it has no
  opinion about whether the shortfall came from patients, vehicles,
  or troops.
* The order pipeline (`POST /orders`) — it sees a per-item quantity and
  a destination node. It doesn't care which consumer type drove the
  demand.
* The blood-readiness panel and existing `computeDailyDemand` — they
  remain as the "trigger-event" model that drives the steady-state
  blood worldview, untouched by the casualty engine.
