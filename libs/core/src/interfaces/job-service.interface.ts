// ============================================
// IJobService - Domain service interface for job orchestration
// ============================================

import { CreateJobDto, JobResponse } from '@playx/shared-types';

export interface IJobService {
    /**
     * Creates a new job, persists it to DB, and publishes to RabbitMQ.
     * Returns the job ID immediately (async processing happens in worker).
     */
    createJob(dto: CreateJobDto): Promise<string>;

    /** Retrieves a job by ID */
    getJob(jobId: string): Promise<JobResponse | null>;
}
