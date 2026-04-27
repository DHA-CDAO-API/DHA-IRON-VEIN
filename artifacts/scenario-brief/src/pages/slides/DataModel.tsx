export default function DataModel() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg">
      <div className="absolute inset-0 grid-bg opacity-40" />

      <div className="absolute top-[6vh] left-[5vw] right-[5vw] flex items-center justify-between">
        <span className="font-mono text-[1vw] text-amber tracking-[0.4em] uppercase">Section 03 // Data Model</span>
        <span className="font-mono text-[0.9vw] text-muted">05 / 14</span>
      </div>

      <div className="absolute top-[14vh] left-[5vw] right-[5vw]">
        <h2 className="font-display font-bold text-[3.4vw] leading-[1.1] tracking-tight text-text max-w-[70vw]" style={{ textWrap: "balance" }}>
          14 typed entities. One source of truth.
          <span className="text-cyan"> DMLSS-compatible by design.</span>
        </h2>
      </div>

      <div className="absolute left-[5vw] top-[36vh] right-[5vw] grid grid-cols-3 gap-[2vw]">
        <div>
          <div className="font-mono text-[0.95vw] text-amber tracking-widest uppercase mb-[1.5vh]">Catalog &amp; Identity</div>
          <div className="font-mono text-[1.15vw] text-text leading-[2.4]">
            <div>catalog_items</div>
            <div>items</div>
            <div>nodes</div>
            <div>routes</div>
            <div>suppliers</div>
            <div>site_crosswalk</div>
          </div>
        </div>
        <div>
          <div className="font-mono text-[0.95vw] text-amber tracking-widest uppercase mb-[1.5vh]">Operations</div>
          <div className="font-mono text-[1.15vw] text-text leading-[2.4]">
            <div>inventory_balances</div>
            <div>demand_profiles</div>
            <div>operational_states</div>
            <div>orders</div>
            <div>order_lines</div>
            <div>shipments</div>
          </div>
        </div>
        <div>
          <div className="font-mono text-[0.95vw] text-amber tracking-widest uppercase mb-[1.5vh]">Decision Layer</div>
          <div className="font-mono text-[1.15vw] text-text leading-[2.4]">
            <div>scenarios</div>
            <div>scenario_events</div>
            <div>recommendations</div>
            <div>alerts</div>
            <div>conversations</div>
            <div>activity_log</div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-[6vh] left-[5vw] right-[5vw] flex items-center gap-[2vw] font-mono text-[1vw] text-muted">
        <span>PostgreSQL + Drizzle ORM</span>
        <span className="text-edge">/</span>
        <span>OpenAPI single source of truth</span>
        <span className="text-edge">/</span>
        <span>Codegen &rarr; React Query hooks</span>
        <span className="text-edge">/</span>
        <span>Idempotent seed pipeline</span>
      </div>
    </div>
  );
}
