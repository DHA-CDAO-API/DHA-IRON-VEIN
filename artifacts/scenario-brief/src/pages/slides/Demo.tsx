export default function Demo() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg">
      <div className="absolute inset-0 grid-bg opacity-40" />

      <div className="absolute top-[6vh] left-[5vw] right-[5vw] flex items-center justify-between">
        <span className="font-mono text-[1vw] text-amber tracking-[0.4em] uppercase">Section 11 // Demo Flow</span>
        <span className="font-mono text-[0.9vw] text-muted">14 / 14</span>
      </div>

      <div className="absolute left-[5vw] top-[16vh] right-[5vw]">
        <h2 className="font-display font-bold text-[4.6vw] leading-[1] tracking-tight text-text" style={{ textWrap: "balance" }}>
          The 7-minute walkthrough.
        </h2>
        <div className="font-body text-[1.4vw] text-muted mt-[2vh] max-w-[60vw] leading-relaxed">
          Each step happens in the live app, with seeded data &mdash; no mocks.
        </div>
      </div>

      <div className="absolute left-[5vw] top-[44vh] right-[40vw] space-y-[1.6vh]">
        <div className="flex items-baseline gap-[1.5vw]">
          <span className="font-mono text-[1.2vw] text-amber w-[3vw] shrink-0">01</span>
          <span className="font-body text-[1.25vw] text-text leading-snug">Open Command Overview &mdash; theater map, KPIs, alerts &mdash; current operating picture</span>
        </div>
        <div className="flex items-baseline gap-[1.5vw]">
          <span className="font-mono text-[1.2vw] text-amber w-[3vw] shrink-0">02</span>
          <span className="font-body text-[1.25vw] text-text leading-snug">Drill into BAS Steel &mdash; show why it is at warning, look at item DOS and recommendations</span>
        </div>
        <div className="flex items-baseline gap-[1.5vw]">
          <span className="font-mono text-[1.2vw] text-amber w-[3vw] shrink-0">03</span>
          <span className="font-body text-[1.25vw] text-text leading-snug">Switch role to Logistician &mdash; promote a recommendation to a draft PO, advance status</span>
        </div>
        <div className="flex items-baseline gap-[1.5vw]">
          <span className="font-mono text-[1.2vw] text-amber w-[3vw] shrink-0">04</span>
          <span className="font-body text-[1.25vw] text-text leading-snug">Open Scenario Console &mdash; load PRC Contingency preset, run 30-day horizon, inspect recommended whole-blood &amp; PRBC actions</span>
        </div>
        <div className="flex items-baseline gap-[1.5vw]">
          <span className="font-mono text-[1.2vw] text-amber w-[3vw] shrink-0">05</span>
          <span className="font-body text-[1.25vw] text-text leading-snug">Open AI Co-Pilot &mdash; ask "why is BAS Steel red", swap provider, ask it to draft orders</span>
        </div>
        <div className="flex items-baseline gap-[1.5vw]">
          <span className="font-mono text-[1.2vw] text-amber w-[3vw] shrink-0">06</span>
          <span className="font-body text-[1.25vw] text-text leading-snug">Print a PO and export inventory CSV &mdash; close the loop with downstream DMLSS hand-off</span>
        </div>
      </div>

      <div className="absolute right-[5vw] top-[44vh] w-[32vw] bg-bg2 border border-edge p-[2.5vh_1.5vw]">
        <div className="font-mono text-[0.9vw] text-amber tracking-widest uppercase">Deliverables</div>
        <div className="font-mono text-[1.1vw] text-text mt-[1.5vh] leading-[2.2]">
          <div>&middot; Live web platform</div>
          <div>&middot; Predictive sustainment engine</div>
          <div>&middot; PostgreSQL schema + ingest</div>
          <div>&middot; Scenario console + brief deck</div>
          <div>&middot; Comprehensive root README</div>
        </div>
        <div className="font-mono text-[0.85vw] text-muted mt-[2vh] leading-snug pt-[1.5vh] border-t border-edge">
          Built on the Replit pnpm monorepo &middot; React 19 + Vite + Tailwind v4 + Drizzle + Express
        </div>
      </div>

      <div className="absolute bottom-[5vh] left-[5vw] right-[5vw] flex items-center justify-between font-mono text-[1vw] text-muted">
        <span>Modern Marine Hackathon &middot; Task #1 Decision Support</span>
        <span className="text-amber">END BRIEF // BACK TO LIVE APP</span>
      </div>
    </div>
  );
}
