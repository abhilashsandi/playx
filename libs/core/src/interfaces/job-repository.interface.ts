// ============================================
// IJobRepository - Data access interface for jobs
// ============================================

import { JobStatus, VendorResult } from '@playx/shared-types';

/** Database row shape for a job */
export interface JobRecord {
    id: string;
    vendor: string;
    status: string;
    inputPayload: unknown;
    resultPayload: unknown | null;
    errorMessage: string | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface IJobRepository {
    /** Create a new job record with PENDING status */
    create(data: {
        id: string;
        vendor: string;
        status: JobStatus;
        inputPayload: unknown;
    }): Promise<JobRecord>;

    /** Find a job by ID */
    findById(id: string): Promise<JobRecord | null>;

    /** Update job status */
    updateStatus(id: string, status: JobStatus): Promise<void>;

    /** Update job with result data (on completion) */
    updateResult(id: string, result: VendorResult): Promise<void>;

    /** Update job with error message (on failure) */
    updateError(id: string, errorMessage: string): Promise<void>;
}
