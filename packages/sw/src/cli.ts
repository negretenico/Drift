#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync } from "fs";
import { join, resolve } from "path";

const args = process.argv.slice(2);
const targetDir = args[0] || "./public";

const workerFileName = "service-worker.js";
const sourceFile = join(__dirname, workerFileName);
const targetPath = resolve(process.cwd(), targetDir);
const targetFile = join(targetPath, workerFileName);

try {
  // Create target directory if it doesn't exist
  if (!existsSync(targetPath)) {
    mkdirSync(targetPath, { recursive: true });
  }

  // Copy the service worker file
  copyFileSync(sourceFile, targetFile);

  console.log(`✓ Drift service worker copied to: ${targetFile}`);
  console.log(`\nNext steps:`);
  console.log(`1. Register the service worker in your app:`);
  console.log(
    `   import { registerDriftServiceWorker } from '@negretenico/sw';`
  );
  console.log(`   await registerDriftServiceWorker();`);
} catch (error) {
  console.error(`✗ Failed to copy service worker:`, error);
  process.exit(1);
}
