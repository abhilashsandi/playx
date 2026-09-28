// ============================================
// Frontend App - Automation Platform UI
// ============================================

import React, { useState } from 'react';
import { JobForm } from './components/JobForm';
import { JobStatus } from './components/JobStatus';
import { Dashboard } from './components/Dashboard';

function App() {
    const [activeJobId, setActiveJobId] = useState<string | null>(null);

    return (
        <div style={styles.container}>
            <header style={styles.header}>
                <h1 style={styles.title}>⚡ Automation Platform</h1>
                <p style={styles.subtitle}>Submit automation jobs and track them in real-time</p>
            </header>

            <main style={styles.main}>
                <div style={styles.grid}>
                    {/* Left panel: Job submission form */}
                    <div style={styles.panel}>
                        <h2 style={styles.panelTitle}>📋 New Job</h2>
                        <JobForm onJobCreated={(jobId) => setActiveJobId(jobId)} />

                        <Dashboard />
                    </div>

                    {/* Right panel: Job status tracking */}
                    <div style={styles.panel}>
                        <h2 style={styles.panelTitle}>📊 Job Status</h2>
                        {activeJobId ? (
                            <JobStatus jobId={activeJobId} />
                        ) : (
                            <div style={styles.placeholder}>
                                Submit a job to see real-time status updates here.
                            </div>
                        )}
                    </div>
                </div>
            </main>
        </div>
    );
}

const styles: Record<string, React.CSSProperties> = {
    container: {
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)',
        fontFamily: "'Inter', system-ui, sans-serif",
        color: '#fff',
        padding: '0',
    },
    header: {
        textAlign: 'center' as const,
        padding: '40px 20px 20px',
    },
    title: {
        margin: '0',
        fontSize: '32px',
        fontWeight: '700',
        background: 'linear-gradient(to right, #667eea, #764ba2)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
    },
    subtitle: {
        margin: '8px 0 0',
        color: 'rgba(255, 255, 255, 0.5)',
        fontSize: '15px',
    },
    main: {
        maxWidth: '1100px',
        margin: '0 auto',
        padding: '20px',
    },
    grid: {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '24px',
    },
    panel: {
        background: 'rgba(255, 255, 255, 0.04)',
        backdropFilter: 'blur(10px)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '16px',
        padding: '28px',
    },
    panelTitle: {
        margin: '0 0 20px 0',
        fontSize: '18px',
        fontWeight: '600',
        color: 'rgba(255, 255, 255, 0.9)',
    },
    placeholder: {
        padding: '40px 20px',
        textAlign: 'center' as const,
        color: 'rgba(255, 255, 255, 0.3)',
        fontSize: '14px',
    },
};

export default App;
