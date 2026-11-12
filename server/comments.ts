import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { commentLimit, commentSchema, type CommentDraft, type ReviewComment } from "../shared/turn-diff";

const fileSchema = z.object({ items: z.array(commentSchema) });

// Stores review comments in one file per agent (chat).
export function createCommentStore(root: string) {
  const queues = new Map<string, Promise<unknown>>();
  const file = (agentId: string) =>
    path.join(root, `${createHash("sha256").update(agentId).digest("hex")}.json`);

  async function load(agentId: string): Promise<ReviewComment[]> {
    try {
      return fileSchema.parse(JSON.parse(await readFile(file(agentId), "utf8"))).items;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
      console.warn("[chat-change-review] Unable to read review comments.", error instanceof Error ? error.message : "");
      return [];
    }
  }

  async function save(agentId: string, items: ReviewComment[]) {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const target = file(agentId);
    const temporary = `${target}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify({ items }), { mode: 0o600 });
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  // Serializes writes so the same chat file is never updated concurrently.
  function update(agentId: string, change: (items: ReviewComment[]) => ReviewComment[]) {
    const previous = queues.get(agentId) ?? Promise.resolve();
    const next = previous.then(async () => {
      const items = change(await load(agentId));
      if (items.length > commentLimit) throw new Error(`Up to ${commentLimit} comments are allowed.`);
      await save(agentId, items);
      return { items };
    });
    queues.set(agentId, next.catch(() => undefined));
    return next;
  }

  return {
    list: async (agentId: string) => ({ items: await (queues.get(agentId) ?? Promise.resolve()).then(() => load(agentId)) }),
    save: (agentId: string, id: string | null, comment: CommentDraft) => update(agentId, (items) => {
      const now = new Date().toISOString();
      if (!id) return [...items, { ...comment, id: randomUUID(), createdAt: now, updatedAt: now }];
      if (!items.some((item) => item.id === id)) throw new Error("Comment not found.");
      return items.map((item) => item.id === id ? { ...item, body: comment.body, updatedAt: now } : item);
    }),
    remove: (agentId: string, id: string) => update(agentId, (items) => items.filter((item) => item.id !== id)),
    clear: (agentId: string, ids: readonly string[]) =>
      update(agentId, (items) => items.filter((item) => !ids.includes(item.id))),
  };
}
