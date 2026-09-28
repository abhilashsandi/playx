// ============================================
// Redis Client - Pub/Sub wrapper for real-time status updates
// ============================================
// KEY ASYNC FLOW POINT:
// Redis pub/sub bridges the Worker → API → Frontend pipeline:
// 1. Worker publishes status update to channel "job.status.{jobId}"
// 2. API subscribes to the channel and pushes updates via SSE
// 3. Frontend receives SSE events in real-time
//
// We use separate Redis connections for pub and sub because
// a Redis connection in subscriber mode cannot issue other commands.
// ============================================

import { injectable } from 'inversify';
import Redis from 'ioredis';

export type StatusUpdateHandler = (channel: string, message: string) => void;

@injectable()
export class RedisClient {
    private publisher: Redis | null = null;
    private subscriber: Redis | null = null;

    /**
     * Initializes two Redis connections:
     * - publisher: for sending status updates (from worker)
     * - subscriber: for receiving status updates (in API for SSE)
     */
    async connect(host: string, port: number): Promise<void> {
        this.publisher = new Redis({ host, port, maxRetriesPerRequest: 3 });
        this.subscriber = new Redis({ host, port, maxRetriesPerRequest: 3 });
    }

    /**
     * Publishes a job status update to a job-specific channel.
     * Called by the Worker after updating job status in the database.
     *
     * Channel format: job.status.{jobId}
     * Message: JSON-serialized JobStatusEvent
     *
     * @param jobId - The job ID to publish status for
     * @param message - JSON string of the status event
     */
    async publishStatus(jobId: string, message: string): Promise<void> {
        if (!this.publisher) throw new Error('Redis publisher not connected');
        await this.publisher.publish(`job.status.${jobId}`, message);
    }

    /**
     * Subscribes to status updates for a specific job.
     * Called by the API server to bridge Redis → SSE.
     *
     * @param jobId - The job ID to subscribe to
     * @param handler - Callback invoked when a status update arrives
     */
    async subscribeToJob(jobId: string, handler: StatusUpdateHandler): Promise<void> {
        if (!this.subscriber) throw new Error('Redis subscriber not connected');
        const channel = `job.status.${jobId}`;
        await this.subscriber.subscribe(channel);
        this.subscriber.on('message', (ch: string, msg: string) => {
            if (ch === channel) {
                handler(ch, msg);
            }
        });
    }

    /**
     * Unsubscribes from a specific job's status channel.
     * Called when the SSE connection is closed by the frontend.
     */
    async unsubscribeFromJob(jobId: string): Promise<void> {
        if (!this.subscriber) return;
        await this.subscriber.unsubscribe(`job.status.${jobId}`);
    }

    /**
     * Gracefully closes both Redis connections.
     * Should be called during application shutdown.
     */
    async disconnect(): Promise<void> {
        if (this.publisher) {
            this.publisher.disconnect();
            this.publisher = null;
        }
        if (this.subscriber) {
            this.subscriber.disconnect();
            this.subscriber = null;
        }
    }
}
