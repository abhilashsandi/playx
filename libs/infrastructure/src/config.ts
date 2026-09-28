// ============================================
// Config - Zod-validated environment configuration
// Validates all required environment variables at startup
// ============================================

import { z } from 'zod';
import * as dotenv from 'dotenv';

// Load .env file from workspace root
dotenv.config();

/** Environment variable schema — validates at startup to fail fast */
const envSchema = z.object({
    // PostgreSQL
    DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL'),

    // RabbitMQ
    RABBITMQ_URL: z.string().min(1, 'RABBITMQ_URL is required'),

    // Redis
    REDIS_HOST: z.string().default('localhost'),
    REDIS_PORT: z.coerce.number().default(6379),

    // Encryption
    ENCRYPTION_KEY: z.string().min(8, 'ENCRYPTION_KEY must be at least 8 characters'),

    // API Server
    API_PORT: z.coerce.number().default(Number(process.env.PORT) || 3000),

    // Vendor Site
    VENDOR_SITE_URL: z.string().url().default('http://localhost:4201'),

    // Browser Automation
    BROWSER_HEADLESS: z
        .string()
        .default('false')
        .transform((val) => val === 'true'),

    // Optional: WebSocket endpoint for connecting to remote browser (Browserless)
    // If set, we use connectOverCDP instead of launching local browser
    // Examples:
    // - Browserless.io (Scale): "wss://chrome.browserless.io?token=YOUR_API_TOKEN"
    // - Self-Hosted Heroku: "wss://my-browser-app.herokuapp.com"
    // - Local/Standard Dyno: Leave empty (uses local Playwright binary + buildpack)
    BROWSER_WS_ENDPOINT: z.string().optional(),

    // Node Environment
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

    // Debugging
    SIMULATED_DELAY_MS: z.coerce.number().default(0),
    SIMULATED_FAILURE_RATE: z.coerce.number().min(0).max(1).default(0),
});

export type AppConfig = z.infer<typeof envSchema>;

let cachedConfig: AppConfig | null = null;

/**
 * Loads and validates environment variables.
 * Throws descriptive errors if any required vars are missing/invalid.
 * Result is cached after first call.
 */
export function loadConfig(): AppConfig {
    if (cachedConfig) return cachedConfig;

    const result = envSchema.safeParse(process.env);

    if (!result.success) {
        const errors = result.error.issues
            .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
            .join('\n');

        throw new Error(`Environment validation failed:\n${errors}`);
    }

    cachedConfig = result.data;
    return cachedConfig;
}
