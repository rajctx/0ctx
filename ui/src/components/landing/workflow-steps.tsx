"use client";

import { useEffect, useRef, useState } from "react";

const steps = [
  {
    id: "install",
    num: "01",
    name: "Install",
    cmd: "npm i -g @0ctx/cli",
    desc: "Install the CLI globally. One command, nothing else to configure. Works on macOS, Linux, and WSL.",
  },
  {
    id: "enable",
    num: "02",
    name: "Enable",
    cmd: "0ctx enable",
    desc: "Run inside any repo. A local daemon starts, binds the workspace, and begins capturing automatically.",
  },
  {
    id: "work",
    num: "03",
    name: "Work",
    desc: "Use any AI tool \u2014 Claude Code, Cursor, Copilot. 0ctx captures sessions, decisions, and context in the background.",
  },
  {
    id: "recall",
    num: "04",
    name: "Recall",
    desc: "Switch tools or come back tomorrow. New sessions inherit full project memory via MCP. Zero context loss.",
  },
];

/* ── Isometric illustrations per step ── */
function InstallViz() {
  return (
    <svg viewBox="0 0 280 240" fill="none" className="wf-viz-svg">
      {/* Base platform */}
      <path d="M140 180L260 120V160L140 220L20 160V120L140 180Z" fill="rgba(249,115,22,0.04)" stroke="rgba(249,115,22,0.15)" strokeWidth="1" />
      <path d="M140 180L260 120L140 60L20 120L140 180Z" fill="rgba(249,115,22,0.06)" stroke="rgba(249,115,22,0.2)" strokeWidth="1" />
      {/* Cube on platform */}
      <path d="M140 90L200 120V155L140 185L80 155V120L140 90Z" fill="rgba(249,115,22,0.08)" stroke="rgba(249,115,22,0.3)" strokeWidth="1.2" />
      <path d="M140 90L200 120L140 150L80 120L140 90Z" fill="rgba(249,115,22,0.12)" stroke="rgba(249,115,22,0.25)" strokeWidth="1" />
      <path d="M140 150V185" stroke="rgba(249,115,22,0.2)" strokeWidth="1" />
      <path d="M200 120V155" stroke="rgba(249,115,22,0.2)" strokeWidth="1" />
      {/* Download arrow */}
      <path d="M140 55V115" stroke="#f97316" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M128 103L140 115L152 103" stroke="#f97316" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* Small floating package boxes */}
      <rect x="42" y="70" width="20" height="20" rx="3" stroke="rgba(249,115,22,0.2)" strokeWidth="1" fill="rgba(249,115,22,0.03)" transform="rotate(-10 52 80)" />
      <rect x="220" y="65" width="16" height="16" rx="2" stroke="rgba(249,115,22,0.15)" strokeWidth="1" fill="rgba(249,115,22,0.02)" transform="rotate(8 228 73)" />
    </svg>
  );
}

function EnableViz() {
  return (
    <svg viewBox="0 0 280 240" fill="none" className="wf-viz-svg">
      {/* Base platform */}
      <path d="M140 180L260 120V160L140 220L20 160V120L140 180Z" fill="rgba(74,222,128,0.04)" stroke="rgba(74,222,128,0.15)" strokeWidth="1" />
      <path d="M140 180L260 120L140 60L20 120L140 180Z" fill="rgba(74,222,128,0.06)" stroke="rgba(74,222,128,0.2)" strokeWidth="1" />
      {/* Server / daemon block */}
      <path d="M140 80L210 115V160L140 195L70 160V115L140 80Z" fill="rgba(74,222,128,0.06)" stroke="rgba(74,222,128,0.25)" strokeWidth="1.2" />
      <path d="M140 80L210 115L140 150L70 115L140 80Z" fill="rgba(74,222,128,0.1)" stroke="rgba(74,222,128,0.2)" strokeWidth="1" />
      <path d="M140 150V195" stroke="rgba(74,222,128,0.2)" strokeWidth="1" />
      <path d="M210 115V160" stroke="rgba(74,222,128,0.2)" strokeWidth="1" />
      {/* Power circle */}
      <circle cx="140" cy="115" r="20" stroke="#4ade80" strokeWidth="2" fill="none" opacity="0.8" />
      <path d="M140 98V115" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" />
      {/* Radiating lines */}
      <path d="M140 70V56" stroke="rgba(74,222,128,0.3)" strokeWidth="1" strokeLinecap="round" strokeDasharray="2 3" />
      <path d="M165 78L175 66" stroke="rgba(74,222,128,0.25)" strokeWidth="1" strokeLinecap="round" strokeDasharray="2 3" />
      <path d="M115 78L105 66" stroke="rgba(74,222,128,0.25)" strokeWidth="1" strokeLinecap="round" strokeDasharray="2 3" />
      {/* Status dot */}
      <circle cx="140" cy="48" r="3" fill="#4ade80" opacity="0.6" />
    </svg>
  );
}

function WorkViz() {
  return (
    <svg viewBox="0 0 280 240" fill="none" className="wf-viz-svg">
      {/* Base platform */}
      <path d="M140 190L260 130V170L140 230L20 170V130L140 190Z" fill="rgba(96,165,250,0.04)" stroke="rgba(96,165,250,0.15)" strokeWidth="1" />
      <path d="M140 190L260 130L140 70L20 130L140 190Z" fill="rgba(96,165,250,0.06)" stroke="rgba(96,165,250,0.2)" strokeWidth="1" />
      {/* Three layered screens / editors */}
      {/* Back screen */}
      <rect x="85" y="30" width="110" height="75" rx="4" fill="rgba(96,165,250,0.04)" stroke="rgba(96,165,250,0.15)" strokeWidth="1" />
      <line x1="85" y1="42" x2="195" y2="42" stroke="rgba(96,165,250,0.1)" strokeWidth="1" />
      <circle cx="93" cy="36" r="2" fill="rgba(96,165,250,0.2)" />
      <circle cx="100" cy="36" r="2" fill="rgba(96,165,250,0.2)" />
      <circle cx="107" cy="36" r="2" fill="rgba(96,165,250,0.2)" />
      {/* Code lines in screen */}
      <line x1="95" y1="52" x2="135" y2="52" stroke="rgba(96,165,250,0.2)" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="95" y1="60" x2="155" y2="60" stroke="rgba(96,165,250,0.15)" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="105" y1="68" x2="145" y2="68" stroke="rgba(96,165,250,0.12)" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="95" y1="76" x2="130" y2="76" stroke="rgba(96,165,250,0.15)" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="105" y1="84" x2="165" y2="84" stroke="rgba(96,165,250,0.1)" strokeWidth="1.5" strokeLinecap="round" />
      {/* Capture arrows flowing down into platform */}
      <path d="M110 105V140" stroke="#60a5fa" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="3 4" />
      <path d="M140 105V145" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" />
      <path d="M170 105V140" stroke="#60a5fa" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="3 4" />
      <path d="M132 137L140 145L148 137" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {/* Tool labels */}
      <text x="46" y="55" fill="rgba(96,165,250,0.3)" fontSize="8" fontFamily="monospace">Claude</text>
      <text x="200" y="50" fill="rgba(96,165,250,0.3)" fontSize="8" fontFamily="monospace">Cursor</text>
      <text x="205" y="85" fill="rgba(96,165,250,0.25)" fontSize="8" fontFamily="monospace">Copilot</text>
    </svg>
  );
}

function RecallViz() {
  return (
    <svg viewBox="0 0 280 240" fill="none" className="wf-viz-svg">
      {/* Base platform */}
      <path d="M140 190L260 130V170L140 230L20 170V130L140 190Z" fill="rgba(192,132,252,0.04)" stroke="rgba(192,132,252,0.15)" strokeWidth="1" />
      <path d="M140 190L260 130L140 70L20 130L140 190Z" fill="rgba(192,132,252,0.06)" stroke="rgba(192,132,252,0.2)" strokeWidth="1" />
      {/* Memory graph — nodes and edges */}
      <circle cx="140" cy="90" r="12" stroke="#c084fc" strokeWidth="1.8" fill="rgba(192,132,252,0.08)" />
      <circle cx="90" cy="55" r="8" stroke="rgba(192,132,252,0.5)" strokeWidth="1.2" fill="rgba(192,132,252,0.05)" />
      <circle cx="190" cy="55" r="8" stroke="rgba(192,132,252,0.5)" strokeWidth="1.2" fill="rgba(192,132,252,0.05)" />
      <circle cx="70" cy="100" r="6" stroke="rgba(192,132,252,0.4)" strokeWidth="1" fill="rgba(192,132,252,0.04)" />
      <circle cx="210" cy="100" r="6" stroke="rgba(192,132,252,0.4)" strokeWidth="1" fill="rgba(192,132,252,0.04)" />
      <circle cx="105" cy="130" r="5" stroke="rgba(192,132,252,0.3)" strokeWidth="1" fill="rgba(192,132,252,0.03)" />
      <circle cx="175" cy="130" r="5" stroke="rgba(192,132,252,0.3)" strokeWidth="1" fill="rgba(192,132,252,0.03)" />
      {/* Edges */}
      <line x1="130" y1="82" x2="96" y2="60" stroke="rgba(192,132,252,0.3)" strokeWidth="1" />
      <line x1="150" y1="82" x2="184" y2="60" stroke="rgba(192,132,252,0.3)" strokeWidth="1" />
      <line x1="130" y1="98" x2="75" y2="98" stroke="rgba(192,132,252,0.25)" strokeWidth="1" />
      <line x1="150" y1="98" x2="205" y2="98" stroke="rgba(192,132,252,0.25)" strokeWidth="1" />
      <line x1="134" y1="100" x2="109" y2="127" stroke="rgba(192,132,252,0.2)" strokeWidth="1" />
      <line x1="146" y1="100" x2="171" y2="127" stroke="rgba(192,132,252,0.2)" strokeWidth="1" />
      {/* Center recall arrow */}
      <path d="M128 90A14 14 0 0 1 152 90" stroke="#c084fc" strokeWidth="2" strokeLinecap="round" fill="none" />
      <path d="M152 84V90H146" stroke="#c084fc" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {/* Pulse rings */}
      <circle cx="140" cy="90" r="22" stroke="rgba(192,132,252,0.12)" strokeWidth="1" fill="none" />
      <circle cx="140" cy="90" r="34" stroke="rgba(192,132,252,0.06)" strokeWidth="1" fill="none" />
    </svg>
  );
}

const vizComponents = [InstallViz, EnableViz, WorkViz, RecallViz];
const accentColors = ["#f97316", "#4ade80", "#60a5fa", "#c084fc"];

export function WorkflowSteps() {
  const [activeIdx, setActiveIdx] = useState(0);
  const stepsRef = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const els = stepsRef.current.filter(Boolean) as HTMLDivElement[];
    if (!els.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the most visible entry
        let best: IntersectionObserverEntry | null = null;
        entries.forEach((e) => {
          if (e.isIntersecting && (!best || e.intersectionRatio > best.intersectionRatio)) {
            best = e;
          }
        });
        if (best) {
          const idx = els.indexOf(best.target as HTMLDivElement);
          if (idx !== -1) setActiveIdx(idx);
        }
      },
      { threshold: [0.3, 0.5, 0.7], rootMargin: "-10% 0px -30% 0px" }
    );

    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="wf-layout">
      {/* Left — sticky visualization panel */}
      <div className="wf-viz-panel">
        <div className="wf-viz-inner">
          {/* Dot grid background */}
          <svg className="wf-viz-grid" viewBox="0 0 200 200" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <pattern id="wfDots" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
                <circle cx="10" cy="10" r="0.8" fill="rgba(255,255,255,0.05)" />
              </pattern>
            </defs>
            <rect width="200" height="200" fill="url(#wfDots)" />
          </svg>

          {/* Stacked visualizations — opacity-swap */}
          {vizComponents.map((Viz, i) => (
            <div
              key={i}
              className="wf-viz-layer"
              style={{ opacity: activeIdx === i ? 1 : 0 }}
            >
              <Viz />
            </div>
          ))}

          {/* Step indicator dots */}
          <div className="wf-viz-dots">
            {steps.map((s, i) => (
              <div
                key={s.id}
                className="wf-viz-dot"
                style={{
                  background: activeIdx === i ? accentColors[i] : "rgba(255,255,255,0.1)",
                  boxShadow: activeIdx === i ? `0 0 12px ${accentColors[i]}40` : "none",
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Right — scrollable steps */}
      <div className="wf-steps-panel">
        {steps.map((s, i) => (
          <div
            key={s.id}
            ref={(el) => { stepsRef.current[i] = el; }}
            className={`wf-step-section ${activeIdx === i ? "wf-step-active" : ""}`}
          >
            <div className="wf-step-card" style={{
              borderColor: activeIdx === i ? `${accentColors[i]}25` : undefined,
            }}>
              <div className="wf-step-header">
                <span className="wf-step-num" style={{
                  color: activeIdx === i ? accentColors[i] : undefined,
                }}>{s.num}</span>
                <div
                  className="wf-step-indicator"
                  style={{ background: accentColors[i] }}
                />
              </div>
              <h3 className="wf-step-name">{s.name}</h3>
              {s.cmd && (
                <code className="wf-step-cmd">$ {s.cmd}</code>
              )}
              <p className="wf-step-desc">{s.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
