// ============================================
// JobService - Orchestrates job creation and publishing
// ============================================
// KEY ASYNC FLOW POINT:
// 1. Creates job record in PostgreSQL (status = PENDING)
// 2. Encrypts the job payload
// 3. Publishes encrypted message to RabbitMQ
// 4. Returns jobId immediately (worker processes async)
//
// The caller (API route) returns the jobId to the frontend,
// which then subscribes via SSE for real-time updates.
// ============================================

import { injectable, inject } from 'inversify';
import { v4 as uuidv4 } from 'uuid';
import { SERVICE_IDENTIFIERS, IJobRepository } from '@playx/core';
import { CreateJobDto, JobStatus, JobMessage, JobResponse, VendorType } from '@playx/shared-types';
import { RabbitMQClient, encryptMessage } from '@playx/messaging';
import { loadConfig, createLogger } from '@playx/infrastructure';

const logger = createLogger('job-service');

@injectable()
export class JobService {
    constructor(
        @inject(SERVICE_IDENTIFIERS.JobRepository) private jobRepo: IJobRepository,
        @inject(SERVICE_IDENTIFIERS.RabbitMQClient) private rabbitMQ: RabbitMQClient
    ) { }

    /**
     * Creates a new automation job:
     * 1. Generate UUID
     * 2. Persist to PostgreSQL with PENDING status
     * 3. Encrypt and publish to RabbitMQ
     * 4. Return jobId for frontend to track
     */
    async createJob(dto: CreateJobDto): Promise<string> {
        const config = loadConfig();
        const jobId = uuidv4();

        // Step 1: Create job record in database
        await this.jobRepo.create({
            id: jobId,
            vendor: dto.vendor,
            status: JobStatus.PENDING,
            inputPayload: dto,
        });
        logger.info({ jobId, vendor: dto.vendor }, 'Job created in database');

        // Step 2: Build message payload and encrypt
        const message: JobMessage = {
            jobId,
            vendor: dto.vendor,
            payload: dto,
        };

        const encrypted = encryptMessage(JSON.stringify(message), config.ENCRYPTION_KEY);

        // Step 3: Publish encrypted message to RabbitMQ
        // The worker will pick this up asynchronously
        await this.rabbitMQ.publish(encrypted, {
            headers: {
                'x-max-retries': dto.maxRetries || 3
            }
        });
        logger.info({ jobId, maxRetries: dto.maxRetries || 3 }, 'Job message published to RabbitMQ');

        return jobId;
    }

    /**
     * Retrieves a job by ID and maps it to the API response format.
     */
    async getJob(jobId: string): Promise<JobResponse | null> {
        const job = await this.jobRepo.findById(jobId);
        if (!job) return null;

        return {
            id: job.id,
            vendor: job.vendor as VendorType,
            status: job.status as JobStatus,
            inputPayload: job.inputPayload as CreateJobDto,
            resultPayload: job.resultPayload as any,
            errorMessage: job.errorMessage,
            createdAt: job.createdAt.toISOString(),
            updatedAt: job.updatedAt.toISOString(),
        };
    }

    /**
     * Returns system statistics, including DLQ depth.
     */
    async getSystemStats(): Promise<{ dlqDepth: number }> {
        const dlqDepth = await this.rabbitMQ.checkDlqDepth();
        return { dlqDepth };
    }
}
