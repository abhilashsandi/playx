// ============================================
// JobRepository - Prisma-backed implementation of IJobRepository
// Uses InversifyJS @injectable() for dependency injection
// ============================================

import { injectable } from 'inversify';
import { PrismaClient } from '@prisma/client';
import { IJobRepository, JobRecord } from '@playx/core';
import { JobStatus, VendorResult } from '@playx/shared-types';
import { getPrismaClient } from './prisma-client';

@injectable()
export class JobRepository implements IJobRepository {
    private prisma: PrismaClient;

    constructor() {
        this.prisma = getPrismaClient();
    }

    async create(data: {
        id: string;
        vendor: string;
        status: JobStatus;
        inputPayload: unknown;
    }): Promise<JobRecord> {
        const job = await this.prisma.job.create({
            data: {
                id: data.id,
                vendor: data.vendor,
                status: data.status,
                inputPayload: data.inputPayload as any,
            },
        });

        return this.toJobRecord(job);
    }

    async findById(id: string): Promise<JobRecord | null> {
        const job = await this.prisma.job.findUnique({ where: { id } });
        return job ? this.toJobRecord(job) : null;
    }

    async updateStatus(id: string, status: JobStatus): Promise<void> {
        await this.prisma.job.update({
            where: { id },
            data: { status },
        });
    }

    async updateResult(id: string, result: VendorResult): Promise<void> {
        await this.prisma.job.update({
            where: { id },
            data: {
                status: JobStatus.COMPLETED,
                resultPayload: result as any,
            },
        });
    }

    async updateError(id: string, errorMessage: string): Promise<void> {
        await this.prisma.job.update({
            where: { id },
            data: {
                status: JobStatus.FAILED,
                errorMessage,
            },
        });
    }

    private toJobRecord(job: any): JobRecord {
        return {
            id: job.id,
            vendor: job.vendor,
            status: job.status,
            inputPayload: job.inputPayload,
            resultPayload: job.resultPayload,
            errorMessage: job.errorMessage,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt,
        };
    }
}
