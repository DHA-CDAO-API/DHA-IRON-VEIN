import coverage from "@/data/coverage.json";

export default function Deliver() {
  const { network, supplierMix } = coverage;

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg">
      <div className="absolute inset-0 grid-bg opacity-40" />
      <div className="absolute inset-0 bg-gradient-to-br from-transparent via-transparent to-amber/5" />

      <div className="absolute top-[6vh] left-[5vw] right-[5vw] flex items-center justify-between">
        <div className="flex items-center gap-[1.4vw]">
          <span className="font-mono text-[1.2vw] text-amber tracking-[0.4em] uppercase">
            Section 02 // What We Deliver
          </span>
          <span className="bg-amber text-bg font-mono text-[1vw] tracking-[0.3em] uppercase font-bold px-[1vw] py-[0.5vh]">
            AI Across the Loop
          </span>
        </div>
        <span className="font-mono text-[1.05vw] text-muted">03 / 03</span>
      </div>

      <div className="absolute left-[5vw] top-[13vh] right-[5vw]">
        <h2 className="font-display font-bold text-[3.2vw] leading-[1.05] tracking-tight text-text max-w-[92vw]">
          One <span className="text-amber">AI-driven command surface</span> for Class&nbsp;VIII medical sustainment.
        </h2>
        <div className="font-mono text-[1.2vw] text-muted mt-[1.4vh] tracking-[0.3em] uppercase">
          Observe <span className="text-amber">&rarr;</span> Orient <span className="text-amber">&rarr;</span> Decide <span className="text-amber">&rarr;</span> Act
        </div>
        <div className="font-body text-[1.15vw] text-text/75 mt-[0.9vh]">
          <span className="text-amber font-mono tracking-widest uppercase text-[1vw]">Class&nbsp;VIII&nbsp;=</span>
          {" "}blood products &middot; medical supplies &middot; pharmaceuticals &middot; cold-chain reagents &middot; PPE &middot; trauma kits
        </div>
      </div>

      <div className="absolute left-[5vw] right-[5vw] top-[33vh] bottom-[22vh]">
        <div className="grid grid-cols-4 gap-[1vw] h-full">

          <div className="bg-bg2 border border-edge p-[1.6vh_1.1vw] flex flex-col">
            <div className="flex items-center gap-[0.6vw]">
              <div className="w-[0.6vw] h-[0.6vw] rounded-full bg-cyan" />
              <span className="font-mono text-[1vw] text-cyan tracking-[0.35em] uppercase">
                01 &middot; Observe
              </span>
            </div>
            <div className="h-px bg-edge my-[1.4vh]" />
            <div className="flex-1 flex flex-col justify-between">
              <div>
                <div className="font-display font-semibold text-[1.35vw] text-text leading-tight">
                  Mission-Risk Matrix
                </div>
                <div className="font-body text-[1.05vw] text-muted leading-snug mt-[0.4vh]">
                  Mission &times; supply, time-to-fail
                </div>
              </div>
              <div>
                <div className="font-display font-semibold text-[1.35vw] text-text leading-tight">
                  Risk score per node (0&ndash;100)
                </div>
                <div className="font-body text-[1.05vw] text-muted leading-snug mt-[0.4vh]">
                  DOS, alerts, route reliability
                </div>
              </div>
              <div>
                <div className="font-display font-semibold text-[1.35vw] text-text leading-tight">
                  Cold-Chain Pulse
                </div>
                <div className="font-body text-[1.05vw] text-muted leading-snug mt-[0.4vh]">
                  Live ECG of theater excursions
                </div>
              </div>
              <div>
                <div className="font-display font-semibold text-[1.35vw] text-text leading-tight">
                  1&ndash;45 day burn-down
                </div>
                <div className="font-body text-[1.05vw] text-muted leading-snug mt-[0.4vh]">
                  Viable-DOS for perishables
                </div>
              </div>
              <div>
                <div className="font-display font-semibold text-[1.35vw] text-text leading-tight">
                  Time-to-Fail leaderboard
                </div>
                <div className="font-body text-[1.05vw] text-muted leading-snug mt-[0.4vh]">
                  Fragile sites first
                </div>
              </div>
            </div>
          </div>

          <div className="bg-bg2 border border-edge p-[1.6vh_1.1vw] flex flex-col">
            <div className="flex items-center gap-[0.6vw]">
              <div className="w-[0.6vw] h-[0.6vw] rounded-full bg-teal" />
              <span className="font-mono text-[1vw] text-teal tracking-[0.35em] uppercase">
                02 &middot; Orient
              </span>
            </div>
            <div className="h-px bg-edge my-[1.4vh]" />
            <div className="flex-1 flex flex-col justify-between">
              <div>
                <div className="font-display font-semibold text-[1.35vw] text-text leading-tight">
                  Scenario rehearsal
                </div>
                <div className="font-body text-[1.05vw] text-muted leading-snug mt-[0.4vh]">
                  Blockade, MASCAL, strike, cyber
                </div>
              </div>
              <div>
                <div className="font-display font-semibold text-[1.35vw] text-text leading-tight">
                  Constraint cascade
                </div>
                <div className="font-body text-[1.05vw] text-muted leading-snug mt-[0.4vh]">
                  Hub loss, reagent &rarr; WBB haircut
                </div>
              </div>
              <div>
                <div className="font-display font-semibold text-[1.35vw] text-text leading-tight">
                  Ad-hoc threat zones
                </div>
                <div className="font-body text-[1.05vw] text-muted leading-snug mt-[0.4vh]">
                  Draw it &rarr; routes &amp; risk recompute
                </div>
              </div>
              <div>
                <div className="font-display font-semibold text-[1.35vw] text-text leading-tight">
                  Casualty planner
                </div>
                <div className="font-body text-[1.05vw] text-muted leading-snug mt-[0.4vh]">
                  Load &rarr; BOM &rarr; patient reroute
                </div>
              </div>
              <div>
                <div className="font-display font-semibold text-[1.35vw] text-text leading-tight">
                  AI COA brief per run
                </div>
                <div className="font-body text-[1.05vw] text-muted leading-snug mt-[0.4vh]">
                  Auto-written, baseline vs. perturbed
                </div>
              </div>
            </div>
          </div>

          <div className="bg-bg2 border border-amber/50 p-[1.6vh_1.1vw] flex flex-col relative">
            <div className="absolute top-0 right-0 bg-amber text-bg font-mono text-[0.95vw] tracking-widest uppercase px-[0.8vw] py-[0.4vh]">
              AI
            </div>
            <div className="flex items-center gap-[0.6vw]">
              <div className="w-[0.6vw] h-[0.6vw] rounded-full bg-amber" />
              <span className="font-mono text-[1vw] text-amber tracking-[0.35em] uppercase">
                03 &middot; Decide
              </span>
            </div>
            <div className="h-px bg-edge my-[1.4vh]" />
            <div className="flex-1 flex flex-col justify-between">
              <div>
                <div className="font-display font-semibold text-[1.35vw] text-text leading-tight">
                  Sustainment Copilot
                </div>
                <div className="font-body text-[1.05vw] text-muted leading-snug mt-[0.4vh]">
                  BLUF, citations to nodes &amp; orders
                </div>
              </div>
              <div>
                <div className="font-display font-semibold text-[1.35vw] text-text leading-tight">
                  Auto-drafted POs
                </div>
                <div className="font-body text-[1.05vw] text-muted leading-snug mt-[0.4vh]">
                  Qty, supplier rank, viability fit
                </div>
              </div>
              <div>
                <div className="font-display font-semibold text-[1.35vw] text-text leading-tight">
                  Auto-rerouting
                </div>
                <div className="font-body text-[1.05vw] text-muted leading-snug mt-[0.4vh]">
                  Primary down &rarr; next best, with note
                </div>
              </div>
              <div>
                <div className="font-display font-semibold text-[1.35vw] text-text leading-tight">
                  Companion-supply bundling
                </div>
                <div className="font-body text-[1.05vw] text-muted leading-snug mt-[0.4vh]">
                  Full procedure on one PO
                </div>
              </div>
              <div>
                <div className="font-display font-semibold text-[1.35vw] text-text leading-tight">
                  TLAMM self-replenish
                </div>
                <div className="font-body text-[1.05vw] text-muted leading-snug mt-[0.4vh]">
                  Hub aggregates downstream demand
                </div>
              </div>
            </div>
          </div>

          <div className="bg-bg2 border border-edge p-[1.6vh_1.1vw] flex flex-col">
            <div className="flex items-center gap-[0.6vw]">
              <div className="w-[0.6vw] h-[0.6vw] rounded-full bg-emerald" />
              <span className="font-mono text-[1vw] text-emerald tracking-[0.35em] uppercase">
                04 &middot; Act
              </span>
            </div>
            <div className="h-px bg-edge my-[1.4vh]" />
            <div className="flex-1 flex flex-col justify-between">
              <div>
                <div className="font-display font-semibold text-[1.35vw] text-text leading-tight">
                  One-click PO promote
                </div>
                <div className="font-body text-[1.05vw] text-muted leading-snug mt-[0.4vh]">
                  Recommendation &rarr; live order
                </div>
              </div>
              <div>
                <div className="font-display font-semibold text-[1.35vw] text-text leading-tight">
                  Walking Blood Bank activation
                </div>
                <div className="font-body text-[1.05vw] text-muted leading-snug mt-[0.4vh]">
                  Reagent-aware capacity by type
                </div>
              </div>
              <div>
                <div className="font-display font-semibold text-[1.35vw] text-text leading-tight">
                  Override before push
                </div>
                <div className="font-body text-[1.05vw] text-muted leading-snug mt-[0.4vh]">
                  Qty, supplier, priority on the fly
                </div>
              </div>
              <div>
                <div className="font-display font-semibold text-[1.35vw] text-text leading-tight">
                  Shipment auto-tracking
                </div>
                <div className="font-body text-[1.05vw] text-muted leading-snug mt-[0.4vh]">
                  ETA, ack/escalate workflow
                </div>
              </div>
              <div>
                <div className="font-display font-semibold text-[1.35vw] text-text leading-tight">
                  Defensible audit trail
                </div>
                <div className="font-body text-[1.05vw] text-muted leading-snug mt-[0.4vh]">
                  Every action cites the AI rationale
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute left-[5vw] right-[5vw] bottom-[5vh]">
        <div className="border-t border-edge pt-[1.4vh] flex items-stretch gap-[1.5vw]">
          <div className="flex-1 grid grid-cols-3 gap-[1vw]">
            <div>
              <div className="font-mono text-[0.95vw] text-muted tracking-widest uppercase">
                Class VIII
              </div>
              <div className="font-display font-bold text-[1.95vw] text-text mt-[0.3vh] leading-none">
                5,000+ items
              </div>
              <div className="font-mono text-[1vw] text-muted mt-[0.4vh]">
                blood &middot; trauma &middot; pharma &middot; cold-chain &middot; PPE
              </div>
            </div>
            <div>
              <div className="font-mono text-[0.95vw] text-muted tracking-widest uppercase">
                Network
              </div>
              <div className="font-display font-bold text-[1.95vw] text-text mt-[0.3vh] leading-none">
                {network.operationalNodeCount} nodes
              </div>
              <div className="font-mono text-[1vw] text-muted mt-[0.4vh]">
                {network.theaterHubs} theater &middot; {network.regionalHubs} regional &middot; {network.mtfTotal} MTFs &middot; {network.bas} BAS
              </div>
            </div>
            <div>
              <div className="font-mono text-[0.95vw] text-muted tracking-widest uppercase">
                Suppliers
              </div>
              <div className="font-display font-bold text-[1.95vw] text-text mt-[0.3vh] leading-none">
                {supplierMix.total} sources
              </div>
              <div className="font-mono text-[1vw] text-muted mt-[0.4vh]">
                DLA &middot; ASBP &middot; commercial &middot; host-nation ({supplierMix.hostNationCountries.join(",")}) &middot; allied ({supplierMix.alliedCountries.join(",")})
              </div>
            </div>
          </div>

          <div className="w-px bg-edge" />

          <div className="w-[24vw] flex flex-col justify-center">
            <div className="font-mono text-[0.95vw] text-amber tracking-widest uppercase">
              Handoff
            </div>
            <div className="font-display font-semibold text-[1.35vw] text-text mt-[0.3vh] leading-snug">
              Watch the loop close: blockade &rarr; draft PO &rarr; auto-reroute &rarr; one-click push.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
