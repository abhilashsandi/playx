// ============================================
// InversifyJS DI Container - Worker bindings
// ============================================
// The worker container includes vendor automations (unlike the API container)
// because the worker is responsible for running Playwright automation.
// ============================================

import { Container } from 'inversify';
import { SERVICE_IDENTIFIERS, IJobRepository } from '@playx/core';
import { IVendorAutomation } from '@playx/core';
import { JobRepository, QuoteRepository } from '@playx/database';
import { RabbitMQClient } from '@playx/messaging';
import { RedisClient } from '@playx/infrastructure';
import { VendorAAutomation, VendorBAutomation, VendorFactory } from '@playx/vendors';
import { JobProcessor } from './job-processor';

export function createContainer(): Container {
    const container = new Container();

    // Infrastructure bindings
    container.bind<RabbitMQClient>(SERVICE_IDENTIFIERS.RabbitMQClient).to(RabbitMQClient).inSingletonScope();
    container.bind<RedisClient>(SERVICE_IDENTIFIERS.RedisClient).to(RedisClient).inSingletonScope();

    // Repository bindings
    container.bind<IJobRepository>(SERVICE_IDENTIFIERS.JobRepository).to(JobRepository).inSingletonScope();
    container.bind(SERVICE_IDENTIFIERS.QuoteRepository).to(QuoteRepository).inSingletonScope();

    // Vendor automation bindings
    // Each vendor gets its own binding — the factory selects the right one
    container.bind<IVendorAutomation>(SERVICE_IDENTIFIERS.VendorAAutomation).to(VendorAAutomation).inTransientScope();
    container.bind<IVendorAutomation>(SERVICE_IDENTIFIERS.VendorBAutomation).to(VendorBAutomation).inTransientScope();

    // Vendor factory (selects vendor based on job payload)
    container.bind<VendorFactory>(SERVICE_IDENTIFIERS.VendorFactory).to(VendorFactory).inSingletonScope();

    // Job processor
    container.bind<JobProcessor>(Symbol.for('JobProcessor')).to(JobProcessor).inSingletonScope();

    return container;
}
