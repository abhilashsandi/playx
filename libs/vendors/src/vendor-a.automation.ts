// ============================================
// VendorA Automation - Playwright-based browser automation
// ============================================
// PLAYWRIGHT SCRAPING FLOW:
// 1. Launch Chromium browser (headless: false for local dev)
// 2. Navigate to mock vendor site
// 3. Fill out the form (name, email, quoteId)
// 4. Click submit and wait for result
// 5. Scrape the result text from the DOM
// 6. Return scraped data as VendorResult
// 7. Close browser
//
// This is the core integration point where browser automation
// produces real data from vendor websites.
// ============================================

import { injectable } from 'inversify';
import { chromium, Browser, Page } from 'playwright';
import { IVendorAutomation } from '@playx/core';
import { CreateJobDto, VendorResult } from '@playx/shared-types';
import { loadConfig } from '@playx/infrastructure';

@injectable()
export class VendorAAutomation implements IVendorAutomation {
    /**
     * Runs browser automation against the mock VendorA website.
     *
     * STEP-BY-STEP:
     * 1. Launch browser (headless configurable via BROWSER_HEADLESS env var)
     * 2. Navigate to vendor site URL
     * 3. Fill form fields using Playwright selectors
     * 4. Submit form
     * 5. Wait for result to appear (vendor simulates processing delay)
     * 6. Scrape result text from the DOM
     * 7. Close browser and return result
     *
     * @throws Error if the vendor site shows an error or navigation fails
     */
    async run(jobData: CreateJobDto): Promise<VendorResult> {
        const config = loadConfig();
        let browser: Browser | null = null;

        try {
            // STEP 1: Connect to or Launch browser
            if (config.BROWSER_WS_ENDPOINT) {
                // Remote browser (Browserless/Docker) - critical for Heroku scale
                browser = await chromium.connectOverCDP(config.BROWSER_WS_ENDPOINT);
            } else {
                // Local browser (Dev/Test)
                browser = await chromium.launch({
                    headless: config.BROWSER_HEADLESS,
                });
            }

            // Use independent context for each job (Best Practice)
            const context = await browser.newContext();
            const page: Page = await context.newPage();

            // STEP 2: Navigate to the mock vendor site
            await page.goto(config.VENDOR_SITE_URL, { waitUntil: 'networkidle' });

            // STEP 3: Fill form fields
            // These selectors match the mock vendor-site form inputs
            await page.fill('#name', jobData.name);
            await page.fill('#email', jobData.email);
            await page.fill('#quoteId', jobData.quoteId);

            // STEP 4: Submit the form
            await page.click('#submit-btn');

            // STEP 5: Wait for result to appear
            // The vendor site simulates a processing delay (1-3 seconds)
            // We wait for either the success result or error message to appear
            await page.waitForSelector('#result, #error', { timeout: 30000 });

            // STEP 6: Check for errors (vendor simulates 10% failure rate)
            const errorElement = await page.$('#error');
            if (errorElement) {
                const errorText = await errorElement.textContent();
                throw new Error(`Vendor error: ${errorText || 'Unknown vendor error'}`);
            }

            // STEP 7: Scrape the result text from the DOM
            const resultElement = await page.$('#result');
            if (!resultElement) {
                throw new Error('Result element not found on vendor page');
            }
            const scrapedText = await resultElement.textContent();

            if (!scrapedText) {
                throw new Error('Empty result scraped from vendor page');
            }

            // Return the scraped result — this gets saved to result_payload in DB
            return {
                success: true,
                data: scrapedText.trim(),
                scrapedAt: new Date().toISOString(),
            };
        } finally {
            // STEP 8: Always close the browser connection
            // Note: For connectOverCDP, .close() disconnects but doesn't kill the remote process (usually)
            // unless we are sharing a browser instance (we aren't here, we connect new each time)
            if (browser) {
                await browser.close();
            }
        }
    }
}
