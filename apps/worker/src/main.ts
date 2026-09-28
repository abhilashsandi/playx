// ============================================
// Worker Process - Main entry point
// ============================================
// The worker is a standalone Node.js process that:
// 1. Connects to RabbitMQ and Redis
// 2. Consumes encrypted job messages from the automation.jobs queue
// 3. Processes each job using the Playwright-based vendor automation
// 4. Updates job status via Redis pub/sub (→ API SSE → Frontend)
//
// ISOLATION: The worker runs independently from the API server.
// It can be scaled horizontally by running multiple instances.
// ============================================

import 'reflect-metadata';
import { createLogger, loadConfig } from '@playx/infrastructure';
import { createContainer } from './container';
import { SERVICE_IDENTIFIERS } from '@playx/core';
import { RabbitMQClient } from '@playx/messaging';
import { RedisClient } from '@playx/infrastructure';
import { JobProcessor } from './job-processor';

const logger = createLogger('worker');

async function main() {
    const config = loadConfig();
    logger.info('Worker starting...');
    logger.info({ headless: config.BROWSER_HEADLESS }, 'Browser automation mode');

    // Set up DI container (different from API — includes vendor automations)
    const container = createContainer();

    // Connect to infrastructure
    const rabbitMQ = container.get<RabbitMQClient>(SERVICE_IDENTIFIERS.RabbitMQClient);
    const redis = container.get<RedisClient>(SERVICE_IDENTIFIERS.RedisClient);

    await rabbitMQ.connect(config.RABBITMQ_URL);
    logger.info('Connected to RabbitMQ');

    await redis.connect(config.REDIS_HOST, config.REDIS_PORT);
    logger.info('Connected to Redis');

    // Start consuming jobs
    const processor = container.get<JobProcessor>(Symbol.for('JobProcessor'));
    await processor.start();

    logger.info('Worker is now consuming jobs from automation.jobs queue');

    // Start periodic DLQ depth check (Operations Alerting)
    setInterval(async () => {
        await rabbitMQ.checkDlqDepth();
    }, 60000); // Check every minute

    // ============================================
    // Graceful Shutdown
    // ============================================
    const shutdown = async (signal: string) => {
        logger.info(`Received ${signal}. Shutting down worker...`);
        await rabbitMQ.disconnect();
        logger.info('RabbitMQ disconnected');
        await redis.disconnect();
        logger.info('Redis disconnected');
        process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
    logger.error(error, 'Failed to start worker');
    process.exit(1);
});
