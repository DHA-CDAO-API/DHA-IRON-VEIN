export default function Decisions() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg">
      <div className="absolute inset-0 grid-bg opacity-40" />

      <div className="absolute top-[6vh] left-[5vw] right-[5vw] flex items-center justify-between">
        <span className="font-mono text-[1vw] text-amber tracking-[0.4em] uppercase">Section 08 // Decisions</span>
        <span className="font-mono text-[0.9vw] text-muted">11 / 14</span>
      </div>

      <div className="absolute left-[5vw] top-[14vh] right-[5vw]">
        <h2 className="font-display font-bold text-[3.4vw] leading-[1.05] tracking-tight text-text max-w-[80vw]" style={{ textWrap: "balance" }}>
          From recommendation to signed PO &mdash; one path.
        </h2>
      </div>

      <div className="absolute left-[5vw] top-[34vh] right-[5vw] bottom-[14vh] grid grid-cols-5 gap-[1vw] items-stretch">
        <div className="bg-bg2 border border-edge p-[2vh_1vw] flex flex-col">
          <div className="font-mono text-[0.85vw] text-amber tracking-widest uppercase">01</div>
          <div className="font-display font-bold text-[1.5vw] text-text mt-[1vh] leading-tight">Detect</div>
          <div className="font-body text-[0.95vw] text-muted mt-[1vh] leading-snug">Engine flags shortfall risk &mdash; alert opens with severity and lead-time context</div>
        </div>
        <div className="bg-bg2 border border-edge p-[2vh_1vw] flex flex-col">
          <div className="font-mono text-[0.85vw] text-amber tracking-widest uppercase">02</div>
          <div className="font-display font-bold text-[1.5vw] text-text mt-[1vh] leading-tight">Recommend</div>
          <div className="font-body text-[0.95vw] text-muted mt-[1vh] leading-snug">Ranked replenishment with quantity, supplier, and expected risk reduction</div>
        </div>
        <div className="bg-bg2 border border-edge p-[2vh_1vw] flex flex-col">
          <div className="font-mono text-[0.85vw] text-amber tracking-widest uppercase">03</div>
          <div className="font-display font-bold text-[1.5vw] text-text mt-[1vh] leading-tight">Promote</div>
          <div className="font-body text-[0.95vw] text-muted mt-[1vh] leading-snug">One click converts a recommendation into a draft purchase order with line items pre-filled</div>
        </div>
        <div className="bg-bg2 border border-edge p-[2vh_1vw] flex flex-col">
          <div className="font-mono text-[0.85vw] text-amber tracking-widest uppercase">04</div>
          <div className="font-display font-bold text-[1.5vw] text-text mt-[1vh] leading-tight">Track</div>
          <div className="font-body text-[0.95vw] text-muted mt-[1vh] leading-snug">Kanban board moves PO from Submitted &rarr; Acknowledged &rarr; In Transit &rarr; Received</div>
        </div>
        <div className="bg-bg2 border border-edge p-[2vh_1vw] flex flex-col">
          <div className="font-mono text-[0.85vw] text-amber tracking-widest uppercase">05</div>
          <div className="font-display font-bold text-[1.5vw] text-text mt-[1vh] leading-tight">Export</div>
          <div className="font-body text-[0.95vw] text-muted mt-[1vh] leading-snug">CSV, XLSX, and print-friendly PO renders for downstream DMLSS or contracting hand-off</div>
        </div>
      </div>

      <div className="absolute bottom-[6vh] left-[5vw] right-[5vw] font-mono text-[1vw] text-muted leading-relaxed">
        Every promotion writes to the activity log &mdash; full audit trail with user, role, timestamp, and the recommendation that produced it.
      </div>
    </div>
  );
}
