// ============================================
// Logger - Pino-based structured logging
// ============================================

import pino from 'pino';

/**
 * Creates a pino logger instance with a service name.
 * Uses pino-pretty in development for human-readable output.
 *
 * @param serviceName - Name of the service (e.g., 'api', 'worker')
 */
export function createLogger(serviceName: string): pino.Logger {
    const isDev = process.env['NODE_ENV'] !== 'production';

    return pino({
        name: serviceName,
        level: isDev ? 'debug' : 'info',
        transport: isDev
            ? {
                target: 'pino-pretty',
                options: {
                    colorize: true,
                    translateTime: 'SYS:standard',
                    ignore: 'pid,hostname',
                },
            }
            : undefined,
    });
}
