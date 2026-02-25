import Link from 'next/link';

export default function LoginPage() {
    return (
        <div
            style={{
                minHeight: '100vh',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--bg-primary, #09090b)',
                color: 'var(--text-primary, #fafafa)',
                fontFamily: 'var(--font-sans, system-ui, sans-serif)'
            }}
        >
            <div
                style={{
                    maxWidth: '400px',
                    width: '100%',
                    padding: '2.5rem',
                    borderRadius: '1rem',
                    background: 'var(--surface-primary, #18181b)',
                    border: '1px solid var(--border-subtle, #27272a)',
                    textAlign: 'center'
                }}
            >
                <div style={{ fontSize: '2rem', marginBottom: '0.5rem', fontWeight: 700 }}>
                    🔐
                </div>
                <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: '0 0 0.5rem' }}>
                    Sign in to 0ctx
                </h1>
                <p
                    style={{
                        color: 'var(--text-muted, #a1a1aa)',
                        fontSize: '0.875rem',
                        lineHeight: '1.5',
                        margin: '0 0 2rem'
                    }}
                >
                    Authenticate to access the dashboard and manage your contexts.
                </p>

                <a
                    href="/auth/login"
                    style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.5rem',
                        padding: '0.75rem 1.5rem',
                        borderRadius: '0.5rem',
                        background: 'var(--accent-primary, #6366f1)',
                        color: '#fff',
                        fontWeight: 600,
                        fontSize: '0.875rem',
                        textDecoration: 'none',
                        transition: 'opacity 0.15s',
                        width: '100%'
                    }}
                >
                    Sign in with Auth0
                </a>

                <div style={{ marginTop: '1.5rem' }}>
                    <Link
                        href="/"
                        style={{
                            color: 'var(--text-muted, #a1a1aa)',
                            fontSize: '0.8125rem',
                            textDecoration: 'none'
                        }}
                    >
                        ← Back to home
                    </Link>
                </div>
            </div>
        </div>
    );
}
