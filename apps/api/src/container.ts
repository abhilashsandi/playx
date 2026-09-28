// ============================================
// InversifyJS DI Container - API Server bindings
// ============================================
// Binds all service implementations to their interfaces.
// This is the composition root where dependencies are wired together.
// ============================================

import { Container } from 'inversify';
import { SERVICE_IDENTIFIERS } from '@playx/core';
import { IJobRepository } from '@playx/core';
import { JobRepository } from '@playx/database';
import { RabbitMQClient } from '@playx/messaging';
import { RedisClient } from '@playx/infrastructure';
import { JobService } from './services/job.service';

export function createContainer(): Container {
    const container = new Container();

    // Infrastructure bindings
    container.bind<RabbitMQClient>(SERVICE_IDENTIFIERS.RabbitMQClient).to(RabbitMQClient).inSingletonScope();
    container.bind<RedisClient>(SERVICE_IDENTIFIERS.RedisClient).to(RedisClient).inSingletonScope();

    // Repository bindings
    container.bind<IJobRepository>(SERVICE_IDENTIFIERS.JobRepository).to(JobRepository).inSingletonScope();

    // Service bindings
    container.bind<JobService>(SERVICE_IDENTIFIERS.JobService).to(JobService).inSingletonScope();

    return container;
}
