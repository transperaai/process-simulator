// Scratch (not committed): the demo Clients page.
import { chromium } from "playwright-core";

const OUT = "/tmp/claude-0/-home-user-transpera-flow/5eb2e1e9-20d8-56ff-a806-3260d09fbb09/scratchpad/shots19";
const BASE = "http://localhost:3119";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("response", (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
await page.goto(`${BASE}/demo/clients`);
await page.waitForTimeout(8000);
await page.screenshot({ path: `${OUT}/05-demo-clients.png`, fullPage: false });
console.log((await page.locator("main").innerText()).slice(0, 1500));
console.log("errors:", errors);
await browser.close();
