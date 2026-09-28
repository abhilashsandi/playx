// ============================================
// Job Routes - REST API endpoints for job management
// ============================================
// Endpoints:
//   POST /api/jobs          → Create a new job
//   GET  /api/jobs/:id      → Get job by ID
//   GET  /api/jobs/:id/stream → SSE stream for real-time status updates
// ============================================

import { Router, Request, Response, NextFunction } from 'express';
import { Container } from 'inversify';
import { SERVICE_IDENTIFIERS } from '@playx/core';
import { RedisClient, createLogger } from '@playx/infrastructure';
import { CreateJobDto, VendorType } from '@playx/shared-types';
import { JobService } from '../services/job.service';

const logger = createLogger('job-routes');

export function createJobRoutes(container: Container): Router {
    const router = Router();
    const jobService = container.get<JobService>(SERVICE_IDENTIFIERS.JobService);
    const redis = container.get<RedisClient>(SERVICE_IDENTIFIERS.RedisClient);

    // ============================================
    // POST /api/jobs - Create a new automation job
    // ============================================
    // FLOW:
    // 1. Validate request body
    // 2. Call JobService.createJob (DB insert + RabbitMQ publish)
    // 3. Return jobId immediately (async processing happens in worker)
    // ============================================
    router.post('/jobs', async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { name, email, quoteId, vendor } = req.body as CreateJobDto;

            // Basic validation
            if (!name || !email || !quoteId || !vendor) {
                res.status(400).json({
                    error: 'Missing required fields: name, email, quoteId, vendor',
                });
                return;
            }

            if (!Object.values(VendorType).includes(vendor)) {
                res.status(400).json({
                    error: `Invalid vendor type. Supported: ${Object.values(VendorType).join(', ')}`,
                });
                return;
            }

            const dto: CreateJobDto = { name, email, quoteId, vendor };
            const jobId = await jobService.createJob(dto);

            logger.info({ jobId }, 'Job created successfully');

            // Return jobId immediately — frontend uses this to subscribe to SSE
            res.status(201).json({ jobId });
        } catch (error) {
            next(error);
        }
    });

    // ============================================
    // GET /api/jobs/:id - Get job details
    // ============================================
    router.get('/jobs/:id', async (req: Request, res: Response, next: NextFunction) => {
        try {
            const job = await jobService.getJob(req.params.id as string);
            if (!job) {
                res.status(404).json({ error: 'Job not found' });
                return;
            }
            res.json(job);
        } catch (error) {
            next(error);
        }
    });

    // ============================================
    // GET /api/jobs/:id/stream - SSE for real-time status updates
    // ============================================
    // KEY ASYNC FLOW POINT:
    // This endpoint bridges Redis pub/sub → SSE → Frontend:
    // 1. Worker updates job status and publishes to Redis channel job.status.{jobId}
    // 2. This endpoint subscribes to that Redis channel
    // 3. When a message arrives, it's forwarded to the frontend as an SSE event
    // 4. Frontend EventSource receives the event and updates the UI
    //
    // CONNECTION LIFECYCLE:
    // - Client connects → subscribe to Redis channel
    // - Status update arrives → forward as SSE event
    // - Client disconnects → unsubscribe from Redis channel
    // ============================================
    router.get('/jobs/:id/stream', async (req: Request, res: Response) => {
        const jobId = req.params.id;

        // Verify job exists before opening SSE connection
        const job = await jobService.getJob(jobId as string);
        if (!job) {
            res.status(404).json({ error: 'Job not found' });
            return;
        }

        // SSE headers — keep connection alive, disable caching
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'Access-Control-Allow-Origin': '*',
        });

        // Send initial job status
        res.write(`data: ${JSON.stringify(job)}\n\n`);

        // If job is already in a terminal state, close immediately
        if (job.status === 'COMPLETED' || job.status === 'FAILED') {
            res.end();
            return;
        }

        // Subscribe to Redis pub/sub for this job's status channel
        // When worker publishes a status update, it arrives here
        logger.info({ jobId }, 'SSE client connected, subscribing to Redis channel');

        await redis.subscribeToJob(jobId as string, (_channel: string, message: string) => {
            // Forward Redis message as SSE event to frontend
            res.write(`data: ${message}\n\n`);
        });

        // Keep-alive heartbeat every 15 seconds (prevents proxy timeouts)
        const heartbeat = setInterval(() => {
            res.write(': heartbeat\n\n');
        }, 15000);

        // Clean up when client disconnects
        req.on('close', async () => {
            logger.info({ jobId }, 'SSE client disconnected, unsubscribing from Redis');
            clearInterval(heartbeat);
            await redis.unsubscribeFromJob(jobId as string);
        });
    });

    // ============================================
    // GET /admin/stats - System statistics (DLQ depth)
    // ============================================
    router.get('/admin/stats', async (req: Request, res: Response, next: NextFunction) => {
        try {
            const stats = await jobService.getSystemStats();
            res.json(stats);
        } catch (error) {
            next(error);
        }
    });

    return router;
}
