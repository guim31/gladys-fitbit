// -----------------------------------------------------------------------------
// What the integration keeps under /data, the only writable volume of the
// container: the Google tokens, the account id (so the device keeps its
// identifiers while Google is unreachable) and what the scene triggers
// already announced (a restart never fires "woke up" twice for one night).
//
// One JSON file, written whole to a temporary file then renamed: a crash in
// the middle of a write never leaves half a refresh token behind. Mode 0600:
// the tokens open the health data of the account.
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const DEFAULT_DATA_DIR = '/data';
const FILE = 'fitbit.json';

export class Store {
  /** @param {string} [dir] */
  constructor(dir = process.env.DATA_DIR || DEFAULT_DATA_DIR) {
    this.dir = dir;
    this.path = join(dir, FILE);
    this.data = null;
    this.writing = Promise.resolve();
  }

  /** Reads the file once; a missing or broken file is an empty store. */
  async load() {
    if (this.data) {
      return this.data;
    }
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8'));
      this.data = parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      this.data = {};
    }
    return this.data;
  }

  async get(key) {
    const data = await this.load();
    return data[key];
  }

  /**
   * Replace one top-level key (undefined removes it) and write the file.
   * Writes are chained: the last call always lands last.
   */
  async set(key, value) {
    const data = await this.load();
    if (value === undefined) {
      delete data[key];
    } else {
      data[key] = value;
    }
    const snapshot = JSON.stringify(data);
    this.writing = this.writing
      .catch(() => {})
      .then(async () => {
        await mkdir(this.dir, { recursive: true });
        const tmp = `${this.path}.tmp`;
        await writeFile(tmp, snapshot, { mode: 0o600 });
        await rename(tmp, this.path);
      });
    return this.writing;
  }

  /** Wait for the pending write (shutdown). */
  async flush() {
    await this.writing.catch(() => {});
  }
}
