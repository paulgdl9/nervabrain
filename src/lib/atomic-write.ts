import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const fileQueues = new Map<string, Promise<unknown>>();

export class FileWriteConflictError extends Error {
  readonly code = "VAULT_WRITE_CONFLICT";

  constructor(
    readonly filePath: string,
    readonly expectedMtime: string,
    readonly actualMtime: string | null,
  ) {
    super(`File changed since it was read: ${filePath}`);
    this.name = "FileWriteConflictError";
  }
}

/** Serialize all mutations of one path inside this process. */
export function withFileWriteLock<T>(filePath: string, task: () => Promise<T>): Promise<T> {
  const key = path.resolve(filePath);
  const previous = fileQueues.get(key) ?? Promise.resolve();
  const operation = previous.catch(() => undefined).then(task);
  fileQueues.set(key, operation);
  return operation.finally(() => {
    if (fileQueues.get(key) === operation) fileQueues.delete(key);
  });
}

/**
 * Write in the destination directory, fsync, then atomically rename the file.
 * expectedMtime enables optimistic concurrency for edits made from a stale UI.
 */
export function atomicWriteFile(
  filePath: string,
  content: string | Uint8Array,
  options: { expectedMtime?: string; mode?: number } = {},
): Promise<void> {
  return withFileWriteLock(filePath, async () => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const currentStat = await fs.stat(filePath).catch(() => null);
    if (options.expectedMtime) {
      const actual = currentStat?.mtime.toISOString() ?? null;
      if (actual !== options.expectedMtime) {
        throw new FileWriteConflictError(filePath, options.expectedMtime, actual);
      }
    }

    const tempPath = path.join(
      path.dirname(filePath),
      `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
    );
    let handle: fs.FileHandle | undefined;
    try {
      handle = await fs.open(
        tempPath,
        "wx",
        options.mode ?? (currentStat ? currentStat.mode & 0o777 : 0o600),
      );
      // fs.open applies the process umask. Shared vault files need the exact
      // requested group bits even when the container runs with umask 0077.
      if (options.mode !== undefined) await handle.chmod(options.mode);
      await handle.writeFile(content);
      await handle.sync();
      await handle.close();
      handle = undefined;
      await fs.rename(tempPath, filePath);

      // Persist the directory entry where the platform supports directory fsync.
      const directory = await fs.open(path.dirname(filePath), "r").catch(() => null);
      if (directory) {
        await directory.sync().catch(() => undefined);
        await directory.close().catch(() => undefined);
      }
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await fs.unlink(tempPath).catch(() => undefined);
      throw error;
    }
  });
}
