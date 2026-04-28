export default function LiveOps() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg">
      <div className="absolute inset-0 grid-bg opacity-50" />

      <div className="absolute top-[6vh] left-[5vw] right-[5vw] flex items-center justify-between">
        <span className="font-mono text-[1vw] text-amber tracking-[0.4em] uppercase">Section 04 // Operating Picture</span>
        <span className="font-mono text-[0.9vw] text-muted">06 / 14</span>
      </div>

      <div className="absolute top-[14vh] left-[5vw] right-[5vw]">
        <h2 className="font-display font-bold text-[3.4vw] leading-[1.05] tracking-tight text-text max-w-[80vw]" style={{ textWrap: "balance" }}>
          The dashboard is the situation report.
        </h2>
        <div className="font-body text-[1.3vw] text-muted mt-[1vh] max-w-[60vw] leading-relaxed">
          Live theater map, KPI strip, alerts rail, recent activity &mdash; refreshing every 5 seconds.
        </div>
      </div>

      <div className="absolute left-[5vw] right-[5vw] top-[34vh] bottom-[6vh] grid grid-cols-12 grid-rows-6 gap-[1vw]">
        <div className="col-span-3 row-span-1 bg-bg2 border border-edge p-[1.5vh_1vw]">
          <div className="font-mono text-[0.8vw] text-muted uppercase tracking-widest">Theater DOS</div>
          <div className="font-display font-bold text-[2.4vw] text-text mt-[0.5vh] leading-none">36.5d</div>
        </div>
        <div className="col-span-3 row-span-1 bg-bg2 border border-edge p-[1.5vh_1vw]">
          <div className="font-mono text-[0.8vw] text-muted uppercase tracking-widest">Open Alerts</div>
          <div className="font-display font-bold text-[2.4vw] text-amber mt-[0.5vh] leading-none">17</div>
        </div>
        <div className="col-span-3 row-span-1 bg-bg2 border border-edge p-[1.5vh_1vw]">
          <div className="font-mono text-[0.8vw] text-muted uppercase tracking-widest">In-Flight</div>
          <div className="font-display font-bold text-[2.4vw] text-cyan mt-[0.5vh] leading-none">2</div>
        </div>
        <div className="col-span-3 row-span-1 bg-bg2 border border-edge p-[1.5vh_1vw]">
          <div className="font-mono text-[0.8vw] text-muted uppercase tracking-widest">Pending Recs</div>
          <div className="font-display font-bold text-[2.4vw] text-text mt-[0.5vh] leading-none">17</div>
        </div>

        <div className="col-span-8 row-span-5 bg-bg2 border border-edge relative overflow-hidden">
          <div className="absolute top-[1.5vh] left-[1vw] font-mono text-[0.85vw] text-cyan tracking-widest uppercase">Live Theater Map &mdash; deck.gl + MapLibre</div>
          <svg viewBox="0 0 800 400" className="w-full h-full opacity-90">
            <rect width="800" height="400" fill="#0E0A0C" />
            <g stroke="#2A1D22" strokeWidth="1">
              <line x1="0" y1="100" x2="800" y2="100" />
              <line x1="0" y1="200" x2="800" y2="200" />
              <line x1="0" y1="300" x2="800" y2="300" />
              <line x1="200" y1="0" x2="200" y2="400" />
              <line x1="400" y1="0" x2="400" y2="400" />
              <line x1="600" y1="0" x2="600" y2="400" />
            </g>
            <g stroke="#FFCC00" strokeWidth="1.5" opacity="0.5" fill="none">
              <path d="M 120 320 Q 300 100 480 200" />
              <path d="M 480 200 Q 580 230 660 270" />
              <path d="M 480 200 Q 540 130 620 90" />
              <path d="M 480 200 Q 380 280 280 340" />
            </g>
            <g>
              <circle cx="120" cy="320" r="9" fill="#FFCC00" />
              <circle cx="120" cy="320" r="18" fill="#FFCC00" opacity="0.2" />
              <circle cx="480" cy="200" r="11" fill="#BA0C2F" />
              <circle cx="480" cy="200" r="22" fill="#BA0C2F" opacity="0.15" />
              <circle cx="280" cy="340" r="7" fill="#4DA374" />
              <circle cx="660" cy="270" r="7" fill="#BA0C2F" />
              <circle cx="660" cy="270" r="14" fill="#BA0C2F" opacity="0.25" />
              <circle cx="620" cy="90" r="6" fill="#4DA374" />
              <circle cx="380" cy="280" r="5" fill="#4DA374" />
              <circle cx="540" cy="160" r="5" fill="#FFCC00" />
            </g>
            <g fill="#94a3b8" fontSize="11" fontFamily="IBM Plex Mono">
              <text x="138" y="318">DLA Prime</text>
              <text x="498" y="198">Pacific Hub</text>
              <text x="296" y="338">South Hub</text>
              <text x="676" y="268">BAS Steel</text>
              <text x="638" y="88">North Hub</text>
            </g>
          </svg>
        </div>

        <div className="col-span-4 row-span-5 bg-bg2 border border-edge p-[1.5vh_1vw] flex flex-col">
          <div className="font-mono text-[0.85vw] text-amber tracking-widest uppercase mb-[1.5vh]">Alerts &mdash; live feed</div>
          <div className="space-y-[1.2vh] font-mono text-[0.95vw] flex-1">
            <div className="flex items-baseline gap-[0.6vw]"><span className="text-amber">[WARN]</span> <span className="text-text">BAS Steel &middot; alcohol pads &middot; DOS 6.6d</span></div>
            <div className="flex items-baseline gap-[0.6vw]"><span className="text-amber">[WARN]</span> <span className="text-text">BAS Copper &middot; gloves &middot; DOS 6.6d</span></div>
            <div className="flex items-baseline gap-[0.6vw]"><span className="text-cyan">[WATCH]</span> <span className="text-text">BAS Steel &middot; labels &middot; DOS 8.1d</span></div>
            <div className="flex items-baseline gap-[0.6vw]"><span className="text-cyan">[WATCH]</span> <span className="text-text">BAS Copper &middot; tubes &middot; DOS 8.4d</span></div>
            <div className="flex items-baseline gap-[0.6vw]"><span className="text-cyan">[WATCH]</span> <span className="text-text">BAS Iron &middot; tourniquet &middot; DOS 9.2d</span></div>
            <div className="flex items-baseline gap-[0.6vw]"><span className="text-cyan">[WATCH]</span> <span className="text-text">BAS Zinc &middot; bags &middot; DOS 9.7d</span></div>
            <div className="flex items-baseline gap-[0.6vw]"><span className="text-cyan">[WATCH]</span> <span className="text-text">MTF Foxtrot &middot; gauze &middot; DOS 11.3d</span></div>
          </div>
          <div className="font-mono text-[0.8vw] text-muted mt-[1.5vh] tracking-widest uppercase">Refreshes every 5s &middot; click to acknowledge</div>
        </div>
      </div>
    </div>
  );
}
