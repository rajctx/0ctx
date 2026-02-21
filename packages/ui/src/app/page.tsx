import { Terminal, Network, Shield, ArrowRight, Layers, Zap, Cpu } from 'lucide-react';

export default function Home() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      {/* Background Decorative Elements */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-indigo-600/20 blur-[120px] rounded-full mix-blend-screen pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-5%] w-[40%] h-[40%] bg-purple-600/20 blur-[100px] rounded-full mix-blend-screen pointer-events-none" />

      {/* Navigation */}
      <nav className="fixed top-0 w-full z-50 glass-panel border-b border-white/5 border-t-0 border-x-0">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Network className="text-white w-6 h-6" />
            </div>
            <span className="text-2xl font-bold tracking-tight">0ctx</span>
          </div>
          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-gray-300">
            <a href="#features" className="hover:text-white transition-colors">Features</a>
            <a href="#mcp" className="hover:text-white transition-colors">MCP Protocol</a>
            <a href="#security" className="hover:text-white transition-colors">Security</a>
          </div>
          <button className="px-5 py-2.5 rounded-full bg-white/10 hover:bg-white/15 border border-white/10 text-white font-medium text-sm transition-all hover:scale-105 active:scale-95">
            Documentation
          </button>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative pt-40 pb-20 px-6 max-w-7xl mx-auto flex flex-col items-center text-center z-10">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-panel border-indigo-500/30 text-indigo-300 text-sm font-medium mb-8 animate-slide-up">
          <Zap className="w-4 h-4 text-indigo-400" />
          <span>v1.0 is now available for local development</span>
        </div>

        <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight mb-6 animate-slide-up delay-100 max-w-4xl mx-auto leading-tight">
          Zero Context Loss. <br />
          <span className="gradient-text">For Everyone Who Uses AI.</span>
        </h1>

        <p className="text-lg md:text-xl text-gray-400 max-w-2xl mx-auto mb-12 animate-slide-up delay-200">
          The persistent, local-first, graph-based engine that holds the living state of your thinking — instantly available to every AI tool you use.
        </p>

        <div className="flex flex-col sm:flex-row items-center gap-4 animate-slide-up delay-300">
          <a href="/dashboard" className="px-8 py-4 rounded-full bg-indigo-600 text-white font-semibold flex items-center gap-2 hover:bg-indigo-500 transition-all shadow-[0_0_30px_-5px_rgba(99,102,241,0.5)]">
            Open Local Graph <ArrowRight className="w-4 h-4" />
          </a>
          <button className="px-8 py-4 rounded-full glass-panel font-semibold flex items-center gap-2 hover:bg-white/10 transition-all text-gray-200">
            <Terminal className="w-4 h-4" /> View Docs
          </button>
        </div>
      </section>

      {/* Dashboard Preview / Visualization */}
      <section className="px-6 max-w-6xl mx-auto mb-32 z-10 relative animate-slide-up delay-400">
        <div className="w-full aspect-video rounded-2xl glass-panel relative overflow-hidden group">
          {/* Header Bar */}
          <div className="absolute top-0 w-full h-12 border-b border-white/10 bg-black/40 flex items-center px-4 gap-2 z-20">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-red-500/80" />
              <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
              <div className="w-3 h-3 rounded-full bg-green-500/80" />
            </div>
            <div className="mx-auto px-4 py-1 rounded-md bg-white/5 text-xs text-gray-400 flex items-center gap-2 border border-white/5">
              <Network className="w-3 h-3" /> 0ctx local graph visualizer
            </div>
          </div>

          {/* Mock Graph Editor */}
          <div className="absolute inset-0 pt-12 flex relative">
            <div className="w-64 border-r border-white/5 bg-black/20 p-4">
              <div className="text-sm font-semibold text-gray-300 mb-4 px-2 tracking-wider uppercase text-xs">Active Workspaces</div>
              <div className="space-y-1">
                <div className="px-3 py-2 rounded-lg bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-sm font-medium flex items-center gap-2">
                  <Layers className="w-4 h-4" /> Project Acme
                </div>
                <div className="px-3 py-2 rounded-lg hover:bg-white/5 text-gray-400 text-sm font-medium transition-colors flex items-center gap-2 cursor-pointer">
                  <Layers className="w-4 h-4" /> System Architecture
                </div>
              </div>
            </div>
            <div className="flex-1 p-8 relative">
              {/* Nodes Mapping (Mock) */}
              <div className="absolute top-1/2 left-1/4 -translate-y-1/2 w-48 p-4 rounded-xl glass-panel border-indigo-500/30 text-sm z-10 hover:scale-105 transition-transform cursor-pointer">
                <span className="text-xs text-indigo-400 font-bold uppercase tracking-wider mb-1 block">Decision</span>
                Use Postgres for full-text search backend
              </div>

              <div className="absolute top-1/4 right-1/4 w-48 p-4 rounded-xl glass-panel border-red-500/30 text-sm z-10 hover:scale-105 transition-transform cursor-pointer">
                <span className="text-xs text-red-400 font-bold uppercase tracking-wider mb-1 block">Constraint</span>
                Latency must be under 50ms for typing
              </div>

              <div className="absolute bottom-1/4 right-1/3 w-48 p-4 rounded-xl glass-panel border-emerald-500/30 text-sm z-10 hover:scale-105 transition-transform cursor-pointer">
                <span className="text-xs text-emerald-400 font-bold uppercase tracking-wider mb-1 block">Goal</span>
                Robust real-time sync across devices
              </div>

              {/* SVG Edges */}
              <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-40">
                <path d="M 300 180 C 400 180, 450 120, 520 120" stroke="currentColor" strokeWidth="2" strokeDasharray="4 4" fill="none" className="text-indigo-400" />
                <path d="M 300 220 C 400 220, 350 280, 450 280" stroke="currentColor" strokeWidth="2" fill="none" className="text-indigo-400" />
              </svg>
            </div>
          </div>
        </div>
      </section>

      {/* Features grid */}
      <section id="features" className="max-w-7xl mx-auto px-6 py-20 border-t border-white/10 relative z-10">
        <div className="mb-16 text-center max-w-2xl mx-auto">
          <h2 className="text-3xl font-bold mb-4">You shouldn&apos;t have to repeat yourself.</h2>
          <p className="text-gray-400">0ctx intercepts context drop-offs by giving your LLM direct access to every rule, decision, and asset you&apos;ve already defined.</p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          <FeatureCard
            icon={<Cpu className="w-6 h-6 text-indigo-400" />}
            title="MCP Native API"
            desc="Built entirely on the standard Model Context Protocol. Works instantly with Claude Desktop, Cursor, and Windsurf."
          />
          <FeatureCard
            icon={<Layers className="w-6 h-6 text-purple-400" />}
            title="Smart Relevance Pruning"
            desc="Temporal decay and structural graph ranking ensure the LLM's context window stays clean and performant."
          />
          <FeatureCard
            icon={<Shield className="w-6 h-6 text-emerald-400" />}
            title="Encrypted Local-First"
            desc="Your graph lives in SQLite on your disk. You own your context. Zero-knowledge by design."
          />
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 py-12 text-center text-sm text-gray-500 mt-20 relative z-10">
        <p className="mb-2">0ctx - Zero Context Loss</p>
        <p>Built for the AI era.</p>
      </footer>
    </main>
  );
}

function FeatureCard({ icon, title, desc }: { icon: React.ReactNode, title: string, desc: string }) {
  return (
    <div className="glass-panel p-8 rounded-2xl hover:bg-white/[0.08] transition-all group cursor-default">
      <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
        {icon}
      </div>
      <h3 className="text-xl font-bold text-gray-100 mb-3">{title}</h3>
      <p className="text-gray-400 leading-relaxed text-sm">{desc}</p>
    </div>
  );
}
