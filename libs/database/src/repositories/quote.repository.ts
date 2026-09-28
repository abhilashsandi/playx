
import { injectable, inject } from 'inversify';
import { PrismaClient, Quote } from '@prisma/client';
import { getPrismaClient } from '../prisma-client';

@injectable()
export class QuoteRepository {
    constructor(
        // In a real app, this might be injected as a PrismaService
        // For this demo, we'll instantiate or import the singleton client instance
    ) { }

    private prisma = getPrismaClient();

    async create(jobId: string, data: any): Promise<Quote> {
        return this.prisma.quote.create({
            data: {
                jobId,
                data
            }
        });
    }
}
