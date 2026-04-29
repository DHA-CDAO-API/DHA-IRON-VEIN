import coverage from "@/data/coverage.json";

export default function Stakes() {
  const { network } = coverage;

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg">
      <div className="absolute inset-0 grid-bg opacity-40" />

      <div className="absolute top-[6vh] left-[5vw] right-[5vw] flex items-center justify-between">
        <span className="font-mono text-[1.2vw] text-amber tracking-[0.4em] uppercase">
          Section 01 // The Stakes
        </span>
        <span className="font-mono text-[1.05vw] text-muted">02 / 03</span>
      </div>

      <div className="absolute left-[5vw] top-[14vh] right-[5vw]">
        <h2 className="font-display font-bold text-[3.6vw] leading-[1.05] tracking-tight text-text max-w-[90vw]">
          Six INDOPACOM failure modes.
          <span className="text-amber"> Today, the chain fails three days before we see it.</span>
        </h2>
      </div>

      <div className="absolute left-[5vw] right-[5vw] top-[33vh] bottom-[25vh]">
        <div className="grid grid-cols-6 gap-[0.9vw] h-full">

          <div className="bg-bg2 border-t-4 border-rose p-[1.6vh_1.1vw]">
            <div className="font-mono text-[1vw] text-rose tracking-widest uppercase">
              Tier 1 &middot; PRC
            </div>
            <div className="font-display font-bold text-[1.75vw] text-text mt-[0.6vh] leading-tight">
              Taiwan Strait
            </div>
            <div className="font-body text-[1.15vw] text-text/85 leading-snug mt-[1.2vh]">
              PLA blockade &amp; amphib &middot; First Island Chain on fire &middot; Class VIII to MTFs in Taipei, Okinawa, Iwakuni.
            </div>
            <div className="font-mono text-[1vw] text-rose mt-[1.2vh] tracking-wide">
              30+ day fight &middot; LTOWB / FDP 2.5&times;
            </div>
          </div>

          <div className="bg-bg2 border-t-4 border-rose p-[1.6vh_1.1vw]">
            <div className="font-mono text-[1vw] text-rose tracking-widest uppercase">
              Tier 1 &middot; PRC
            </div>
            <div className="font-display font-bold text-[1.75vw] text-text mt-[0.6vh] leading-tight">
              Missile Strike on Hubs
            </div>
            <div className="font-body text-[1.15vw] text-text/85 leading-snug mt-[1.2vh]">
              DF-26 / cruise on Guam, Andersen, Yokosuka &middot; cold-storage destroyed &middot; reagents sole-source.
            </div>
            <div className="font-mono text-[1vw] text-rose mt-[1.2vh] tracking-wide">
              PRBC, plasma, platelets condemned
            </div>
          </div>

          <div className="bg-bg2 border-t-4 border-orange p-[1.6vh_1.1vw]">
            <div className="font-mono text-[1vw] text-orange tracking-widest uppercase">
              Tier 2 &middot; DPRK
            </div>
            <div className="font-display font-bold text-[1.75vw] text-text mt-[0.6vh] leading-tight">
              Korean Peninsula Flare-up
            </div>
            <div className="font-body text-[1.15vw] text-text/85 leading-snug mt-[1.2vh]">
              DPRK arty / SRBM on Seoul &middot; ROK trauma surge &middot; NEO from Yongsan / Osan.
            </div>
            <div className="font-mono text-[1vw] text-rose mt-[1.2vh] tracking-wide">
              MASCAL + NEO &middot; 14&ndash;30 days
            </div>
          </div>

          <div className="bg-bg2 border-t-4 border-cyan p-[1.6vh_1.1vw]">
            <div className="font-mono text-[1vw] text-cyan tracking-widest uppercase">
              Tier 2 &middot; Forward
            </div>
            <div className="font-display font-bold text-[1.75vw] text-text mt-[0.6vh] leading-tight">
              EABO Stand-In Fight
            </div>
            <div className="font-body text-[1.15vw] text-text/85 leading-snug mt-[1.2vh]">
              {network.bas} BAS sites ({network.basNames.join(", ")}) inside the WEZ &middot; resupply by RHIB / V-22 only.
            </div>
            <div className="font-mono text-[1vw] text-rose mt-[1.2vh] tracking-wide">
              No cold-storage &middot; thin lift &middot; no margin
            </div>
          </div>

          <div className="bg-bg2 border-t-4 border-amber p-[1.6vh_1.1vw]">
            <div className="font-mono text-[1vw] text-amber tracking-widest uppercase">
              Tier 2 &middot; Cyber
            </div>
            <div className="font-display font-bold text-[1.75vw] text-text mt-[0.6vh] leading-tight">
              Cable Cut + Cyber
            </div>
            <div className="font-body text-[1.15vw] text-text/85 leading-snug mt-[1.2vh]">
              PRC subsea cable severance &middot; EHR / DMLSS reachback lost &middot; ordering reverts to email.
            </div>
            <div className="font-mono text-[1vw] text-rose mt-[1.2vh] tracking-wide">
              Visibility lost &middot; over-order &amp; waste
            </div>
          </div>

          <div className="bg-bg2 border-t-4 border-teal p-[1.6vh_1.1vw]">
            <div className="font-mono text-[1vw] text-teal tracking-widest uppercase">
              Tier 3 &middot; HADR
            </div>
            <div className="font-display font-bold text-[1.75vw] text-text mt-[0.6vh] leading-tight">
              Super Typhoon
            </div>
            <div className="font-body text-[1.15vw] text-text/85 leading-snug mt-[1.2vh]">
              Cat-5 landfall PH / JP / Guam &middot; cold-chain power loss &middot; concurrent host-nation MEDEVAC support.
            </div>
            <div className="font-mono text-[1vw] text-rose mt-[1.2vh] tracking-wide">
              72h surge &middot; insulin / IV / O&#8322; spike
            </div>
          </div>
        </div>

        <div className="mt-[1.8vh] flex items-center gap-[1.5vw]">
          <span className="font-mono text-[1vw] text-muted tracking-widest uppercase">
            Severity
          </span>
          <div className="flex-1 h-[2px] bg-gradient-to-r from-rose via-amber to-teal" />
          <span className="font-mono text-[1vw] text-muted tracking-widest uppercase">
            PRC kinetic &rarr; regional crisis &rarr; HADR
          </span>
        </div>
      </div>

      <div className="absolute bottom-[5vh] left-[5vw] right-[5vw]">
        <div className="border border-rose/40 bg-bg2/80 px-[1.6vw] py-[1.8vh] flex items-center justify-between gap-[1.5vw]">
          <div className="flex-1">
            <div className="font-mono text-[1vw] text-rose tracking-widest uppercase">
              Today's reality
            </div>
            <div className="font-display font-bold text-[1.7vw] text-text mt-[0.4vh] leading-tight">
              Spreadsheets <span className="text-muted">&middot;</span> phone trees <span className="text-muted">&middot;</span> batched reports <span className="text-muted">&middot;</span>
              <span className="text-rose"> 72-hour visibility lag</span>
            </div>
          </div>
          <div className="font-mono text-[1.15vw] text-amber whitespace-nowrap">
            By the time we see the gap &rarr; the gap is 3 days deep.
          </div>
        </div>
      </div>
    </div>
  );
}
