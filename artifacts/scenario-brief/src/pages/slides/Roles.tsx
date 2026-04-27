export default function Roles() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg">
      <div className="absolute inset-0 grid-bg opacity-40" />

      <div className="absolute top-[6vh] left-[5vw] right-[5vw] flex items-center justify-between">
        <span className="font-mono text-[1vw] text-amber tracking-[0.4em] uppercase">Section 09 // Roles</span>
        <span className="font-mono text-[0.9vw] text-muted">12 / 14</span>
      </div>

      <div className="absolute left-[5vw] top-[14vh] right-[5vw]">
        <h2 className="font-display font-bold text-[3.4vw] leading-[1.05] tracking-tight text-text max-w-[80vw]" style={{ textWrap: "balance" }}>
          Same data. Four lenses. One switcher.
        </h2>
      </div>

      <div className="absolute left-[5vw] top-[34vh] right-[5vw] grid grid-cols-4 gap-[1.5vw]">
        <div className="bg-bg2 border border-edge p-[2.5vh_1.5vw] flex flex-col gap-[1vh]">
          <div className="font-mono text-[0.85vw] text-amber tracking-widest uppercase">Role 01</div>
          <div className="font-display font-bold text-[1.8vw] text-text leading-tight">Commander</div>
          <div className="font-body text-[1.05vw] text-muted leading-snug">Theater overview, risk map, scenario console. The decision surface, not the spreadsheet.</div>
        </div>
        <div className="bg-bg2 border border-edge p-[2.5vh_1.5vw] flex flex-col gap-[1vh]">
          <div className="font-mono text-[0.85vw] text-amber tracking-widest uppercase">Role 02</div>
          <div className="font-display font-bold text-[1.8vw] text-text leading-tight">Logistician</div>
          <div className="font-body text-[1.05vw] text-muted leading-snug">Orders board, recommendations queue, supplier and route detail. The action surface.</div>
        </div>
        <div className="bg-bg2 border border-edge p-[2.5vh_1.5vw] flex flex-col gap-[1vh]">
          <div className="font-mono text-[0.85vw] text-amber tracking-widest uppercase">Role 03</div>
          <div className="font-display font-bold text-[1.8vw] text-text leading-tight">Medical Planner</div>
          <div className="font-body text-[1.05vw] text-muted leading-snug">Item criticality, MTF/BAS DOS by item, demand profiles. The clinical readiness lens.</div>
        </div>
        <div className="bg-bg2 border border-edge p-[2.5vh_1.5vw] flex flex-col gap-[1vh]">
          <div className="font-mono text-[0.85vw] text-amber tracking-widest uppercase">Role 04</div>
          <div className="font-display font-bold text-[1.8vw] text-text leading-tight">Analyst</div>
          <div className="font-body text-[1.05vw] text-muted leading-snug">Data admin, scenario library, model toggles, full export. The instrumentation lens.</div>
        </div>
      </div>

      <div className="absolute bottom-[6vh] left-[5vw] right-[5vw] font-mono text-[1vw] text-muted">
        Switching role is a single tap in the profile pane &mdash; the dashboard recomposes around what that role needs to see.
      </div>
    </div>
  );
}
