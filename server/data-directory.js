import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Keep writable runtime data separate from source when a host provides a volume.
export function getDataDirectory(override) {
  return resolve(override || process.env.DATA_DIR || fileURLToPath(new URL('../data/', import.meta.url)));
}
