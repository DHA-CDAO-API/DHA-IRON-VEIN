export default function Title() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg">
      <div className="absolute inset-0 grid-bg" />
      <div className="absolute inset-0 bg-gradient-to-br from-bg via-bg to-bg2" />

      <div className="absolute top-0 left-0 right-0 h-[8vh] flex items-center justify-between px-[5vw] border-b border-edge">
        <div className="flex items-center gap-[1.5vw]">
          <div className="w-[1.6vw] h-[1.6vw] bg-amber" />
          <span className="font-mono text-[1.2vw] tracking-[0.4em] text-muted uppercase">
            Defense Health Agency &middot; INDOPACOM &middot; Class&nbsp;VIII
          </span>
        </div>
        <span className="font-mono text-[1.2vw] text-muted">
          UNCLASSIFIED // FOR DEMONSTRATION
        </span>
      </div>

      <div className="absolute left-[5vw] top-[14vh] right-[5vw]">
        <div className="flex items-center gap-[1.4vw] mb-[2.2vh]">
          <span className="font-mono text-[1.3vw] text-amber tracking-[0.4em] uppercase">
            Modern Marine Hackathon &middot; Leadership Brief
          </span>
          <span className="bg-amber text-bg font-mono text-[1.05vw] tracking-[0.3em] uppercase font-bold px-[1vw] py-[0.5vh]">
            AI-Driven
          </span>
        </div>

        <div className="flex items-baseline gap-[1.5vw] mb-[1.8vh]">
          <h1 className="font-display font-bold text-[9vw] leading-[0.95] tracking-tight text-text">
            DHA
          </h1>
          <span className="font-display font-bold text-[9vw] leading-[0.95] tracking-tight text-amber">
            Iron Vein
          </span>
        </div>

        <div className="font-mono text-[1.35vw] text-muted/90 tracking-[0.18em] uppercase mb-[3.2vh] max-w-[88vw]">
          <span className="text-amber">I</span>NDOPACOM <span className="text-amber">R</span>esilient <span className="text-amber">O</span>perational <span className="text-amber">N</span>etwork for <span className="text-amber">V</span>ital <span className="text-amber">E</span>xpeditionary <span className="text-amber">I</span>nventory <span className="text-amber">N</span>odes
        </div>

        <div className="font-display font-medium text-[3vw] leading-[1.1] text-text/90 max-w-[84vw] mb-[5vh]">
          <span className="text-amber">AI-driven</span> predictive medical sustainment for
          <span className="text-amber"> contested INDOPACOM operations.</span>
        </div>

        <div className="grid grid-cols-4 gap-[1.5vw]">
          <div className="border-l-2 border-amber pl-[1vw]">
            <div className="font-mono text-[1.05vw] text-amber uppercase tracking-widest">
              Observe
            </div>
            <div className="font-display font-semibold text-[1.85vw] text-text mt-[0.5vh] leading-tight">
              Live theater picture
            </div>
          </div>
          <div className="border-l-2 border-amber pl-[1vw]">
            <div className="font-mono text-[1.05vw] text-amber uppercase tracking-widest">
              Orient
            </div>
            <div className="font-display font-semibold text-[1.85vw] text-text mt-[0.5vh] leading-tight">
              AI-powered scenario rehearsal
            </div>
          </div>
          <div className="border-l-2 border-amber pl-[1vw]">
            <div className="font-mono text-[1.05vw] text-amber uppercase tracking-widest">
              Decide
            </div>
            <div className="font-display font-semibold text-[1.85vw] text-text mt-[0.5vh] leading-tight">
              AI-drafted POs &amp; reroutes
            </div>
          </div>
          <div className="border-l-2 border-amber pl-[1vw]">
            <div className="font-mono text-[1.05vw] text-amber uppercase tracking-widest">
              Act
            </div>
            <div className="font-display font-semibold text-[1.85vw] text-text mt-[0.5vh] leading-tight">
              One click to push to Purchase Order
            </div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-[4vh] left-[5vw] right-[5vw] flex items-end justify-between">
        <div className="font-mono text-[1.2vw] text-muted">
          USMC &middot; INDOPACOM &middot; DHA Senior Leadership
          <span className="text-edge"> | </span>
          90s opener &rarr; live demo
        </div>
        <div className="font-mono text-[1.05vw] text-muted">01 / 03</div>
      </div>
    </div>
  );
}
