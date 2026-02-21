import fs from 'fs';
import path from 'path';
import os from 'os';
import { startDaemon } from './server';
import { log } from './logger';

// Ensure ~/.0ctx dir exists
const DIR = path.join(os.homedir(), '.0ctx');
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

void startDaemon().catch(error => {
    log('error', 'daemon_startup_failed', {
        error: error instanceof Error ? error.message : String(error)
    });
    process.exit(1);
});
