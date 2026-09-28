// ============================================
// IVendorAutomation - Extensible vendor plugin interface
// ============================================
// To add a new vendor:
// 1. Create a new class implementing IVendorAutomation
// 2. Register it in the VendorFactory
// 3. Add the vendor type to VendorType enum in shared-types

import { CreateJobDto, VendorResult } from '@playx/shared-types';

export interface IVendorAutomation {
    /**
     * Runs the browser automation for this vendor.
     * Launches Playwright, navigates to vendor site, fills form,
     * submits, and scrapes the result.
     *
     * @param jobData - The job input payload
     * @returns VendorResult with scraped data
     * @throws Error if automation fails (triggers retry)
     */
    run(jobData: CreateJobDto): Promise<VendorResult>;
}
