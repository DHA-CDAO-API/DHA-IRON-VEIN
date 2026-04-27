export default function Walkthrough() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg">
      <div className="absolute inset-0 grid-bg opacity-30" />

      <div className="absolute top-[6vh] left-[5vw] right-[5vw] flex items-center justify-between">
        <span className="font-mono text-[1vw] text-amber tracking-[0.4em] uppercase">Section 06 // Walkthrough</span>
        <span className="font-mono text-[0.9vw] text-muted">09 / 14</span>
      </div>

      <div className="absolute left-[5vw] top-[14vh] right-[5vw]">
        <h2 className="font-display font-bold text-[3.4vw] leading-[1.05] tracking-tight text-text max-w-[80vw]" style={{ textWrap: "balance" }}>
          Scenario: Typhoon Hagibis-class &mdash; 30 day horizon.
        </h2>
      </div>

      <div className="absolute left-[5vw] top-[32vh] right-[5vw] bottom-[6vh] grid grid-cols-12 gap-[1.5vw]">
        <div className="col-span-8 bg-bg2 border border-edge p-[2vh_1.5vw] flex flex-col">
          <div className="flex items-center justify-between mb-[1.5vh]">
            <div className="font-mono text-[0.9vw] text-cyan tracking-widest uppercase">Aggregate DOS &mdash; baseline vs scenario</div>
            <div className="font-mono text-[0.9vw] text-muted">days remaining</div>
          </div>
          <svg viewBox="0 0 800 280" className="w-full flex-1">
            <g stroke="#1f2937" strokeWidth="1">
              <line x1="60" y1="40" x2="760" y2="40" />
              <line x1="60" y1="100" x2="760" y2="100" />
              <line x1="60" y1="160" x2="760" y2="160" />
              <line x1="60" y1="220" x2="760" y2="220" />
              <line x1="60" y1="40" x2="60" y2="240" />
            </g>
            <g fill="#94a3b8" fontSize="11" fontFamily="IBM Plex Mono">
              <text x="20" y="44">40</text>
              <text x="20" y="104">30</text>
              <text x="20" y="164">20</text>
              <text x="20" y="224">10</text>
              <text x="55" y="258">D0</text>
              <text x="220" y="258">D7</text>
              <text x="395" y="258">D14</text>
              <text x="570" y="258">D21</text>
              <text x="735" y="258">D30</text>
            </g>
            <path d="M 60 65 L 130 67 L 200 70 L 270 72 L 340 75 L 410 78 L 480 80 L 550 82 L 620 84 L 690 86 L 760 88" stroke="#22d3ee" strokeWidth="2" fill="none" />
            <path d="M 60 65 L 130 70 L 200 95 L 270 140 L 340 185 L 410 200 L 480 195 L 550 175 L 620 150 L 690 130 L 760 115" stroke="#f59e0b" strokeWidth="2.5" fill="none" />
            <line x1="200" y1="40" x2="200" y2="240" stroke="#ef4444" strokeWidth="1" strokeDasharray="3 3" />
            <text x="206" y="48" fill="#ef4444" fontSize="11" fontFamily="IBM Plex Mono">D3 Typhoon landfall</text>
            <line x1="410" y1="40" x2="410" y2="240" stroke="#10b981" strokeWidth="1" strokeDasharray="3 3" />
            <text x="416" y="48" fill="#10b981" fontSize="11" fontFamily="IBM Plex Mono">D14 Recs promoted</text>
          </svg>
          <div className="flex items-center gap-[2vw] font-mono text-[0.9vw] text-muted mt-[1vh]">
            <span className="flex items-center gap-[0.5vw]"><span className="w-[1.5vw] h-[2px] bg-cyan inline-block" /> Baseline</span>
            <span className="flex items-center gap-[0.5vw]"><span className="w-[1.5vw] h-[2px] bg-amber inline-block" /> Scenario w/ recommendations</span>
          </div>
        </div>

        <div className="col-span-4 flex flex-col gap-[1vh]">
          <div className="bg-bg2 border border-edge p-[1.2vh_1vw]">
            <div className="font-mono text-[0.8vw] text-muted uppercase tracking-widest">Risk delta</div>
            <div className="font-display font-bold text-[2vw] text-rose mt-[0.4vh] leading-none">+38</div>
          </div>
          <div className="bg-bg2 border border-edge p-[1.2vh_1vw]">
            <div className="font-mono text-[0.8vw] text-muted uppercase tracking-widest">Peak backorders</div>
            <div className="font-display font-bold text-[2vw] text-amber mt-[0.4vh] leading-none">9,420u</div>
          </div>
          <div className="bg-bg2 border border-edge p-[1.2vh_1vw]">
            <div className="font-mono text-[0.8vw] text-muted uppercase tracking-widest">Critical nodes added</div>
            <div className="font-display font-bold text-[2vw] text-amber mt-[0.4vh] leading-none">4</div>
          </div>
          <div className="bg-bg2 border border-edge p-[1.5vh_1vw] flex-1">
            <div className="font-mono text-[0.8vw] text-cyan uppercase tracking-widest mb-[1vh]">Top recommendation</div>
            <div className="font-body text-[1.05vw] text-text leading-snug">REORDER 4,123u alcohol pads &rarr; BAS Copper</div>
            <div className="font-mono text-[0.85vw] text-muted mt-[1vh]">Expected risk reduction: 32 pts</div>
            <div className="font-mono text-[0.85vw] text-muted">Lead time: 3 days &middot; route: surface</div>
          </div>
        </div>
      </div>
    </div>
  );
}
