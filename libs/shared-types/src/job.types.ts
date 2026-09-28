// ============================================
// Job Types - Core domain types shared across all services
// ============================================

/** Supported vendor types — extend this enum to add new vendors */
export enum VendorType {
    VENDOR_A = 'VENDOR_A',
    VENDOR_B = 'VENDOR_B',
}

/** Job lifecycle status */
export enum JobStatus {
    PENDING = 'PENDING',
    IN_PROGRESS = 'IN_PROGRESS',
    COMPLETED = 'COMPLETED',
    FAILED = 'FAILED',
}

/** DTO for creating a new job (from frontend → API) */
export interface CreateJobDto {
    name: string;
    email: string;
    quoteId: string;
    vendor: VendorType;
    maxRetries?: number;
}

/** Full job response (API → frontend) */
export interface JobResponse {
    id: string;
    vendor: VendorType;
    status: JobStatus;
    inputPayload: CreateJobDto;
    resultPayload: VendorResult | null;
    errorMessage: string | null;
    createdAt: string;
    updatedAt: string;
}

/** Result from vendor automation (scraped data) */
export interface VendorResult {
    success: boolean;
    data: string;
    scrapedAt: string;
}

/** Message payload published to RabbitMQ (encrypted) */
export interface JobMessage {
    jobId: string;
    vendor: VendorType;
    payload: CreateJobDto;
    retryConfig?: {
        maxRetries: number;
    };
}
