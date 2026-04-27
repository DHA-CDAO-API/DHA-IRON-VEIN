export default function Compare() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg">
      <div className="absolute inset-0 grid-bg opacity-40" />

      <div className="absolute top-[6vh] left-[5vw] right-[5vw] flex items-center justify-between">
        <span className="font-mono text-[1vw] text-amber tracking-[0.4em] uppercase">Section 10 // Why It Matters</span>
        <span className="font-mono text-[0.9vw] text-muted">13 / 14</span>
      </div>

      <div className="absolute left-[5vw] top-[14vh] right-[5vw]">
        <h2 className="font-display font-bold text-[3.4vw] leading-[1.05] tracking-tight text-text max-w-[80vw]" style={{ textWrap: "balance" }}>
          DMLSS-compatible, but built for the operating tempo of the next fight.
        </h2>
      </div>

      <div className="absolute left-[5vw] top-[34vh] right-[5vw] bottom-[8vh]">
        <div className="grid grid-cols-3 border border-edge font-mono">
          <div className="bg-bg2 px-[1.2vw] py-[1.5vh] text-[0.95vw] text-muted uppercase tracking-widest">Capability</div>
          <div className="bg-bg2 px-[1.2vw] py-[1.5vh] text-[0.95vw] text-muted uppercase tracking-widest border-l border-edge">Today &mdash; DMLSS / spreadsheet</div>
          <div className="bg-bg2 px-[1.2vw] py-[1.5vh] text-[0.95vw] text-amber uppercase tracking-widest border-l border-edge">This platform</div>

          <div className="px-[1.2vw] py-[1.5vh] text-[1.1vw] text-text border-t border-edge">Theater visibility</div>
          <div className="px-[1.2vw] py-[1.5vh] text-[1.05vw] text-muted border-t border-l border-edge">Batched reports, 24-72h lag</div>
          <div className="px-[1.2vw] py-[1.5vh] text-[1.05vw] text-text border-t border-l border-edge">Live snapshot, 5-second refresh</div>

          <div className="px-[1.2vw] py-[1.5vh] text-[1.1vw] text-text border-t border-edge">Forecasting</div>
          <div className="px-[1.2vw] py-[1.5vh] text-[1.05vw] text-muted border-t border-l border-edge">Manual workbook trends</div>
          <div className="px-[1.2vw] py-[1.5vh] text-[1.05vw] text-text border-t border-l border-edge">Deterministic horizon engine, scenario stress</div>

          <div className="px-[1.2vw] py-[1.5vh] text-[1.1vw] text-text border-t border-edge">Recommendations</div>
          <div className="px-[1.2vw] py-[1.5vh] text-[1.05vw] text-muted border-t border-l border-edge">Tribal knowledge, ad-hoc</div>
          <div className="px-[1.2vw] py-[1.5vh] text-[1.05vw] text-text border-t border-l border-edge">Ranked, scored, one-click promotion to PO</div>

          <div className="px-[1.2vw] py-[1.5vh] text-[1.1vw] text-text border-t border-edge">Scenario rehearsal</div>
          <div className="px-[1.2vw] py-[1.5vh] text-[1.05vw] text-muted border-t border-l border-edge">Tabletop, off-system</div>
          <div className="px-[1.2vw] py-[1.5vh] text-[1.05vw] text-text border-t border-l border-edge">Native console with preset events and saved runs</div>

          <div className="px-[1.2vw] py-[1.5vh] text-[1.1vw] text-text border-t border-edge">Decision support</div>
          <div className="px-[1.2vw] py-[1.5vh] text-[1.05vw] text-muted border-t border-l border-edge">None embedded</div>
          <div className="px-[1.2vw] py-[1.5vh] text-[1.05vw] text-text border-t border-l border-edge">Grounded AI co-pilot, switchable provider</div>

          <div className="px-[1.2vw] py-[1.5vh] text-[1.1vw] text-text border-t border-edge">Hand-off</div>
          <div className="px-[1.2vw] py-[1.5vh] text-[1.05vw] text-muted border-t border-l border-edge">Email, attachments, re-keying</div>
          <div className="px-[1.2vw] py-[1.5vh] text-[1.05vw] text-text border-t border-l border-edge">Print PO, CSV, XLSX &mdash; DMLSS-shaped</div>
        </div>
      </div>
    </div>
  );
}
