"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import "./landing.css";

export default function HomePage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Canvas Animation Logic
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width: number, height: number;
    let nodes: Node[] = [];
    const NODE_COUNT = 60;
    const CONNECTION_DISTANCE = 150;
    let animationId: number;

    function resize() {
      if (!canvas) return;
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width;
      canvas.height = height;
    }

    class Node {
      x: number;
      y: number;
      vx: number;
      vy: number;
      radius: number;

      constructor() {
        this.x = Math.random() * width;
        this.y = Math.random() * height;
        this.vx = (Math.random() - 0.5) * 0.5;
        this.vy = (Math.random() - 0.5) * 0.5;
        this.radius = Math.random() * 2 + 1;
      }

      update() {
        this.x += this.vx;
        this.y += this.vy;

        if (this.x < 0 || this.x > width) this.vx *= -1;
        if (this.y < 0 || this.y > height) this.vy *= -1;
      }

      draw() {
        if (!ctx) return;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(249, 115, 22, 0.8)";
        ctx.fill();
      }
    }

    function initCanvas() {
      resize();
      nodes = [];
      for (let i = 0; i < NODE_COUNT; i++) {
        nodes.push(new Node());
      }
      animate();
    }

    function animate() {
      if (!ctx || !canvas) return;
      ctx.clearRect(0, 0, width, height);

      ctx.lineWidth = 0.5;
      for (let i = 0; i < nodes.length; i++) {
        nodes[i].update();
        nodes[i].draw();

        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance < CONNECTION_DISTANCE) {
            ctx.beginPath();
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);

            const alpha = 1 - distance / CONNECTION_DISTANCE;
            ctx.strokeStyle = `rgba(249, 115, 22, ${alpha * 0.3})`;
            ctx.stroke();
          }
        }
      }

      if (Math.random() > 0.95) {
        ctx.strokeStyle = "rgba(249, 115, 22, 0.1)";
        ctx.beginPath();
        const rx = Math.random() * width;
        ctx.moveTo(rx, 0);
        ctx.lineTo(rx, height);
        ctx.stroke();
      }

      animationId = requestAnimationFrame(animate);
    }

    window.addEventListener("resize", resize);
    initCanvas();

    // Chart Animation Logic
    const chartContainer = chartContainerRef.current;
    let chartInterval: NodeJS.Timeout;

    if (chartContainer) {
      // Clear container in case of strict mode double run
      chartContainer.innerHTML = '';

      for (let i = 0; i < 20; i++) {
        const bar = document.createElement("div");
        bar.className = "chart-bar";
        bar.style.height = Math.random() * 100 + "%";
        chartContainer.appendChild(bar);
      }

      chartInterval = setInterval(() => {
        const bars = chartContainer.querySelectorAll(".chart-bar") as NodeListOf<HTMLElement>;
        bars.forEach((bar) => {
          if (Math.random() > 0.7) {
            bar.style.height = Math.random() * 100 + "%";
            bar.classList.toggle("active", Math.random() > 0.8);
          }
        });
      }, 500);
    }

    // Cleanup
    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animationId);
      if (chartInterval) clearInterval(chartInterval);
    };
  }, []);

  return (
    <div id="landing-page">
      <div id="noise-layer"></div>
      <canvas id="graph-canvas" ref={canvasRef}></canvas>

      <div className="container">
        <nav style={{ display: "flex", justifyContent: "space-between", padding: "2rem 0", borderBottom: "1px solid var(--dim-color)" }}>
          <div style={{ fontWeight: 700, letterSpacing: "-1px" }}>0CTX // MEMORY_ENGINE</div>
          <div style={{ display: "flex", gap: "2rem", fontSize: "0.8rem" }}>
            <Link href="/docs" style={{ color: "inherit", textDecoration: "none" }}>[DOCS]</Link>
            <Link href="/install" style={{ color: "inherit", textDecoration: "none" }}>[INSTALL]</Link>
            <a href="https://github.com/0ctx-com/0ctx" target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "none" }}>[GITHUB]</a>
          </div>
        </nav>

        <section className="hero section" style={{ borderBottom: "none" }}>
          <div id="fog-layer"></div>
          <div className="hero-content">
            <div className="hero-meta">
              <span>SYS.STATUS: ONLINE</span>
              <span>NODES: 4,092</span>
              <span>LATENCY: 12ms</span>
            </div>
            <h1>Total<br />Recall<br />For AI.</h1>
            <p className="hero-description">
              The persistent memory layer for autonomous agents.
              0ctx acts as a durable brain, storing project context in a traversable graph
              so agents can recover prior decisions, constraints, and workstream state across sessions.
            </p>
            <Link href="/install" className="btn">Open Install Guide</Link>
          </div>

          <div style={{ position: "absolute", bottom: "4rem", right: 0, width: "300px", textAlign: "right" }}>
            <div style={{ borderBottom: "1px solid var(--dim-color)", marginBottom: "0.5rem", fontSize: "0.7rem" }}>MEMORY_USAGE</div>
            <div className="chart-bar-container" id="hero-chart" ref={chartContainerRef}></div>
          </div>
        </section>

        <section className="section">
          <div className="ruler-x"></div>
          <div className="grid-2">
            <div>
              <h2>01 // THE PROBLEM <span className="coord">X:049 Y:201</span></h2>
              <p style={{ fontSize: "1.2rem", color: "var(--fg-color)" }}>
                LLMs are brilliant but amnesic.
              </p>
              <p>
                Every new session is a blank slate. Context windows are expensive and ephemeral.
                Critical architectural decisions, constraints, and user preferences are lost the moment the terminal closes.
              </p>
            </div>
            <div>
              <h2>02 // THE SOLUTION <span className="coord">X:092 Y:201</span></h2>
              <p style={{ fontSize: "1.2rem", color: "var(--fg-color)" }}>
                A connected knowledge graph.
              </p>
              <p>
                0ctx sits alongside your IDE and your AI. As a native MCP server, it exposes your project's historical context, constraints, and decisions. Agents dynamically query the graph via strict traversal to pull in relevant "memories" before generating a single token.
              </p>
              <div className="terminal">
                <div className="prompt">0ctx recall --query="auth system"</div>
                <div style={{ color: "var(--text-secondary)", marginTop: "0.5rem" }}>&gt; Retrieving nodes: [LocalNotes, Decisions, WorkstreamState]</div>
                <div style={{ color: "var(--text-secondary)" }}>&gt; Found constraint: "No 3rd party auth provider" (2023-09-12)</div>
                <div style={{ color: "var(--text-secondary)" }}>&gt; Context injected into prompt.</div>
                <div className="prompt"><span className="cursor"></span></div>
              </div>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="ruler-x"></div>
          <h2>SYSTEM MODULES <span className="coord">SEC:03</span></h2>
          <div className="grid-4" style={{ marginTop: "3rem" }}>
            <div className="feature-card">
              <div className="feature-icon" style={{ borderRadius: 0 }}>D</div>
              <h3 style={{ fontSize: "1rem", marginBottom: "1rem" }}>Background Daemon</h3>
              <p style={{ fontSize: "0.8rem", margin: 0 }}>
                Runs locally. Watches file changes and git commits to automatically update the knowledge graph in real-time.
              </p>
            </div>

            <div className="feature-card">
              <div className="feature-icon" style={{ borderRadius: 0 }}>C</div>
              <h3 style={{ fontSize: "1rem", marginBottom: "1rem" }}>CLI Integration</h3>
              <p style={{ fontSize: "0.8rem", margin: 0 }}>
                Repo-first enablement and automatic capture for the current GA path: Claude, Factory, and Antigravity.
              </p>
            </div>

            <div className="feature-card">
              <div className="feature-icon" style={{ borderRadius: "50%" }}>G</div>
              <h3 style={{ fontSize: "1rem", marginBottom: "1rem" }}>Queryable Memory</h3>
              <p style={{ fontSize: "0.8rem", margin: 0 }}>
                Traverse decisions, constraints, and artifacts without rebuilding context from scratch every session.
              </p>
            </div>

            <div className="feature-card">
              <div className="feature-icon" style={{ borderRadius: 0 }}>API</div>
              <h3 style={{ fontSize: "1rem", marginBottom: "1rem" }}>Semantic Search</h3>
              <p style={{ fontSize: "0.8rem", margin: 0 }}>
                "Why did we choose Postgres?" 0ctx retrieves the specific commit message and Slack discussion from 3 months ago.
              </p>
            </div>
          </div>
        </section>

        <section className="section" style={{ textAlign: "center", borderBottom: "none", padding: "10rem 0" }}>
          <h2 style={{ border: "none", justifyContent: "center", fontSize: "3rem", marginBottom: "1rem" }}>CURE AMNESIA</h2>
          <p style={{ margin: "0 auto", marginBottom: "3rem" }}>Start building with a permanent memory.</p>
          <div style={{ display: "flex", justifyContent: "center", gap: "1rem" }}>
            <Link href="/install" className="btn">Start Setup</Link>
            <Link href="/docs" className="btn" style={{ borderStyle: "dashed" }}>Read Docs</Link>
            <a href="https://github.com/0ctx-com/0ctx#manifesto" target="_blank" rel="noopener noreferrer" className="btn" style={{ borderStyle: "dashed" }}>Read The Manifesto</a>
          </div>
        </section>

        <footer>
          <div>
            <div style={{ fontWeight: "bold", marginBottom: "0.5rem" }}>0CTX LABS</div>
            <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>EST. 2024 // SF_CA</div>
          </div>
          <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textAlign: "right" }}>
            SYSTEM OPTIMAL<br />
            NO COOKIES DETECTED
          </div>
        </footer>
      </div>
    </div>
  );
}
