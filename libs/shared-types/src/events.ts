// ============================================
// SSE Event Types - Used for real-time status updates
// ============================================

import { JobStatus } from './job.types';

/** SSE event sent from API → Frontend */
export interface JobStatusEvent {
    jobId: string;
    status: JobStatus;
    resultPayload?: unknown;
    errorMessage?: string;
    timestamp: string;
}
