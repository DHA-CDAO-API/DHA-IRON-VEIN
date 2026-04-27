export default function Title() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg">
      <div className="absolute inset-0 grid-bg" />
      <div className="absolute inset-0 bg-gradient-to-br from-bg via-bg to-bg2" />

      <div className="absolute top-0 left-0 right-0 h-[8vh] flex items-center justify-between px-[5vw] border-b border-edge">
        <div className="flex items-center gap-[1.5vw]">
          <div className="w-[1.6vw] h-[1.6vw] bg-amber" />
          <span className="font-mono text-[1.1vw] tracking-[0.4em] text-muted uppercase">INDOPACOM // J4 MED</span>
        </div>
        <span className="font-mono text-[1.1vw] text-muted">CLASSIFICATION: UNCLASSIFIED // FOR DEMONSTRATION</span>
      </div>

      <div className="absolute left-[5vw] top-[22vh] right-[5vw]">
        <div className="font-mono text-[1.1vw] text-amber tracking-[0.5em] uppercase mb-[3vh]">
          Operational Scenario Brief
        </div>
        <h1 className="font-display font-bold text-[7vw] leading-[0.95] tracking-tight text-text" style={{ textWrap: "balance" }}>
          Predictive Medical
        </h1>
        <h1 className="font-display font-bold text-[7vw] leading-[0.95] tracking-tight text-amber" style={{ textWrap: "balance" }}>
          Sustainment.
        </h1>
        <div className="mt-[5vh] max-w-[58vw] font-body text-[1.6vw] text-muted leading-relaxed" style={{ textWrap: "pretty" }}>
          End-to-end decision support for the Pacific theater medical supply network.
          From hub-and-spoke visibility to AI-driven forecasting in a single command surface.
        </div>
      </div>

      <div className="absolute bottom-[6vh] left-[5vw] right-[5vw] flex items-end justify-between">
        <div className="flex items-center gap-[3vw]">
          <div>
            <div className="font-mono text-[0.9vw] text-muted uppercase tracking-widest">Date</div>
            <div className="font-mono text-[1.4vw] text-text mt-[0.4vh]">27 APR 2026</div>
          </div>
          <div className="w-px h-[5vh] bg-edge" />
          <div>
            <div className="font-mono text-[0.9vw] text-muted uppercase tracking-widest">Audience</div>
            <div className="font-mono text-[1.4vw] text-text mt-[0.4vh]">Modern Marine Hackathon Panel</div>
          </div>
          <div className="w-px h-[5vh] bg-edge" />
          <div>
            <div className="font-mono text-[0.9vw] text-muted uppercase tracking-widest">Task</div>
            <div className="font-mono text-[1.4vw] text-text mt-[0.4vh]">#1 Decision Support</div>
          </div>
        </div>
        <div className="font-mono text-[0.9vw] text-muted">01 / 14</div>
      </div>
    </div>
  );
}
