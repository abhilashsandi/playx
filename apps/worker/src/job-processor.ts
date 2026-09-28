// ============================================
// Job Processor - Core worker logic
// ============================================
// COMPLETE ASYNC FLOW FOR JOB PROCESSING:
//
// 1. Consume encrypted message from RabbitMQ (automation.jobs queue)
// 2. Decrypt message to get JobMessage (jobId, vendor, payload)
// 3. Update job status to IN_PROGRESS (DB + Redis pub/sub)
// 4. Use VendorFactory to get the right IVendorAutomation implementation
// 5. Run Playwright automation:
//    a. Launch browser (headless: false for local dev)
//    b. Navigate to vendor site
//    c. Fill and submit form
//    d. Wait for result page
//    e. Scrape result text from DOM
// 6. On SUCCESS:
//    - Save scraped result to result_payload in DB
//    - Update status to COMPLETED
//    - Publish status event via Redis → SSE → Frontend
// 7. On FAILURE:
//    - Save error message to DB
//    - Update status to FAILED
//    - Throw error to trigger RabbitMQ nack (retry or DLQ)
// ============================================

import { injectable, inject } from 'inversify';
import { SERVICE_IDENTIFIERS, IJobRepository } from '@playx/core';
import { JobStatus, JobMessage, JobStatusEvent } from '@playx/shared-types';
import { RabbitMQClient, decryptMessage } from '@playx/messaging';
import { RedisClient, loadConfig, createLogger } from '@playx/infrastructure';
import { VendorFactory } from '@playx/vendors';
import { QuoteRepository } from '@playx/database';

const logger = createLogger('job-processor');

@injectable()
export class JobProcessor {
    constructor(
        @inject(SERVICE_IDENTIFIERS.RabbitMQClient) private rabbitMQ: RabbitMQClient,
        @inject(SERVICE_IDENTIFIERS.RedisClient) private redis: RedisClient,
        @inject(SERVICE_IDENTIFIERS.JobRepository) private jobRepo: IJobRepository,
        @inject(SERVICE_IDENTIFIERS.QuoteRepository) private quoteRepo: QuoteRepository,
        @inject(SERVICE_IDENTIFIERS.VendorFactory) private vendorFactory: VendorFactory
    ) { }

    /** Helper to sleep for a given number of ms */
    private async sleep(ms: number): Promise<void> {
        if (ms <= 0) return;
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * Starts consuming messages from the automation.jobs queue.
     * Each message represents a job that needs browser automation.
     */
    async start(): Promise<void> {
        const config = loadConfig();

        await this.rabbitMQ.consume(async (encryptedMessage: string, retryCount: number) => {
            // STEP 1: Decrypt the message
            const decrypted = decryptMessage(encryptedMessage, config.ENCRYPTION_KEY);
            const jobMessage: JobMessage = JSON.parse(decrypted);

            const { jobId, vendor, payload } = jobMessage;
            logger.info({ jobId, vendor, retryCount }, 'Processing job');

            try {
                // FAILURE SIMULATION
                if (Math.random() < config.SIMULATED_FAILURE_RATE) {
                    logger.warn({ jobId, rate: config.SIMULATED_FAILURE_RATE }, 'Simulating random job failure');
                    throw new Error(`Simulated random failure (Rate: ${config.SIMULATED_FAILURE_RATE})`);
                }

                // OPTIONAL: Simulated delay to slow down the flow for debugging
                if (config.SIMULATED_DELAY_MS > 0) {
                    logger.info({ delay: config.SIMULATED_DELAY_MS }, 'Simulating delay before starting job...');
                    await this.sleep(config.SIMULATED_DELAY_MS);
                }

                // STEP 2: Update status to IN_PROGRESS
                await this.jobRepo.updateStatus(jobId, JobStatus.IN_PROGRESS);
                await this.publishStatusUpdate(jobId, JobStatus.IN_PROGRESS);
                logger.info({ jobId }, 'Job status updated to IN_PROGRESS');

                if (config.SIMULATED_DELAY_MS > 0) {
                    await this.sleep(config.SIMULATED_DELAY_MS);
                }

                // STEP 3: Get vendor automation implementation via factory
                const vendorAutomation = this.vendorFactory.getVendor(vendor);

                // STEP 4: Run Playwright automation
                // This is where the browser launches, navigates to vendor site,
                // fills the form, submits, and scrapes the result
                logger.info({ jobId, vendor }, 'Starting Playwright automation');
                const result = await vendorAutomation.run(payload);

                if (config.SIMULATED_DELAY_MS > 0) {
                    logger.info({ jobId }, 'Automation complete, waiting before final update...');
                    await this.sleep(config.SIMULATED_DELAY_MS);
                }


                // STEP 5: Save scraped result to database (Quote table)
                const quote = await this.quoteRepo.create(jobId, result);

                // We still update the job result payload for backward compatibility/simplified view if needed
                // but the primary data is now in the Quote table
                await this.jobRepo.updateResult(jobId, result);

                logger.info({ jobId, quoteId: quote.id, data: result.data }, 'Scraped result saved to Quote table');

                // STEP 6: Publish COMPLETED status via Redis → SSE → Frontend
                await this.publishStatusUpdate(jobId, JobStatus.COMPLETED, result);
                logger.info({ jobId }, 'Job COMPLETED successfully');
            } catch (error) {
                // STEP 7: Handle failure
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                logger.error({ jobId, error: errorMessage, retryCount }, 'Job processing failed');

                // Save error to database
                await this.jobRepo.updateError(jobId, errorMessage);

                // Publish FAILED status via Redis → SSE → Frontend
                await this.publishStatusUpdate(jobId, JobStatus.FAILED, undefined, errorMessage);

                // Re-throw to trigger RabbitMQ nack → retry or DLQ
                throw error;
            }
        });
    }

    /**
     * Publishes a job status update to Redis pub/sub.
     * The API server subscribes to these channels and forwards them via SSE.
     *
     * Channel: job.status.{jobId}
     * Message: JSON-serialized JobStatusEvent
     */
    private async publishStatusUpdate(
        jobId: string,
        status: JobStatus,
        resultPayload?: unknown,
        errorMessage?: string
    ): Promise<void> {
        const event: JobStatusEvent = {
            jobId,
            status,
            resultPayload,
            errorMessage,
            timestamp: new Date().toISOString(),
        };

        await this.redis.publishStatus(jobId, JSON.stringify(event));
    }
}
