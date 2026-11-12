import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const kind = "chat-change-review";
export const fileLimit = 20;
export const historyLimit = 30;
export const agentIdSchema = z.string().min(1).max(256);
const idSchema = z.uuid();
const fileSchema = z.object({ path: z.string(), available: z.boolean() });

export const turnSchema = z.object({
  id: idSchema,
  endedAt: z.iso.datetime(),
  fileCount: z.number().int().nonnegative(),
  files: z.array(fileSchema).max(fileLimit),
  overlapping: z.boolean(),
  commits: z.array(z.string()).max(10),
});
export type Turn = z.infer<typeof turnSchema>;

const patchSchema = z.object({ text: z.string(), truncated: z.boolean() });
export const recordSchema = z.object({
  turn: turnSchema,
  patches: z.array(patchSchema.nullable()).max(fileLimit),
});

export const readPatch = defineRpc({
  name: "chat-change-review.patch",
  input: z.object({
    agentId: agentIdSchema,
    id: idSchema,
    fileIndex: z.number().int().min(0).max(fileLimit - 1),
  }),
  output: patchSchema,
});

export const readHistory = defineRpc({
  name: "chat-change-review.history",
  input: z.object({ agentId: agentIdSchema }),
  output: z.object({ turns: z.array(turnSchema).max(historyLimit) }),
});

export const commentLimit = 100;
const commentFieldsSchema = z.object({
  turnId: idSchema,
  path: z.string().min(1).max(1024),
  line: z.number().int().positive(),
  side: z.enum(["before", "after"]),
  code: z.string().max(4000),
  contextBefore: z.string().max(2000).nullable(),
  contextAfter: z.string().max(2000).nullable(),
  body: z.string().trim().min(1).max(8000),
});
export const commentSchema = commentFieldsSchema.extend({
  id: idSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ReviewComment = z.infer<typeof commentSchema>;
export type CommentDraft = z.infer<typeof commentFieldsSchema>;
const commentListSchema = z.object({ items: z.array(commentSchema).max(commentLimit) });

export const listComments = defineRpc({
  name: "chat-change-review.comment.list",
  input: z.object({ agentId: agentIdSchema }),
  output: commentListSchema,
});

export const saveComment = defineRpc({
  name: "chat-change-review.comment.save",
  input: z.object({ agentId: agentIdSchema, id: idSchema.nullable(), comment: commentFieldsSchema }),
  output: commentListSchema,
});

export const deleteComment = defineRpc({
  name: "chat-change-review.comment.delete",
  input: z.object({ agentId: agentIdSchema, id: idSchema }),
  output: commentListSchema,
});

export const clearComments = defineRpc({
  name: "chat-change-review.comment.clear",
  input: z.object({ agentId: agentIdSchema, ids: z.array(idSchema).max(commentLimit) }),
  output: commentListSchema,
});

const fenceLanguage: Record<string, string> = {
  swift: "swift", ts: "ts", tsx: "tsx", js: "js", json: "json", md: "md", py: "python", sh: "sh", m: "objc", h: "objc",
};

// Builds the single message sent to the agent. Labels come from the client in the app language.
export function reviewMessage(items: readonly ReviewComment[], labels: { header: string; beforeCode: string }) {
  const parts = items.map((item) => {
    const extension = item.path.split(".").pop()?.toLowerCase() ?? "";
    const code = [item.contextBefore, item.code, item.contextAfter].filter((line) => line !== null).join("\n");
    const side = item.side === "before" ? ` ${labels.beforeCode}` : "";
    return `${item.path}:${item.line}${side}\n\`\`\`${fenceLanguage[extension] ?? ""}\n${code}\n\`\`\`\n${item.body}`;
  });
  return [labels.header, ...parts].join("\n\n");
}
