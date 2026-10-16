// Where the app keeps its data: license, settings, browser profiles, bet logs.
// Windows: %LOCALAPPDATA%\ChainPilot (the program itself is read-only under Programs).
import os from 'node:os';
import path from 'node:path';
import { PRODUCT } from '../src/product.js';

export function dataDir() {
  if (process.env.CHAINPILOT_DATA_DIR) return path.resolve(process.env.CHAINPILOT_DATA_DIR);
  const home = os.homedir();
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), PRODUCT.name);
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', PRODUCT.name);
  return path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), PRODUCT.id);
}
