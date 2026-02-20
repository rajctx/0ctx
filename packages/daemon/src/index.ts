import fs from 'fs';
import path from 'path';
import os from 'os';
import { startDaemon } from './server';

// Ensure ~/.0ctx dir exists
const DIR = path.join(os.homedir(), '.0ctx');
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

startDaemon();
