
import React, { useEffect, useState } from 'react';

export function Dashboard() {
    const [stats, setStats] = useState<{ dlqDepth: number } | null>(null);
    const [error, setError] = useState<string | null>(null);

    const fetchStats = async () => {
        try {
            const response = await fetch('http://localhost:3000/api/admin/stats');
            if (!response.ok) throw new Error('Failed to fetch stats');
            const data = await response.json();
            setStats(data);
            setError(null);
        } catch (err) {
            setError('Could not load system stats');
            console.error(err);
        }
    };

    useEffect(() => {
        fetchStats();
        const interval = setInterval(fetchStats, 5000); // Poll every 5 seconds
        return () => clearInterval(interval);
    }, []);

    return (
        <div style={styles.card}>
            <h3 style={styles.title}>System Monitor</h3>

            {error && <div style={styles.error}>{error}</div>}

            <div style={styles.statRow}>
                <div style={styles.statLabel}>DLQ Depth</div>
                <div style={styles.statValue}>
                    {stats ? stats.dlqDepth : '-'}
                </div>
            </div>

            <div style={styles.description}>
                Messages in the Dead Letter Queue require manual intervention.
            </div>
        </div>
    );
}

const styles: Record<string, React.CSSProperties> = {
    card: {
        background: 'rgba(255, 255, 255, 0.04)',
        backdropFilter: 'blur(10px)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '16px',
        padding: '24px',
        marginTop: '24px',
    },
    title: {
        margin: '0 0 16px 0',
        fontSize: '18px',
        fontWeight: '600',
        color: 'rgba(255, 255, 255, 0.9)',
    },
    error: {
        color: '#ff6b6b',
        marginBottom: '10px',
        fontSize: '14px',
    },
    statRow: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '8px',
    },
    statLabel: {
        color: 'rgba(255, 255, 255, 0.6)',
        fontSize: '15px',
    },
    statValue: {
        fontSize: '24px',
        fontWeight: 'bold',
        color: '#4ecdc4',
    },
    description: {
        fontSize: '12px',
        color: 'rgba(255, 255, 255, 0.3)',
        marginTop: '12px',
    }
};
