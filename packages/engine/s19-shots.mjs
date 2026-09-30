// Scratch (not committed): screenshots of /demo for issue #19.
import { chromium } from "playwright-core";

const OUT = "/tmp/claude-0/-home-user-transpera-flow/5eb2e1e9-20d8-56ff-a806-3260d09fbb09/scratchpad/shots19";
const BASE = "http://localhost:3119";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const errors = [];
const open = async (url, width = 1440, height = 1000) => {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on("pageerror", (e) => errors.push(`${url}: ${e}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${url}: ${m.text()}`));
  await page.goto(`${BASE}${url}`);
  return page;
};
const waitSim = (page) => page.waitForFunction(() => /Average of \d+ replications/.test(document.body.innerText), null, { timeout: 60000 });
const waitRoster = (page) => page.waitForFunction(() => /Lowest simulated health/.test(document.body.innerText), null, { timeout: 60000 });

let page = await open("/demo");
await waitSim(page);
await page.screenshot({ path: `${OUT}/01-demo-pipeline.png` });
console.log("KPI:", (await page.locator('section[aria-label="Key results"]').innerText()).replace(/\n+/g, " | "));
await page.locator('section[aria-label="Key results"]').screenshot({ path: `${OUT}/02-kpi-strip.png` });
await page.getByRole("tab", { name: /Issues/ }).first().click();
await page.waitForTimeout(500);
console.log("churn issues:", await page.getByText(/at risk of churning/).allInnerTexts());
await page.screenshot({ path: `${OUT}/03-demo-issues-rail.png` });
await page.close();

page = await open("/demo?process=c0000000-0000-4000-8000-000000000002");
await waitSim(page);
await page.screenshot({ path: `${OUT}/04-demo-monthly-report.png` });
console.log("banner:", await page.locator('section[aria-label="Servicing process"]').innerText());
await page.close();

page = await open("/demo?process=c0000000-0000-4000-8000-000000000003");
await waitSim(page);
await page.screenshot({ path: `${OUT}/05-demo-checkin.png` });
await page.close();

page = await open("/demo/clients", 1440, 1100);
await waitRoster(page);
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/06-demo-clients.png` });
console.log("retention:", (await page.locator('section[aria-labelledby="retention-heading"]').innerText()).replace(/\n+/g, " | "));
const chips = await page.getByText(/^Simulated \d+/).allInnerTexts();
console.log("chips:", chips.length, chips.slice(0, 3));
await page.close();

page = await open("/demo/clients", 390, 900);
await waitRoster(page);
await page.screenshot({ path: `${OUT}/08-demo-clients-phone.png` });
console.log("phone horizontal overflow (clients):", await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth));
await page.close();

page = await open("/demo?process=c0000000-0000-4000-8000-000000000002", 390, 900);
await waitSim(page);
await page.screenshot({ path: `${OUT}/09-demo-report-phone.png` });
console.log("phone horizontal overflow (report):", await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth));
await page.close();

console.log("errors:", errors);
await browser.close();
