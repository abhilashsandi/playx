// ============================================
// API Server - Express application bootstrap
// ============================================
// This is the main entry point for the REST API server.
// It sets up:
// 1. InversifyJS dependency injection container
// 2. Express middleware (CORS, JSON parsing, error handling)
// 3. REST routes for job management
// 4. Connections to RabbitMQ and Redis
// 5. Graceful shutdown handling
// ============================================

import 'reflect-metadata';
import express from 'express';
import cors from 'cors';
import { createLogger, loadConfig } from '@playx/infrastructure';
import { createContainer } from './container';
import { createJobRoutes } from './routes/job.routes';
import { errorHandler } from './middleware/error-handler';
import { SERVICE_IDENTIFIERS } from '@playx/core';
import { RabbitMQClient } from '@playx/messaging';
import { RedisClient } from '@playx/infrastructure';

const logger = createLogger('api');

async function main() {
    // Validate environment variables at startup (fail fast)
    const config = loadConfig();
    logger.info('Configuration validated successfully');

    // Set up InversifyJS DI container
    const container = createContainer();

    // Connect to infrastructure services
    const rabbitMQ = container.get<RabbitMQClient>(SERVICE_IDENTIFIERS.RabbitMQClient);
    const redis = container.get<RedisClient>(SERVICE_IDENTIFIERS.RedisClient);

    await rabbitMQ.connect(config.RABBITMQ_URL);
    logger.info('Connected to RabbitMQ');

    await redis.connect(config.REDIS_HOST, config.REDIS_PORT);
    logger.info('Connected to Redis');

    // Create Express app
    const app = express();

    // Middleware
    app.use(cors());
    app.use(express.json());

    // Health check endpoint
    app.get('/health', (_req, res) => {
        res.json({ status: 'ok', service: 'api' });
    });

    // Mount job routes
    app.use('/api', createJobRoutes(container));

    // Centralized error handling (must be last middleware)
    app.use(errorHandler);

    // Start server
    const server = app.listen(config.API_PORT, () => {
        logger.info(`API server listening on port ${config.API_PORT}`);
        logger.info(`Health check: http://localhost:${config.API_PORT}/health`);
    });

    // ============================================
    // Graceful Shutdown
    // On SIGTERM/SIGINT: close server, disconnect from RabbitMQ and Redis
    // ============================================
    const shutdown = async (signal: string) => {
        logger.info(`Received ${signal}. Starting graceful shutdown...`);

        server.close(async () => {
            logger.info('HTTP server closed');
            await rabbitMQ.disconnect();
            logger.info('RabbitMQ disconnected');
            await redis.disconnect();
            logger.info('Redis disconnected');
            process.exit(0);
        });

        // Force exit after 10 seconds if graceful shutdown hangs
        setTimeout(() => {
            logger.error('Forced shutdown after timeout');
            process.exit(1);
        }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
    logger.error(error, 'Failed to start API server');
    process.exit(1);
});
