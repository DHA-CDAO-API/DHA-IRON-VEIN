export default function Architecture() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg">
      <div className="absolute inset-0 grid-bg opacity-30" />

      <div className="absolute top-[6vh] left-[5vw] right-[5vw] flex items-center justify-between">
        <span className="font-mono text-[1vw] text-amber tracking-[0.4em] uppercase">Section 03 // Architecture</span>
        <span className="font-mono text-[0.9vw] text-muted">04 / 14</span>
      </div>

      <div className="absolute top-[14vh] left-[5vw] right-[5vw]">
        <h2 className="font-display font-bold text-[3.4vw] leading-[1.1] tracking-tight text-text max-w-[60vw]" style={{ textWrap: "balance" }}>
          Hub-and-spoke topology, modeled as a graph.
        </h2>
        <div className="font-body text-[1.3vw] text-muted mt-[1.5vh] max-w-[60vw] leading-relaxed" style={{ textWrap: "pretty" }}>
          31 nodes, 8 medical line items, ~60 active routes &mdash; ingested from the hackathon dataset and the live medical supply inventory feed.
        </div>
      </div>

      <div className="absolute left-[5vw] top-[42vh] right-[5vw] bottom-[10vh] grid grid-cols-5 gap-[1.5vw]">
        <div className="flex flex-col items-center justify-start gap-[1.5vh]">
          <div className="font-mono text-[0.8vw] text-muted uppercase tracking-widest">Source</div>
          <div className="w-full bg-bg2 border border-amber/60 px-[1vw] py-[1.5vh] text-center">
            <div className="font-display font-bold text-[1.4vw] text-amber leading-tight">DLA</div>
            <div className="font-mono text-[0.85vw] text-muted mt-[0.5vh]">Prime vendor</div>
          </div>
          <div className="w-full bg-bg2 border border-amber/60 px-[1vw] py-[1.5vh] text-center">
            <div className="font-display font-bold text-[1.4vw] text-amber leading-tight">Strategic</div>
            <div className="font-mono text-[0.85vw] text-muted mt-[0.5vh]">Supplier</div>
          </div>
        </div>

        <div className="flex flex-col items-center justify-start gap-[1.5vh]">
          <div className="font-mono text-[0.8vw] text-muted uppercase tracking-widest">Theater</div>
          <div className="w-full bg-bg2 border border-cyan/60 px-[1vw] py-[1.5vh] text-center">
            <div className="font-display font-bold text-[1.4vw] text-cyan leading-tight">Pacific Hub</div>
            <div className="font-mono text-[0.85vw] text-muted mt-[0.5vh]">Theater MED</div>
          </div>
        </div>

        <div className="flex flex-col items-center justify-start gap-[1.5vh]">
          <div className="font-mono text-[0.8vw] text-muted uppercase tracking-widest">Regional Hubs</div>
          <div className="w-full bg-bg2 border border-cyan/40 px-[1vw] py-[1vh] text-center">
            <div className="font-display font-bold text-[1.2vw] text-text leading-tight">North</div>
          </div>
          <div className="w-full bg-bg2 border border-cyan/40 px-[1vw] py-[1vh] text-center">
            <div className="font-display font-bold text-[1.2vw] text-text leading-tight">Central</div>
          </div>
          <div className="w-full bg-bg2 border border-cyan/40 px-[1vw] py-[1vh] text-center">
            <div className="font-display font-bold text-[1.2vw] text-text leading-tight">South</div>
          </div>
        </div>

        <div className="flex flex-col items-center justify-start gap-[1vh]">
          <div className="font-mono text-[0.8vw] text-muted uppercase tracking-widest">MTF (16)</div>
          <div className="w-full bg-bg2 border border-edge px-[0.6vw] py-[1vh] text-center">
            <div className="font-mono text-[0.95vw] text-text">Delta &middot; Echo</div>
          </div>
          <div className="w-full bg-bg2 border border-edge px-[0.6vw] py-[1vh] text-center">
            <div className="font-mono text-[0.95vw] text-text">Foxtrot &middot; Golf</div>
          </div>
          <div className="w-full bg-bg2 border border-edge px-[0.6vw] py-[1vh] text-center">
            <div className="font-mono text-[0.95vw] text-text">Hotel &middot; India</div>
          </div>
          <div className="w-full bg-bg2 border border-edge px-[0.6vw] py-[1vh] text-center">
            <div className="font-mono text-[0.95vw] text-text">Juliet &middot; Kilo</div>
          </div>
          <div className="w-full bg-bg2 border border-edge px-[0.6vw] py-[1vh] text-center">
            <div className="font-mono text-[0.95vw] text-muted">Lima &rarr; Victor</div>
          </div>
        </div>

        <div className="flex flex-col items-center justify-start gap-[1.5vh]">
          <div className="font-mono text-[0.8vw] text-muted uppercase tracking-widest">Forward (6)</div>
          <div className="w-full bg-bg2 border border-edge px-[0.6vw] py-[1vh] text-center">
            <div className="font-mono text-[0.95vw] text-text">BAS Copper</div>
          </div>
          <div className="w-full bg-bg2 border border-edge px-[0.6vw] py-[1vh] text-center">
            <div className="font-mono text-[0.95vw] text-text">BAS Iron</div>
          </div>
          <div className="w-full bg-bg2 border border-edge px-[0.6vw] py-[1vh] text-center">
            <div className="font-mono text-[0.95vw] text-text">BAS Steel</div>
          </div>
          <div className="w-full bg-bg2 border border-edge px-[0.6vw] py-[1vh] text-center">
            <div className="font-mono text-[0.95vw] text-text">BAS Zinc</div>
          </div>
          <div className="w-full bg-bg2 border border-edge px-[0.6vw] py-[1vh] text-center">
            <div className="font-mono text-[0.95vw] text-muted">Clinic Amber, Bronze</div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-[3vh] left-[5vw] right-[5vw] font-mono text-[1vw] text-muted tracking-wider">
        Edges carry lead time, mode, and operational friction &mdash; sim engine traverses them to project DOS and risk.
      </div>
    </div>
  );
}
