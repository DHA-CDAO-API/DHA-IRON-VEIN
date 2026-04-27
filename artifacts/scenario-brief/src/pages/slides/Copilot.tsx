export default function Copilot() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg">
      <div className="absolute inset-0 grid-bg opacity-40" />

      <div className="absolute top-[6vh] left-[5vw] right-[5vw] flex items-center justify-between">
        <span className="font-mono text-[1vw] text-amber tracking-[0.4em] uppercase">Section 07 // AI Co-Pilot</span>
        <span className="font-mono text-[0.9vw] text-muted">10 / 14</span>
      </div>

      <div className="absolute left-[5vw] top-[14vh] right-[5vw]">
        <h2 className="font-display font-bold text-[3.4vw] leading-[1.05] tracking-tight text-text max-w-[80vw]" style={{ textWrap: "balance" }}>
          Two providers. <span className="text-amber">One contract.</span> Switchable at runtime.
        </h2>
      </div>

      <div className="absolute left-[5vw] top-[32vh] right-[5vw] bottom-[6vh] grid grid-cols-12 gap-[1.5vw]">
        <div className="col-span-7 bg-bg2 border border-edge flex flex-col">
          <div className="border-b border-edge px-[1.2vw] py-[1.2vh] flex items-center justify-between">
            <div className="font-mono text-[0.9vw] text-cyan tracking-widest uppercase">Co-Pilot &mdash; conversation</div>
            <div className="flex items-center gap-[0.6vw] font-mono text-[0.85vw]">
              <span className="text-muted">Provider:</span>
              <span className="text-amber">openai &middot; gpt-5.4</span>
            </div>
          </div>
          <div className="flex-1 p-[1.5vh_1.2vw] space-y-[1.2vh] overflow-hidden">
            <div className="flex items-start gap-[0.8vw]">
              <span className="font-mono text-[0.8vw] text-amber uppercase tracking-widest mt-[0.4vh] shrink-0">User</span>
              <span className="font-body text-[1.05vw] text-text leading-snug">Why is BAS Steel red on the map?</span>
            </div>
            <div className="flex items-start gap-[0.8vw]">
              <span className="font-mono text-[0.8vw] text-cyan uppercase tracking-widest mt-[0.4vh] shrink-0">AI</span>
              <span className="font-body text-[1.05vw] text-text leading-snug">
                BAS Steel currently holds 6.6 days of supply on alcohol pads and labels &mdash; both below the 7-day warning threshold.
                Demand at the site is running 1.4x baseline under the current operational state. Two open watch alerts and one warning are tied to this node.
              </span>
            </div>
            <div className="flex items-start gap-[0.8vw]">
              <span className="font-mono text-[0.8vw] text-amber uppercase tracking-widest mt-[0.4vh] shrink-0">User</span>
              <span className="font-body text-[1.05vw] text-text leading-snug">Recommend orders for the next 7 days.</span>
            </div>
            <div className="flex items-start gap-[0.8vw]">
              <span className="font-mono text-[0.8vw] text-cyan uppercase tracking-widest mt-[0.4vh] shrink-0">AI</span>
              <span className="font-body text-[1.05vw] text-text leading-snug">
                Top three: 4,123u alcohol pads to BAS Copper (risk &minus;32), 2,790u labels to BAS Steel (risk &minus;32), 3,916u gloves to BAS Copper (risk &minus;30).
                I have draft POs ready &mdash; review and promote in the Orders board.
              </span>
            </div>
          </div>
        </div>

        <div className="col-span-5 flex flex-col gap-[1.5vh]">
          <div className="bg-bg2 border border-edge p-[1.5vh_1.2vw]">
            <div className="font-mono text-[0.85vw] text-amber tracking-widest uppercase">Provider abstraction</div>
            <div className="font-body text-[1.05vw] text-text mt-[0.8vh] leading-snug">Single interface; OpenAI gpt-5.4 and Anthropic claude-sonnet-4-6 are first-class. Failover and side-by-side compare are wired in.</div>
          </div>
          <div className="bg-bg2 border border-edge p-[1.5vh_1.2vw]">
            <div className="font-mono text-[0.85vw] text-amber tracking-widest uppercase">Streaming</div>
            <div className="font-body text-[1.05vw] text-text mt-[0.8vh] leading-snug">Server-sent events keep the UI responsive; no waiting for full completions.</div>
          </div>
          <div className="bg-bg2 border border-edge p-[1.5vh_1.2vw]">
            <div className="font-mono text-[0.85vw] text-amber tracking-widest uppercase">Grounded</div>
            <div className="font-body text-[1.05vw] text-text mt-[0.8vh] leading-snug">Every prompt is hydrated with the live snapshot &mdash; risk by node, open alerts, in-flight shipments. No hallucinated stockouts.</div>
          </div>
          <div className="bg-bg2 border border-edge p-[1.5vh_1.2vw]">
            <div className="font-mono text-[0.85vw] text-amber tracking-widest uppercase">Tool calls</div>
            <div className="font-body text-[1.05vw] text-text mt-[0.8vh] leading-snug">runScenario, getRecommendations, promoteToOrder &mdash; the co-pilot can act, not just answer.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
