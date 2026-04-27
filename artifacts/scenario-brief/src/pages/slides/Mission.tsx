export default function Mission() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg">
      <div className="absolute inset-0 grid-bg opacity-40" />

      <div className="absolute top-[6vh] left-[5vw] right-[5vw] flex items-center justify-between">
        <span className="font-mono text-[1vw] text-amber tracking-[0.4em] uppercase">Section 02 // The Mission</span>
        <span className="font-mono text-[0.9vw] text-muted">03 / 14</span>
      </div>

      <div className="absolute left-[5vw] top-[18vh] right-[5vw]">
        <div className="font-mono text-[1vw] text-cyan tracking-[0.3em] uppercase mb-[2vh]">Mission statement</div>
        <h2 className="font-display font-bold text-[3.8vw] leading-[1.1] tracking-tight text-text max-w-[80vw]" style={{ textWrap: "balance" }}>
          Give every commander, logistician, planner, and analyst a single live picture of medical
          sustainment risk &mdash; <span className="text-amber">and a defensible recommended action</span> &mdash;
          before the shortfall happens.
        </h2>
      </div>

      <div className="absolute left-[5vw] top-[64vh] right-[5vw] grid grid-cols-4 gap-[1.5vw]">
        <div className="bg-bg2 border border-edge p-[2vh_1.5vw]">
          <div className="font-mono text-[0.85vw] text-amber tracking-widest uppercase">01</div>
          <div className="font-display font-bold text-[1.7vw] text-text mt-[1.5vh] leading-tight">See</div>
          <div className="font-body text-[1vw] text-muted mt-[1vh] leading-snug">Live theater operating picture across hubs, BAS, MTF, clinics</div>
        </div>
        <div className="bg-bg2 border border-edge p-[2vh_1.5vw]">
          <div className="font-mono text-[0.85vw] text-amber tracking-widest uppercase">02</div>
          <div className="font-display font-bold text-[1.7vw] text-text mt-[1.5vh] leading-tight">Predict</div>
          <div className="font-body text-[1vw] text-muted mt-[1vh] leading-snug">Days-of-supply forecast under demand, lead-time, and route stressors</div>
        </div>
        <div className="bg-bg2 border border-edge p-[2vh_1.5vw]">
          <div className="font-mono text-[0.85vw] text-amber tracking-widest uppercase">03</div>
          <div className="font-display font-bold text-[1.7vw] text-text mt-[1.5vh] leading-tight">Decide</div>
          <div className="font-body text-[1vw] text-muted mt-[1vh] leading-snug">AI-ranked replenishment, redistribution, and substitution actions</div>
        </div>
        <div className="bg-bg2 border border-edge p-[2vh_1.5vw]">
          <div className="font-mono text-[0.85vw] text-amber tracking-widest uppercase">04</div>
          <div className="font-display font-bold text-[1.7vw] text-text mt-[1.5vh] leading-tight">Act</div>
          <div className="font-body text-[1vw] text-muted mt-[1vh] leading-snug">One-click promotion to purchase order, CSV/XLSX export, print PO</div>
        </div>
      </div>
    </div>
  );
}
