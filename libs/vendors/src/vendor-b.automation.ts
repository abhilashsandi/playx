// ============================================
// VendorB Automation - Playwright-based browser automation
// ============================================
// For demo purposes, this is a clone of VendorAAutomation.
// In a real scenario, this would have different selectors or logic.
// ============================================

import { injectable } from 'inversify';
import { chromium, Browser, Page } from 'playwright';
import { IVendorAutomation } from '@playx/core';
import { CreateJobDto, VendorResult } from '@playx/shared-types';
import { loadConfig } from '@playx/infrastructure';

@injectable()
export class VendorBAutomation implements IVendorAutomation {
    async run(jobData: CreateJobDto): Promise<VendorResult> {
        const config = loadConfig();
        let browser: Browser | null = null;

        try {
            browser = await chromium.launch({
                headless: config.BROWSER_HEADLESS,
            });

            const context = await browser.newContext();
            const page: Page = await context.newPage();

            await page.goto(config.VENDOR_SITE_URL, { waitUntil: 'networkidle' });

            // Using the same selectors as VendorA for the mock site
            await page.fill('#name', jobData.name);
            await page.fill('#email', jobData.email);
            await page.fill('#quoteId', jobData.quoteId);

            await page.click('#submit-btn');

            await page.waitForSelector('#result, #error', { timeout: 30000 });

            const errorElement = await page.$('#error');
            if (errorElement) {
                const errorText = await errorElement.textContent();
                throw new Error(`Vendor B error: ${errorText || 'Unknown vendor error'}`);
            }

            const resultElement = await page.$('#result');
            if (!resultElement) {
                throw new Error('Result element not found on vendor page');
            }
            const scrapedText = await resultElement.textContent();

            if (!scrapedText) {
                throw new Error('Empty result scraped from vendor page');
            }

            return {
                success: true,
                data: `[VendorB] ${scrapedText.trim()}`,
                scrapedAt: new Date().toISOString(),
            };
        } finally {
            if (browser) {
                await browser.close();
            }
        }
    }
}
