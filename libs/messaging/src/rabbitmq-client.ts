// ============================================
// RabbitMQ Client - Producer/Consumer abstraction
// Handles queue setup, dead letter exchange, retry logic, ack/nack
// ============================================
// KEY ASYNC FLOW POINTS:
// 1. On publish: message is AES-encrypted then sent to automation.jobs exchange
// 2. On consume: messages are processed one at a time (prefetch=1)
// 3. On failure: message is nacked. RabbitMQ routes to DLQ via DLX.
//    x-death headers track retry count. After 3 retries, stays in DLQ.
// 4. On success: message is acked and removed from queue.
// ============================================

import { injectable } from 'inversify';
import * as amqplib from 'amqplib';
import { Channel, Connection, ConsumeMessage } from 'amqplib';

// Queue and exchange names
const MAIN_EXCHANGE = 'automation.exchange';
const MAIN_QUEUE = 'automation.jobs.v2';
const MAIN_ROUTING_KEY = 'job.process';

const DLX_EXCHANGE = 'automation.dlx';
const DLQ_QUEUE = 'automation.jobs.dlq';
const DLQ_ROUTING_KEY = 'job.dead';
const DEFAULT_MAX_RETRIES = 3;

export type MessageHandler = (msg: string, retryCount: number, maxRetries?: number) => Promise<void>;

@injectable()
export class RabbitMQClient {
    private connection: any = null;
    private channel: any = null;

    /**
     * Connects to RabbitMQ and sets up queues with dead letter exchange.
     *
     * Queue topology:
     *   automation.exchange → automation.jobs (main queue)
     *   automation.dlx → automation.jobs.dlq (dead letter queue)
     *
     * When a message is nacked (rejected), RabbitMQ routes it to the DLQ
     * via the dead letter exchange (DLX) configured on the main queue.
     */
    async connect(url: string): Promise<void> {
        this.connection = await (amqplib as any).connect(url);
        this.channel = await this.connection.createChannel();

        if (!this.channel) {
            throw new Error('Failed to create RabbitMQ channel');
        }

        // Set prefetch to 1: process one job at a time
        // This ensures ordering and prevents overwhelming the worker
        await this.channel.prefetch(1);

        // --- Dead Letter Exchange & Queue ---
        // Messages that are rejected (nacked) from the main queue land here
        await this.channel.assertExchange(DLX_EXCHANGE, 'direct', { durable: true });
        await this.channel.assertQueue(DLQ_QUEUE, { durable: true });
        await this.channel.bindQueue(DLQ_QUEUE, DLX_EXCHANGE, DLQ_ROUTING_KEY);

        // --- Main Exchange & Queue ---
        // The main queue has x-dead-letter-exchange pointing to DLX
        // so rejected messages are automatically routed there
        await this.channel.assertExchange(MAIN_EXCHANGE, 'direct', { durable: true });
        await this.channel.assertQueue(MAIN_QUEUE, {
            durable: true,
            arguments: {
                'x-dead-letter-exchange': DLX_EXCHANGE,
                'x-dead-letter-routing-key': DLQ_ROUTING_KEY,
            },
        });
        await this.channel.bindQueue(MAIN_QUEUE, MAIN_EXCHANGE, MAIN_ROUTING_KEY);
    }

    /**
     * Publishes an encrypted message to the main automation queue.
     * Called by the API server after creating a job record.
     *
     * @param message - Already-encrypted job message string
     * @param options - Optional publishing settings like headers
     */
    async publish(message: string, options?: { headers?: Record<string, any> }): Promise<void> {
        if (!this.channel) throw new Error('RabbitMQ channel not initialized');

        this.channel.publish(
            MAIN_EXCHANGE,
            MAIN_ROUTING_KEY,
            Buffer.from(message),
            {
                persistent: true, // Survive broker restarts
                contentType: 'application/json',
                headers: options?.headers,
            }
        );
    }

    /**
     * Starts consuming messages from the main queue.
     * Implements retry logic using x-death headers:
     *
     * RETRY FLOW:
     * 1. Message consumed → handler called
     * 2. If handler succeeds → ack (remove from queue)
     * 3. If handler fails:
     *    a. Check x-death header for retry count
     *    b. If retries < MAX_RETRIES → nack + requeue (back to main queue)
     *    c. If retries >= MAX_RETRIES → nack without requeue (goes to DLQ via DLX)
     *
     * @param handler - Async function to process each message
     */
    async consume(handler: MessageHandler): Promise<void> {
        if (!this.channel) throw new Error('RabbitMQ channel not initialized');

        await this.channel.consume(MAIN_QUEUE, async (msg: ConsumeMessage | null) => {
            if (!msg || !this.channel) return;

            const content = msg.content.toString();

            // Extract retry count from custom header
            const headers = msg.properties.headers || {};
            const retryCount = (headers['x-retry-count'] as number) || 0;

            const maxRetriesHeader = headers['x-max-retries'];
            const maxRetries = typeof maxRetriesHeader === 'number' ? maxRetriesHeader : DEFAULT_MAX_RETRIES;

            console.log(`[RabbitMQ] Msg received. RetryCount: ${retryCount}, Max: ${maxRetries}`);

            try {
                await handler(content, retryCount, maxRetries);

                // SUCCESS: Acknowledge the message
                console.log(`[RabbitMQ] Handler success. Acking.`);
                this.channel.ack(msg);
            } catch (error) {
                console.log(`[RabbitMQ] Handler failed. Error: ${error instanceof Error ? error.message : 'Unknown'}`);

                // FAILURE: Check if we should retry or send to DLQ
                if (retryCount < maxRetries) {
                    console.log(`[RabbitMQ] Retrying... (${retryCount + 1}/${maxRetries})`);
                    // RETRY: Publish a NEW message with incremented retry count
                    // We must ACK the original failing message so it's removed
                    const nextRetryCount = retryCount + 1;

                    const retryHeaders = {
                        ...headers,
                        'x-retry-count': nextRetryCount,
                    };

                    // Republish directly to the exchange
                    this.channel.publish(
                        MAIN_EXCHANGE,
                        MAIN_ROUTING_KEY,
                        msg.content,
                        {
                            persistent: true,
                            headers: retryHeaders
                        }
                    );

                    // Ack the original message (it's effectively replaced by the new one)
                    this.channel.ack(msg);
                } else {
                    console.log(`[RabbitMQ] Max retries reached. Nacking to DLQ.`);
                    // DLQ: Nack WITHOUT requeue
                    // This sends it to the DLX -> DLQ
                    this.channel.nack(msg, false, false);
                }
            }
        });
    }

    /**
     * Checks the depth of the Dead Letter Queue and logs an alert if it exceeds the threshold.
     */
    async checkDlqDepth(): Promise<number> {
        if (!this.channel) return 0;

        try {
            const { messageCount } = await this.channel.checkQueue(DLQ_QUEUE);
            // Alert logic as per sequence diagram
            if (messageCount > 5) {
                console.error(`[OPERATIONS ALERT] DLQ depth is ${messageCount} (Threshold: 5). Immediate attention required.`);
            }
            return messageCount;
        } catch (error) {
            console.error('Failed to check DLQ depth', error);
            return 0;
        }
    }

    /**
     * Extracts the retry count from RabbitMQ's x-death header.
     * x-death is automatically added by RabbitMQ when a message is dead-lettered.
     */
    private getRetryCount(msg: ConsumeMessage): number {
        const xDeath = msg.properties.headers?.['x-death'];
        if (!xDeath || !Array.isArray(xDeath) || xDeath.length === 0) {
            return 0;
        }
        // x-death[0].count tracks how many times the message has been dead-lettered
        return (xDeath[0] as any).count || 0;
    }

    /**
     * Gracefully closes the RabbitMQ connection.
     * Should be called during application shutdown.
     */
    async disconnect(): Promise<void> {
        try {
            if (this.channel) {
                const channel = this.channel;
                this.channel = null;
                await channel.close();
            }
            if (this.connection) {
                const connection = this.connection;
                this.connection = null;
                await connection.close();
            }
        } catch {
            // Ignore errors during disconnect (connection may already be closed)
        }
    }
}
