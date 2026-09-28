// ============================================
// InversifyJS Service Identifiers (Symbol tokens)
// These symbols are used as binding keys throughout the DI container
// ============================================

export const SERVICE_IDENTIFIERS = {
    // Domain Services
    JobService: Symbol.for('JobService'),
    VendorFactory: Symbol.for('VendorFactory'),

    // Infrastructure
    RabbitMQClient: Symbol.for('RabbitMQClient'),
    RedisClient: Symbol.for('RedisClient'),
    JobRepository: Symbol.for('JobRepository'),
    QuoteRepository: Symbol.for('QuoteRepository'),

    // Vendor Automations
    VendorAAutomation: Symbol.for('VendorAAutomation'),
    VendorBAutomation: Symbol.for('VendorBAutomation'),

    // Config & Logging
    Logger: Symbol.for('Logger'),
    Config: Symbol.for('Config'),
} as const;
