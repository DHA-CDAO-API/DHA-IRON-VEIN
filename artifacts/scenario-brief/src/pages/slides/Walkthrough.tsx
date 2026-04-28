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
          Scenario: PRC Contingency &mdash; First Island Chain &mdash; 30 day horizon.
        </h2>
        <div className="font-mono text-[1vw] text-muted mt-[1vh]">
          Whole blood, PRBC, FFP &amp; cold-chain consumables across Okinawa, Luzon, Guam &amp; Darwin under disrupted SLOC.
        </div>
      </div>

      <div className="absolute left-[5vw] top-[34vh] right-[5vw] bottom-[6vh] grid grid-cols-12 gap-[1.5vw]">
        <div className="col-span-8 bg-bg2 border border-edge p-[2vh_1.5vw] flex flex-col">
          <div className="flex items-center justify-between mb-[1.5vh]">
            <div className="font-mono text-[0.9vw] text-cyan tracking-widest uppercase">Aggregate blood-product DOS &mdash; baseline vs scenario</div>
            <div className="font-mono text-[0.9vw] text-muted">days remaining</div>
          </div>
          <svg viewBox="0 0 800 280" className="w-full flex-1">
            <g stroke="#2A1D22" strokeWidth="1">
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
            <path d="M 60 65 L 130 67 L 200 70 L 270 72 L 340 75 L 410 78 L 480 80 L 550 82 L 620 84 L 690 86 L 760 88" stroke="#FFCC00" strokeWidth="2" fill="none" />
            <path d="M 60 65 L 130 80 L 200 130 L 270 175 L 340 205 L 410 195 L 480 175 L 550 150 L 620 130 L 690 115 L 760 105" stroke="#BA0C2F" strokeWidth="2.5" fill="none" />
            <line x1="200" y1="40" x2="200" y2="240" stroke="#BA0C2F" strokeWidth="1" strokeDasharray="3 3" />
            <text x="206" y="48" fill="#BA0C2F" fontSize="11" fontFamily="IBM Plex Mono">D5 PLA missile salvo &middot; SLOC closed</text>
            <line x1="410" y1="40" x2="410" y2="240" stroke="#4DA374" strokeWidth="1" strokeDasharray="3 3" />
            <text x="416" y="48" fill="#4DA374" fontSize="11" fontFamily="IBM Plex Mono">D14 ROLO push &amp; FDP airlift</text>
          </svg>
          <div className="flex items-center gap-[2vw] font-mono text-[0.9vw] text-muted mt-[1vh]">
            <span className="flex items-center gap-[0.5vw]"><span className="w-[1.5vw] h-[2px] bg-amber inline-block" /> Baseline (peacetime)</span>
            <span className="flex items-center gap-[0.5vw]"><span className="w-[1.5vw] h-[2px] bg-cyan inline-block" /> PRC contingency w/ recommendations</span>
          </div>
        </div>

        <div className="col-span-4 flex flex-col gap-[1vh]">
          <div className="bg-bg2 border border-edge p-[1.2vh_1vw]">
            <div className="font-mono text-[0.8vw] text-muted uppercase tracking-widest">Risk delta</div>
            <div className="font-display font-bold text-[2vw] text-rose mt-[0.4vh] leading-none">+58</div>
          </div>
          <div className="bg-bg2 border border-edge p-[1.2vh_1vw]">
            <div className="font-mono text-[0.8vw] text-muted uppercase tracking-widest">Peak whole-blood backorder</div>
            <div className="font-display font-bold text-[2vw] text-amber mt-[0.4vh] leading-none">1,840u</div>
          </div>
          <div className="bg-bg2 border border-edge p-[1.2vh_1vw]">
            <div className="font-mono text-[0.8vw] text-muted uppercase tracking-widest">MTFs going critical</div>
            <div className="font-display font-bold text-[2vw] text-amber mt-[0.4vh] leading-none">7</div>
          </div>
          <div className="bg-bg2 border border-edge p-[1.5vh_1vw] flex-1">
            <div className="font-mono text-[0.8vw] text-cyan uppercase tracking-widest mb-[1vh]">Top recommendation</div>
            <div className="font-body text-[1.05vw] text-text leading-snug">PUSH 320u Whole Blood LTOW O+ &rarr; MTF Oscar (Okinawa) via FDP backfill from Tripler</div>
            <div className="font-mono text-[0.85vw] text-muted mt-[1vh]">Expected risk reduction: 41 pts</div>
            <div className="font-mono text-[0.85vw] text-muted">Lead time: 36h &middot; route: KC-130 + cold-chain logger</div>
          </div>
        </div>
      </div>
    </div>
  );
}
