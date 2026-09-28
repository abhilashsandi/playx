// ============================================
// Vendor Factory - Factory pattern for vendor selection
// ============================================
// HOW TO EXTEND:
// 1. Add a new VendorType to the enum in shared-types
// 2. Create a new class implementing IVendorAutomation
// 3. Bind it in the DI container (apps/worker/src/container.ts)
// 4. Add a case to the switch statement below
// ============================================

import { injectable, inject } from 'inversify';
import { IVendorAutomation } from '@playx/core';
import { SERVICE_IDENTIFIERS } from '@playx/core';
import { VendorType } from '@playx/shared-types';

@injectable()
export class VendorFactory {
    constructor(
        @inject(SERVICE_IDENTIFIERS.VendorAAutomation)
        private vendorA: IVendorAutomation,
        @inject(SERVICE_IDENTIFIERS.VendorBAutomation)
        private vendorB: IVendorAutomation
    ) { }

    /**
     * Returns the vendor automation implementation for the given vendor type.
     * Uses the Factory pattern to decouple job processing from vendor specifics.
     *
     * @param vendorType - The vendor type from the job payload
     * @returns The matching IVendorAutomation implementation
     * @throws Error if vendor type is unsupported
     */
    getVendor(vendorType: VendorType): IVendorAutomation {
        switch (vendorType) {
            case VendorType.VENDOR_A:
                return this.vendorA;

            // To add a new vendor:
            case VendorType.VENDOR_B:
                return this.vendorB;

            default:
                throw new Error(`Unsupported vendor type: ${vendorType}`);
        }
    }
}
