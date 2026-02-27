'use client';

import { useEffect, useRef, useState, FormEvent } from 'react';
import Link from 'next/link';

export default function LoginPage() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [mode, setMode] = useState<'login' | 'signup'>('login');

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');

    const [activeInput, setActiveInput] = useState<string | null>(null);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let width: number, height: number;
        const charSize = 14;
        const columns: { x: number; y: number; speed: number }[] = [];

        const chars = "01│─┌┐└┘├┤┼ABCDEFx@#";

        function resize() {
            if (!canvas || !container) return;
            width = canvas.width = container.offsetWidth;
            height = canvas.height = container.offsetHeight;

            const cols = Math.floor(width / charSize);
            columns.length = 0;
            for (let i = 0; i < cols; i++) {
                columns.push({
                    x: i * charSize,
                    y: Math.random() * height,
                    speed: 1 + Math.random() * 2
                });
            }
        }

        window.addEventListener('resize', resize);
        resize();

        const handleKeydown = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement)?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA') return;

            if (e.key.toLowerCase() === 'a') {
                e.preventDefault();
                window.location.href = '/api/auth/login';
            }
        };
        window.addEventListener('keydown', handleKeydown);

        let animationId: number;

        function draw() {
            if (!ctx) return;
            ctx.fillStyle = 'rgba(3, 3, 3, 0.1)';
            ctx.fillRect(0, 0, width, height);

            ctx.fillStyle = '#2a2a2a';
            ctx.font = '12px var(--font-mono, monospace)';

            columns.forEach((col) => {
                const char = chars[Math.floor(Math.random() * chars.length)];

                if (Math.random() > 0.98) {
                    ctx.fillStyle = 'var(--accent-orange, #f97316)';
                } else {
                    ctx.fillStyle = 'var(--text-dim, #333333)';
                }

                ctx.fillText(char, col.x, col.y);

                col.y += col.speed * 10;

                if (col.y > height) {
                    col.y = -20;
                    col.speed = 1 + Math.random() * 1.5;
                }

                if (Math.random() > 0.99) {
                    ctx.strokeStyle = '#222';
                    ctx.beginPath();
                    ctx.moveTo(col.x, col.y);
                    ctx.lineTo(col.x + 50, col.y);
                    ctx.stroke();
                }
            });

            animationId = requestAnimationFrame(draw);
        }

        draw();

        return () => {
            window.removeEventListener('resize', resize);
            window.removeEventListener('keydown', handleKeydown);
            cancelAnimationFrame(animationId);
        };
    }, []);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setError(null);
        setSuccess(null);
        setLoading(true);

        if (mode === 'signup' && password !== confirmPassword) {
            setError('Passwords do not match');
            setLoading(false);
            return;
        }

        try {
            const response = await fetch('/api/v1/auth/custom', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password, action: mode }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Authentication failed');
            }

            if (data.redirect) {
                window.location.href = data.redirect;
            } else {
                setSuccess(data.message || 'Success! Please check your email.');
                if (mode === 'signup') {
                    setMode('login');
                }
            }
        } catch (err: any) {
            setError(err.message || 'An error occurred during authentication');
        } finally {
            setLoading(false);
        }
    };

    const isSignup = mode === 'signup';

    return (
        <>
            <style dangerouslySetInnerHTML={{
                __html: `
        :root {
            --bg-color: #030303;
            --panel-bg: #0a0a0a;
            --text-main: #e5e5e5;
            --text-muted: #666666;
            --text-dim: #333333;
            --accent-orange: #f97316;
            --accent-orange-dim: rgba(249, 115, 22, 0.15);
            --border-color: #2a2a2a;
            --font-mono: 'SF Mono', 'Segoe UI Mono', 'Fira Code', 'Roboto Mono', monospace;
            --cursor-color: #f97316;
        }

        .auth-container {
            background-color: var(--bg-color);
            color: var(--text-main);
            font-family: var(--font-mono);
            height: 100vh;
            width: 100vw;
            overflow: hidden;
            display: flex;
            font-size: 14px;
            line-height: 1.5;
            -webkit-font-smoothing: antialiased;
        }

        .split-layout {
            display: grid;
            grid-template-columns: 1fr 480px;
            width: 100%;
            height: 100%;
        }
        
        @media (max-width: 768px) {
            .split-layout {
                grid-template-columns: 1fr;
            }
            .visual-pane {
                display: none !important;
            }
        }

        .visual-pane {
            position: relative;
            background: var(--bg-color);
            border-right: 1px solid var(--border-color);
            overflow: hidden;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .ascii-canvas {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            opacity: 0.6;
            z-index: 1;
        }

        .overlay-text {
            position: relative;
            z-index: 2;
            pointer-events: none;
            text-align: left;
            max-width: 600px;
            padding: 40px;
        }

        .brand-hero {
            font-size: 14px;
            color: var(--text-muted);
            margin-bottom: 20px;
            letter-spacing: 0.5px;
        }

        .brand-hero strong {
            color: var(--text-main);
            font-weight: 500;
        }

        .auth-pane {
            background: var(--bg-color);
            display: flex;
            flex-direction: column;
            justify-content: center;
            padding: 40px;
            position: relative;
        }

        .editor-window {
            border: 1px solid var(--border-color);
            background: #050505;
            min-height: 400px;
            position: relative;
            box-shadow: 0 0 30px rgba(0,0,0,0.5);
        }

        .editor-header {
            border-bottom: 1px solid var(--border-color);
            padding: 8px 12px;
            color: var(--text-muted);
            font-size: 12px;
            display: flex;
            justify-content: space-between;
            background: #080808;
        }

        .file-tab {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .status-dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: var(--accent-orange);
            box-shadow: 0 0 4px var(--accent-orange);
        }

        .editor-body {
            padding: 20px 0;
            font-family: var(--font-mono);
            position: relative;
        }

        .code-line {
            display: flex;
            align-items: flex-start; 
            padding: 2px 0;
            position: relative;
            transition: background 0.1s ease;
        }

        .line-active {
            background: var(--accent-orange-dim);
        }

        .line-number {
            width: 50px;
            text-align: right;
            padding-right: 15px;
            color: var(--text-dim);
            user-select: none;
            flex-shrink: 0;
        }

        .line-active .line-number {
            color: var(--text-muted);
        }

        .code-content {
            flex-grow: 1;
            padding-right: 20px;
            color: var(--text-muted);
            display: flex;
            align-items: center;
        }

        .syntax-keyword { color: #c678dd; } 
        .syntax-var { color: #e06c75; } 
        .syntax-string { color: #98c379; } 
        .syntax-op { color: #56b6c2; } 
        .syntax-comment { color: #5c6370; font-style: italic; }

        .input-wrapper {
            display: flex;
            align-items: center;
            width: 100%;
        }

        .ghost-input {
            background: transparent;
            border: none;
            color: var(--accent-orange);
            font-family: var(--font-mono);
            font-size: 14px;
            width: 100%;
            margin-left: 8px;
            caret-color: var(--accent-orange);
            outline: none;
        }
        
        .ghost-input::placeholder {
            color: var(--text-dim);
            opacity: 0.5;
        }

        .cursor-indicator {
            color: var(--accent-orange);
            margin-right: 4px;
            opacity: 0;
        }

        .line-active .cursor-indicator {
            opacity: 1;
        }

        .menu-item {
            display: block;
            width: 100%;
            text-align: left;
            background: transparent;
            border: none;
            color: var(--text-muted);
            font-family: var(--font-mono);
            font-size: 14px;
            padding: 8px 12px;
            cursor: pointer;
            position: relative;
            transition: all 0.2s ease;
        }

        .menu-item:hover {
            color: var(--text-main);
        }

        .menu-item.primary-action {
            color: var(--accent-orange);
            background: var(--accent-orange-dim);
            border-left: 2px solid var(--accent-orange);
        }
        
        .menu-item.primary-action:hover {
            background: rgba(249, 115, 22, 0.25);
        }

        .google-btn {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-top: 5px;
        }

        .toggle-opt {
            color: var(--text-dim);
            cursor: pointer;
            padding-bottom: 2px;
            border-bottom: 1px solid transparent;
            transition: all 0.2s ease;
        }

        .toggle-opt.active {
            color: var(--accent-orange);
            border-bottom: 1px solid var(--accent-orange);
        }

        .shortcuts-bar {
            margin-top: 20px;
            padding-left: 50px;
            font-size: 12px;
            color: var(--text-dim);
            display: flex;
            gap: 20px;
        }

        .key {
            color: var(--text-muted);
            border: 1px solid var(--text-dim);
            padding: 0 4px;
            border-radius: 2px;
            margin-right: 4px;
        }

        .blink {
            animation: blinker 1s linear infinite;
        }

        @keyframes blinker {
            50% { opacity: 0; }
        }
        
        .back-home {
            position: absolute;
            top: 20px;
            right: 40px;
            color: var(--text-muted);
            text-decoration: none;
            font-size: 12px;
            transition: color 0.2s ease;
        }
        
        .back-home:hover {
            color: var(--text-main);
        }
      `}} />

            <div className="auth-container">
                <div className="split-layout">
                    <div className="visual-pane" ref={containerRef}>
                        <canvas ref={canvasRef} className="ascii-canvas"></canvas>
                        <div className="overlay-text">
                            <div className="brand-hero">
                                <span style={{ color: 'var(--accent-orange)' }}>// 0ctx_daemon_v2.4</span><br />
                                <strong>PERSISTENT MEMORY LAYER</strong><br /><br />
                                Target: Autonomous Agents<br />
                                Status: <span className="blink">LISTENING</span><br />
                                Uptime: 99.999%
                            </div>
                            <div style={{ color: 'var(--text-dim)', fontSize: '10px', marginTop: '10px' }}>
                                0ctx acts as a durable brain, storing project context in a traversable graph so your AI never hallucinates or forgets.
                            </div>
                        </div>
                    </div>

                    <div className="auth-pane">
                        <Link href="/" className="back-home">[ RETURN_HOME ]</Link>
                        <div className="editor-window">
                            <div className="editor-header">
                                <div className="file-tab">
                                    <div className="status-dot"></div>
                                    <span>user_session.config</span>
                                </div>
                                <div style={{ display: 'flex', gap: '15px' }}>
                                    <span
                                        className={`toggle-opt ${!isSignup ? 'active' : ''}`}
                                        onClick={() => setMode('login')}
                                    >LOGIN</span>
                                    <span
                                        className={`toggle-opt ${isSignup ? 'active' : ''}`}
                                        onClick={() => setMode('signup')}
                                    >SIGNUP</span>
                                </div>
                            </div>

                            <form className="editor-body" onSubmit={handleSubmit}>
                                <div className="code-line">
                                    <div className="line-number">102</div>
                                    <div className="code-content">
                                        <span className="syntax-comment">// Initialize handshake protocol</span>
                                    </div>
                                </div>

                                <div className="code-line">
                                    <div className="line-number">103</div>
                                    <div className="code-content" style={{ minHeight: '21px' }}>
                                        {error && <span style={{ color: '#e06c75' }}>// Error: {error}</span>}
                                        {success && <span style={{ color: '#98c379' }}>// Success: {success}</span>}
                                    </div>
                                </div>

                                <div className={`code-line ${activeInput === 'email' ? 'line-active' : ''}`}>
                                    <div className="line-number">104</div>
                                    <div className="code-content input-wrapper">
                                        <span className="cursor-indicator">→</span>
                                        <span className="syntax-keyword">const</span>&nbsp;
                                        <span className="syntax-var">identity</span>&nbsp;
                                        <span className="syntax-op">=</span>
                                        <input
                                            type="email"
                                            className="ghost-input"
                                            placeholder='"enter_email@domain.com"'
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                            onFocus={() => setActiveInput('email')}
                                            onBlur={() => setActiveInput(null)}
                                            required
                                        />
                                    </div>
                                </div>

                                <div className={`code-line ${activeInput === 'password' ? 'line-active' : ''}`}>
                                    <div className="line-number">105</div>
                                    <div className="code-content input-wrapper">
                                        <span className="cursor-indicator">→</span>
                                        <span className="syntax-keyword">let</span>&nbsp;
                                        <span className="syntax-var">secret</span>&nbsp;
                                        <span className="syntax-op">=</span>
                                        <input
                                            type="password"
                                            className="ghost-input"
                                            placeholder='"********"'
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            onFocus={() => setActiveInput('password')}
                                            onBlur={() => setActiveInput(null)}
                                            required
                                        />
                                    </div>
                                </div>

                                {isSignup && (
                                    <div className={`code-line ${activeInput === 'confirm' ? 'line-active' : ''}`}>
                                        <div className="line-number">106</div>
                                        <div className="code-content input-wrapper">
                                            <span className="cursor-indicator">→</span>
                                            <span className="syntax-keyword">let</span>&nbsp;
                                            <span className="syntax-var">verify</span>&nbsp;
                                            <span className="syntax-op">=</span>
                                            <input
                                                type="password"
                                                className="ghost-input"
                                                placeholder='"confirm_secret"'
                                                value={confirmPassword}
                                                onChange={(e) => setConfirmPassword(e.target.value)}
                                                onFocus={() => setActiveInput('confirm')}
                                                onBlur={() => setActiveInput(null)}
                                                required
                                            />
                                        </div>
                                    </div>
                                )}

                                <div className="code-line">
                                    <div className="line-number">{isSignup ? 107 : 106}</div>
                                    <div className="code-content"></div>
                                </div>

                                <div className="code-line">
                                    <div className="line-number">{isSignup ? 108 : 107}</div>
                                    <div className="code-content" style={{ display: 'block', width: '100%' }}>
                                        <button type="submit" className="menu-item primary-action" disabled={loading}>
                                            <span style={{ marginRight: '10px' }}>→</span>
                                            <span>{loading ? "Processing..." : (isSignup ? "Initialize_New_User()" : "Execute_Login()")}</span>
                                        </button>
                                        <a href="/api/auth/login" className="menu-item google-btn" style={{ textDecoration: 'none' }}>
                                            <span style={{ opacity: 0.5 }}>[A]</span> Auth0_Provider("Universal Login")
                                        </a>
                                    </div>
                                </div>

                                <div className="code-line">
                                    <div className="line-number">{isSignup ? 109 : 108}</div>
                                    <div className="code-content syntax-comment">
                                        <span className="syntax-comment">{"}"}</span>
                                    </div>
                                </div>
                            </form>

                            <div className="shortcuts-bar">
                                <span><span className="key">↵</span> to execute</span>
                                <span><span className="key">tab</span> next field</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}
