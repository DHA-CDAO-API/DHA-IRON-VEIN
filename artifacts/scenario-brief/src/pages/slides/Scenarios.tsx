export default function Scenarios() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg">
      <div className="absolute inset-0 grid-bg opacity-40" />

      <div className="absolute top-[6vh] left-[5vw] right-[5vw] flex items-center justify-between">
        <span className="font-mono text-[1vw] text-amber tracking-[0.4em] uppercase">Section 06 // Scenario Console</span>
        <span className="font-mono text-[0.9vw] text-muted">08 / 14</span>
      </div>

      <div className="absolute left-[5vw] top-[14vh] right-[5vw]">
        <h2 className="font-display font-bold text-[3.4vw] leading-[1.05] tracking-tight text-text max-w-[80vw]" style={{ textWrap: "balance" }}>
          Rehearse the next 30 days <span className="text-amber">before</span> they happen.
        </h2>
      </div>

      <div className="absolute left-[5vw] top-[34vh] right-[5vw] grid grid-cols-5 gap-[1.2vw]">
        <div className="bg-bg2 border border-edge p-[2vh_1.2vw]">
          <div className="font-mono text-[0.85vw] text-amber tracking-widest uppercase">Preset 01</div>
          <div className="font-display font-bold text-[1.5vw] text-text mt-[1vh] leading-tight">Typhoon Strike</div>
          <div className="font-body text-[0.95vw] text-muted mt-[1vh] leading-snug">Route closure on south corridor, demand spike at coastal MTFs</div>
        </div>
        <div className="bg-bg2 border border-edge p-[2vh_1.2vw]">
          <div className="font-mono text-[0.85vw] text-amber tracking-widest uppercase">Preset 02</div>
          <div className="font-display font-bold text-[1.5vw] text-text mt-[1vh] leading-tight">MTF Surge</div>
          <div className="font-body text-[0.95vw] text-muted mt-[1vh] leading-snug">Mass-cas event drives 3x demand at two MTFs for 7 days</div>
        </div>
        <div className="bg-bg2 border border-edge p-[2vh_1.2vw]">
          <div className="font-mono text-[0.85vw] text-amber tracking-widest uppercase">Preset 03</div>
          <div className="font-display font-bold text-[1.5vw] text-text mt-[1vh] leading-tight">Supplier Disruption</div>
          <div className="font-body text-[0.95vw] text-muted mt-[1vh] leading-snug">DLA prime vendor lead time grows 2x for 14 days</div>
        </div>
        <div className="bg-bg2 border border-edge p-[2vh_1.2vw]">
          <div className="font-mono text-[0.85vw] text-amber tracking-widest uppercase">Preset 04</div>
          <div className="font-display font-bold text-[1.5vw] text-text mt-[1vh] leading-tight">Route Closure</div>
          <div className="font-body text-[0.95vw] text-muted mt-[1vh] leading-snug">Air corridor down; reroute through surface lanes only</div>
        </div>
        <div className="bg-bg2 border border-edge p-[2vh_1.2vw]">
          <div className="font-mono text-[0.85vw] text-amber tracking-widest uppercase">Preset 05</div>
          <div className="font-display font-bold text-[1.5vw] text-text mt-[1vh] leading-tight">Forward BAS Push</div>
          <div className="font-body text-[0.95vw] text-muted mt-[1vh] leading-snug">Operational state escalates to CONFLICT &mdash; baseline demand +60%</div>
        </div>
      </div>

      <div className="absolute left-[5vw] right-[5vw] bottom-[8vh] grid grid-cols-3 gap-[1.5vw]">
        <div className="border-l-2 border-cyan pl-[1.2vw]">
          <div className="font-mono text-[0.85vw] text-cyan uppercase tracking-widest">Compose</div>
          <div className="font-body text-[1.1vw] text-text mt-[0.8vh] leading-snug">Stack any number of events &mdash; demand spikes, lead-time stress, availability drops, route closures</div>
        </div>
        <div className="border-l-2 border-cyan pl-[1.2vw]">
          <div className="font-mono text-[0.85vw] text-cyan uppercase tracking-widest">Simulate</div>
          <div className="font-body text-[1.1vw] text-text mt-[0.8vh] leading-snug">Horizon engine projects DOS, backorders, and risk &mdash; baseline vs scenario, side by side</div>
        </div>
        <div className="border-l-2 border-cyan pl-[1.2vw]">
          <div className="font-mono text-[0.85vw] text-cyan uppercase tracking-widest">Recommend</div>
          <div className="font-body text-[1.1vw] text-text mt-[0.8vh] leading-snug">Ranked actions with expected risk reduction &mdash; one click promotes to a draft purchase order</div>
        </div>
      </div>
    </div>
  );
}
