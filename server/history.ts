import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { historyLimit, recordSchema } from "../shared/turn-diff";
import type { z } from "zod";

type Record = z.infer<typeof recordSchema>;
const retentionMs = 14 * 24 * 60 * 60 * 1000;

export function createHistory(root: string) {
  const directory = (agentId: string) => path.join(root, createHash("sha256").update(agentId).digest("hex"));

  async function read(agentId: string, id: string) {
    const raw = await readFile(path.join(directory(agentId), `${id}.json`), "utf8");
    const record = recordSchema.parse(JSON.parse(raw));
    if (Date.parse(record.turn.endedAt) < Date.now() - retentionMs)
      throw new Error("This record has expired.");
    return record;
  }

  async function recent(agentId: string) {
    const dir = directory(agentId);
    const files = await readdir(dir).catch((error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
      throw error;
    });
    const entries = await Promise.all(files.filter((file) => file.endsWith(".json")).map(async (file) => {
      const info = await stat(path.join(dir, file)).catch(() => null);
      return info ? { id: file.slice(0, -5), modified: info.mtimeMs } : null;
    }));
    return entries.filter((entry) => entry !== null).sort((left, right) => right.modified - left.modified);
  }

  return {
    read,
    async save(agentId: string, record: Record) {
      const dir = directory(agentId);
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const target = path.join(dir, `${record.turn.id}.json`);
      const temporary = `${target}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(record), { mode: 0o600, flag: "wx" });
        await rename(temporary, target);
      } finally {
        await rm(temporary, { force: true });
      }
      const entries = await recent(agentId);
      const cutoff = Date.now() - retentionMs;
      await Promise.all(entries
        .filter((entry, index) => index >= historyLimit || entry.modified < cutoff)
        .map((entry) => rm(path.join(dir, `${entry.id}.json`), { force: true })));
    },
    async list(agentId: string) {
      const entries = (await recent(agentId)).filter((entry) => entry.modified >= Date.now() - retentionMs);
      const records = await Promise.all(entries.slice(0, historyLimit).map((entry) =>
        read(agentId, entry.id).catch(() => null)
      ));
      return records.flatMap((record) => record ? [record.turn] : []);
    },
  };
}
