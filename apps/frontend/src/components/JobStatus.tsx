// ============================================
// JobStatus Component - Real-time SSE status tracking
// ============================================
// KEY ASYNC FLOW POINT:
// This component creates an EventSource (SSE) connection to
// GET /api/jobs/:id/stream and displays real-time status updates.
//
// Data flow: Worker → Redis pub/sub → API SSE → EventSource → this component
// ============================================

import React, { useEffect, useState } from 'react';
import { subscribeToJobStatus } from '../api/jobs';

interface Props {
    jobId: string;
}

interface StatusUpdate {
    jobId: string;
    status: string;
    resultPayload?: { success: boolean; data: string; scrapedAt: string };
    errorMessage?: string;
    timestamp: string;
}

export function JobStatus({ jobId }: Props) {
    const [updates, setUpdates] = useState<StatusUpdate[]>([]);
    const [connected, setConnected] = useState(true);

    useEffect(() => {
        setUpdates([]);
        setConnected(true);

        // Subscribe to SSE stream for this job
        const eventSource = subscribeToJobStatus(
            jobId,
            (data: StatusUpdate) => {
                setUpdates((prev) => [...prev, data]);

                // Close connection when job reaches terminal state
                if (data.status === 'COMPLETED' || data.status === 'FAILED') {
                    eventSource.close();
                    setConnected(false);
                }
            },
            () => {
                setConnected(false);
            }
        );

        // Cleanup on unmount or jobId change
        return () => {
            eventSource.close();
        };
    }, [jobId]);

    const latestStatus = updates.length > 0 ? updates[updates.length - 1] : null;

    return (
        <div style={styles.container}>
            {/* Job ID */}
            <div style={styles.jobId}>
                <span style={styles.label}>Job ID:</span>
                <code style={styles.code}>{jobId}</code>
            </div>

            {/* Connection indicator */}
            <div style={styles.connection}>
                <span
                    style={{
                        ...styles.dot,
                        background: connected ? '#22c55e' : '#6b7280',
                    }}
                />
                {connected ? 'Listening for updates...' : 'Stream closed'}
            </div>

            {/* Status badge */}
            {latestStatus && (
                <div style={styles.statusBadge}>
                    <span style={styles.label}>Current Status:</span>
                    <span style={{ ...styles.badge, ...getStatusStyle(latestStatus.status) }}>
                        {getStatusIcon(latestStatus.status)} {latestStatus.status}
                    </span>
                </div>
            )}

            {/* Result data (from Playwright scraping) */}
            {latestStatus?.resultPayload && (
                <div style={styles.result}>
                    <span style={styles.label}>Scraped Result:</span>
                    <div style={styles.resultData}>
                        {latestStatus.resultPayload.data}
                    </div>
                    <div style={styles.meta}>
                        Scraped at: {new Date(latestStatus.resultPayload.scrapedAt).toLocaleString()}
                    </div>
                </div>
            )}

            {/* Error message */}
            {latestStatus?.errorMessage && (
                <div style={styles.error}>
                    <span style={styles.label}>Error:</span>
                    <div>{latestStatus.errorMessage}</div>
                </div>
            )}

            {/* Timeline of status updates */}
            <div style={styles.timeline}>
                <span style={styles.label}>Timeline:</span>
                {updates.map((update, i) => (
                    <div key={i} style={styles.timelineItem}>
                        <span style={styles.timelineIcon}>
                            {getStatusIcon(update.status)}
                        </span>
                        <span style={styles.timelineStatus}>{update.status}</span>
                        <span style={styles.timelineTime}>
                            {new Date(update.timestamp || update.updatedAt).toLocaleTimeString()}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function getStatusIcon(status: string): string {
    switch (status) {
        case 'PENDING': return '⏳';
        case 'IN_PROGRESS': return '🔄';
        case 'COMPLETED': return '✅';
        case 'FAILED': return '❌';
        default: return '❓';
    }
}

function getStatusStyle(status: string): React.CSSProperties {
    switch (status) {
        case 'PENDING': return { background: 'rgba(234, 179, 8, 0.2)', color: '#fbbf24', borderColor: 'rgba(234, 179, 8, 0.4)' };
        case 'IN_PROGRESS': return { background: 'rgba(59, 130, 246, 0.2)', color: '#60a5fa', borderColor: 'rgba(59, 130, 246, 0.4)' };
        case 'COMPLETED': return { background: 'rgba(34, 197, 94, 0.2)', color: '#4ade80', borderColor: 'rgba(34, 197, 94, 0.4)' };
        case 'FAILED': return { background: 'rgba(239, 68, 68, 0.2)', color: '#f87171', borderColor: 'rgba(239, 68, 68, 0.4)' };
        default: return {};
    }
}

const styles: Record<string, React.CSSProperties> = {
    container: {
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
    },
    jobId: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
    },
    label: {
        fontSize: '11px',
        fontWeight: '600',
        color: 'rgba(255, 255, 255, 0.5)',
        textTransform: 'uppercase' as const,
        letterSpacing: '0.5px',
    },
    code: {
        fontSize: '12px',
        color: '#a78bfa',
        background: 'rgba(167, 139, 250, 0.1)',
        padding: '2px 8px',
        borderRadius: '4px',
        fontFamily: 'monospace',
    },
    connection: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        fontSize: '13px',
        color: 'rgba(255, 255, 255, 0.5)',
    },
    dot: {
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        display: 'inline-block',
    },
    statusBadge: {
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
    },
    badge: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '6px 14px',
        borderRadius: '20px',
        fontSize: '13px',
        fontWeight: '600',
        border: '1px solid',
        width: 'fit-content',
    },
    result: {
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
    },
    resultData: {
        padding: '14px',
        borderRadius: '8px',
        background: 'rgba(34, 197, 94, 0.1)',
        border: '1px solid rgba(34, 197, 94, 0.2)',
        fontSize: '14px',
        fontWeight: '500',
        color: '#4ade80',
    },
    meta: {
        fontSize: '11px',
        color: 'rgba(255, 255, 255, 0.3)',
    },
    error: {
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        padding: '12px',
        borderRadius: '8px',
        background: 'rgba(239, 68, 68, 0.1)',
        border: '1px solid rgba(239, 68, 68, 0.2)',
        fontSize: '13px',
        color: '#fca5a5',
    },
    timeline: {
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        marginTop: '8px',
    },
    timelineItem: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '8px 12px',
        borderRadius: '6px',
        background: 'rgba(255, 255, 255, 0.03)',
        fontSize: '13px',
    },
    timelineIcon: {
        fontSize: '14px',
    },
    timelineStatus: {
        fontWeight: '500',
        flex: 1,
    },
    timelineTime: {
        fontSize: '11px',
        color: 'rgba(255, 255, 255, 0.4)',
        fontFamily: 'monospace',
    },
};
