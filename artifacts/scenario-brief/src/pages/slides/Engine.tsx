export default function Engine() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg">
      <div className="absolute inset-0 grid-bg opacity-40" />

      <div className="absolute top-[6vh] left-[5vw] right-[5vw] flex items-center justify-between">
        <span className="font-mono text-[1vw] text-amber tracking-[0.4em] uppercase">Section 05 // Engine</span>
        <span className="font-mono text-[0.9vw] text-muted">07 / 14</span>
      </div>

      <div className="absolute left-[5vw] top-[14vh] right-[5vw]">
        <h2 className="font-display font-bold text-[3.4vw] leading-[1.05] tracking-tight text-text max-w-[80vw]" style={{ textWrap: "balance" }}>
          Predictive sustainment, in pure TypeScript.
        </h2>
        <div className="font-body text-[1.3vw] text-muted mt-[1.5vh] max-w-[68vw] leading-relaxed" style={{ textWrap: "pretty" }}>
          Deterministic core, ML-ready surface. Every score is reproducible &mdash; same seed, same answer.
        </div>
      </div>

      <div className="absolute left-[5vw] top-[36vh] right-[5vw] bottom-[6vh] grid grid-cols-12 gap-[1.5vw]">
        <div className="col-span-7 bg-bg2 border border-edge p-[2.5vh_1.5vw] flex flex-col">
          <div className="font-mono text-[0.9vw] text-cyan tracking-widest uppercase mb-[2vh]">Risk score &mdash; per node, per item</div>
          <div className="font-mono text-[1.4vw] text-text leading-[2] tracking-tight">
            <span className="text-amber">risk</span> = w<sub>1</sub>&middot;shortfallProb
          </div>
          <div className="font-mono text-[1.4vw] text-text leading-[2] tracking-tight">
            <span className="text-muted">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>+ w<sub>2</sub>&middot;criticality
          </div>
          <div className="font-mono text-[1.4vw] text-text leading-[2] tracking-tight">
            <span className="text-muted">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>+ w<sub>3</sub>&middot;leadTimeStress
          </div>
          <div className="font-mono text-[1.4vw] text-text leading-[2] tracking-tight">
            <span className="text-muted">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>+ w<sub>4</sub>&middot;routeFriction
          </div>
          <div className="font-mono text-[1.05vw] text-muted mt-[2vh] leading-relaxed">
            shortfallProb = P(onHand &minus; demand[t..t+leadTime] &lt; safetyStock)
          </div>
          <div className="font-mono text-[1.05vw] text-muted leading-relaxed">
            demand[t] = base &middot; opStateScalar &middot; eventModifier &middot; jitter
          </div>
        </div>

        <div className="col-span-5 flex flex-col gap-[1.5vh]">
          <div className="bg-bg2 border border-edge p-[1.5vh_1.2vw]">
            <div className="font-mono text-[0.85vw] text-amber tracking-widest uppercase">Inputs</div>
            <div className="font-body text-[1.1vw] text-text mt-[0.8vh] leading-snug">Inventory balances, demand profiles, lead-time matrix, operational state, scenario events</div>
          </div>
          <div className="bg-bg2 border border-edge p-[1.5vh_1.2vw]">
            <div className="font-mono text-[0.85vw] text-amber tracking-widest uppercase">Outputs</div>
            <div className="font-body text-[1.1vw] text-text mt-[0.8vh] leading-snug">Per-node DOS forecast, risk score, ranked recommendations, expected risk reduction</div>
          </div>
          <div className="bg-bg2 border border-edge p-[1.5vh_1.2vw]">
            <div className="font-mono text-[0.85vw] text-amber tracking-widest uppercase">Properties</div>
            <div className="font-body text-[1.1vw] text-text mt-[0.8vh] leading-snug">Pure functions, deterministic jitter, sub-second horizon simulation, no external dependencies</div>
          </div>
        </div>
      </div>
    </div>
  );
}
