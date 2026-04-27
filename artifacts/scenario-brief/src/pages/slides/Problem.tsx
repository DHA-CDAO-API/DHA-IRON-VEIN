export default function Problem() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg">
      <div className="absolute inset-0 grid-bg opacity-40" />

      <div className="absolute top-[6vh] left-[5vw] right-[5vw] flex items-center justify-between">
        <span className="font-mono text-[1vw] text-amber tracking-[0.4em] uppercase">Section 01 // The Gap</span>
        <span className="font-mono text-[0.9vw] text-muted">02 / 14</span>
      </div>

      <div className="absolute left-[5vw] top-[16vh] right-[5vw]">
        <h2 className="font-display font-bold text-[4.6vw] leading-[1.05] tracking-tight text-text max-w-[70vw]" style={{ textWrap: "balance" }}>
          Medical sustainment in the Pacific runs on
          <span className="text-amber"> spreadsheets, batched reports, and phone calls.</span>
        </h2>
      </div>

      <div className="absolute left-[5vw] top-[58vh] right-[5vw] grid grid-cols-3 gap-[2vw]">
        <div className="border-l-2 border-amber pl-[1.5vw] pr-[1vw] py-[1vh]">
          <div className="font-display font-bold text-[3.6vw] text-text leading-none">72h</div>
          <div className="font-body text-[1.2vw] text-muted mt-[1.5vh] leading-snug" style={{ textWrap: "pretty" }}>
            Typical lag between consumption at a forward MTF and visibility at the theater hub
          </div>
        </div>
        <div className="border-l-2 border-cyan pl-[1.5vw] pr-[1vw] py-[1vh]">
          <div className="font-display font-bold text-[3.6vw] text-text leading-none">7+</div>
          <div className="font-body text-[1.2vw] text-muted mt-[1.5vh] leading-snug" style={{ textWrap: "pretty" }}>
            Disconnected tools a logistician touches to build a single replenishment recommendation
          </div>
        </div>
        <div className="border-l-2 border-rose pl-[1.5vw] pr-[1vw] py-[1vh]">
          <div className="font-display font-bold text-[3.6vw] text-text leading-none">0</div>
          <div className="font-body text-[1.2vw] text-muted mt-[1.5vh] leading-snug" style={{ textWrap: "pretty" }}>
            Native scenario rehearsal for typhoon, surge, or supplier disruption events
          </div>
        </div>
      </div>

      <div className="absolute bottom-[5vh] left-[5vw] right-[5vw] font-mono text-[1vw] text-muted tracking-wider uppercase">
        Source &mdash; Hackathon brief &middot; DMLSS field interviews &middot; current J4 medical workflow audit
      </div>
    </div>
  );
}
