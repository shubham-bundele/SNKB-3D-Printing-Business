import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';

async function main() {
  const server = spawn('node', ['src/server.js'], {
    env: { ...process.env, PORT: '3200' },
    stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 2000));

  const browser = await chromium.launch();
  const page = await browser.newPage();

  page.on('console', (msg) => console.log('BROWSER CONSOLE:', msg.type(), msg.text()));
  page.on('pageerror', (err) => console.log('BROWSER PAGEERROR:', err));

  await page.goto('http://127.0.0.1:3200');

  const fileInput = await page.$('input[type="file"]');
  console.log('Setting input files...');
  const samplePath = path.join(process.cwd(), 'public', 'samples', 'cube_20mm_binary.stl');
  await fileInput.setInputFiles(samplePath);

  await page.waitForTimeout(3000);

  const breakdown = await page.getByText('Instant 3D Print Quote Breakdown').isVisible();
  console.log('Breakdown visible:', breakdown);

  const errorText = await page.locator('.bg-rose-950\\/60').textContent().catch(() => null);
  console.log('Error text:', errorText);

  await browser.close();
  server.kill();
}

main().catch(console.error);
