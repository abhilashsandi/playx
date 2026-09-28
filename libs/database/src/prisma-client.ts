// ============================================
// PrismaClient Singleton
// Ensures a single database connection is reused across the application
// ============================================

import { PrismaClient } from '@prisma/client';

let prismaInstance: PrismaClient | null = null;

/**
 * Returns a singleton PrismaClient instance.
 * This prevents creating multiple DB connections in development.
 */
export function getPrismaClient(): PrismaClient {
    if (!prismaInstance) {
        prismaInstance = new PrismaClient({
            log: ['warn', 'error'],
        });
    }
    return prismaInstance;
}

/**
 * Gracefully disconnects the Prisma client.
 * Call this during shutdown.
 */
export async function disconnectPrisma(): Promise<void> {
    if (prismaInstance) {
        await prismaInstance.$disconnect();
        prismaInstance = null;
    }
}
