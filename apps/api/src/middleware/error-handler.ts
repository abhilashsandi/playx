// ============================================
// Centralized Error Handler - Express middleware
// ============================================

import { Request, Response, NextFunction } from 'express';
import { createLogger } from '@playx/infrastructure';

const logger = createLogger('error-handler');

/**
 * Centralized Express error-handling middleware.
 * Must be registered LAST in the middleware chain.
 * Catches all unhandled errors from route handlers.
 */
export function errorHandler(
    err: Error,
    _req: Request,
    res: Response,
    _next: NextFunction
): void {
    logger.error(err, 'Unhandled error');

    res.status(500).json({
        error: 'Internal server error',
        message: process.env['NODE_ENV'] === 'development' ? err.message : undefined,
    });
}
