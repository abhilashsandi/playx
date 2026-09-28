// ============================================
// API Client - Fetch wrapper for backend communication
// ============================================

const API_BASE = 'http://localhost:3000/api';

export interface CreateJobPayload {
    name: string;
    email: string;
    quoteId: string;
    vendor: string;
}

/** POST /api/jobs — Submit a new automation job */
export async function createJob(payload: CreateJobPayload): Promise<{ jobId: string }> {
    const response = await fetch(`${API_BASE}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create job');
    }

    return response.json();
}

/** GET /api/jobs/:id — Fetch job details */
export async function getJob(jobId: string): Promise<any> {
    const response = await fetch(`${API_BASE}/jobs/${jobId}`);
    if (!response.ok) throw new Error('Failed to fetch job');
    return response.json();
}

/**
 * GET /api/jobs/:id/stream — SSE subscription for real-time status updates
 *
 * KEY ASYNC FLOW POINT:
 * This creates an EventSource (SSE) connection to the API.
 * The API bridges Redis pub/sub events to this SSE stream.
 * Each event contains the latest job status update.
 */
export function subscribeToJobStatus(
    jobId: string,
    onMessage: (data: any) => void,
    onError?: (error: Event) => void
): EventSource {
    const eventSource = new EventSource(`${API_BASE}/jobs/${jobId}/stream`);

    eventSource.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            onMessage(data);
        } catch {
            console.error('Failed to parse SSE event:', event.data);
        }
    };

    eventSource.onerror = (error) => {
        if (onError) onError(error);
        // Close on error — prevent infinite reconnect attempts
        eventSource.close();
    };

    return eventSource;
}
