import type { PluginServerContext } from "@getpaseo/plugin/server";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { createHistory } from "./server/history";
import { createCommentStore } from "./server/comments";
import { openSnapshotRepo } from "./server/snapshot";
import {
  clearComments,
  deleteComment,
  kind,
  listComments,
  readHistory,
  readPatch,
  saveComment,
} from "./shared/turn-diff";

type Repo = Awaited<ReturnType<typeof openSnapshotRepo>>;
type ActiveTurn = {
  cwd: string;
  root?: string;
  turnId: string | null;
  overlapping: boolean;
  finishing: boolean;
  start: Promise<{ repo: Repo; snapshot: Awaited<ReturnType<Repo["capture"]>> } | null>;
};
function contains(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export default function contribute(server: PluginServerContext) {
  const home = process.env.PASEO_HOME || path.join(homedir(), ".paseo");
  const dataRoot = path.join(home, "plugin-data", kind);
  const history = createHistory(dataRoot);
  const comments = createCommentStore(path.join(dataRoot, "comments"));
  const active = new Map<string, ActiveTurn>();
  const endings = new Set<Promise<void>>();

  function noteOverlap(turn: ActiveTurn) {
    for (const other of active.values()) {
      if (other === turn) continue;
      const first = turn.root ?? turn.cwd;
      const second = other.root ?? other.cwd;
      if (contains(first, second) || contains(second, first)) {
        turn.overlapping = true;
        other.overlapping = true;
      }
    }
  }

  server.handle(readHistory, async ({ agentId }) => ({ turns: await history.list(agentId) }));
  server.handle(readPatch, async ({ agentId, id, fileIndex }) => {
    const record = await history.read(agentId, id);
    const patch = record.patches[fileIndex];
    if (!patch) throw new Error("No diff is stored for this file.");
    return patch;
  });

  server.handle(listComments, ({ agentId }) => comments.list(agentId));
  server.handle(saveComment, ({ agentId, id, comment }) => comments.save(agentId, id, comment));
  server.handle(deleteComment, ({ agentId, id }) => comments.remove(agentId, id));
  server.handle(clearComments, ({ agentId, ids }) => comments.clear(agentId, ids));

  const started = server.on("agent.turn_started", ({ agent, turnId }) => {
    if (!agent.cwd) return;
    const previous = active.get(agent.id);
    const turn: ActiveTurn = { cwd: path.resolve(agent.cwd), turnId, overlapping: false, finishing: false, start: Promise.resolve(null) };
    noteOverlap(turn);
    active.set(agent.id, turn);
    turn.start = (async () => {
      const repo = await openSnapshotRepo(turn.cwd);
      try {
        turn.root = repo.root;
        noteOverlap(turn);
        return { repo, snapshot: await repo.capture("before") };
      } catch (error) {
        await repo.close();
        throw error;
      }
    })().catch(() => null);
    if (previous && !previous.finishing)
      void previous.start.then((start) => start?.repo.close()).catch(() => undefined);
    return turn.start.then(() => undefined);
  });

  const ended = server.on("agent.turn_ended", ({ agent, turnId }, { paseo }) => {
    const turn = active.get(agent.id);
    if (!turn || turn.turnId !== turnId || turn.finishing) return;
    turn.finishing = true;
    const task = (async () => {
      const start = await turn.start;
      try {
        if (!start) return;
        const after = await start.repo.capture("after");
        const { patches, ...changes } = await start.repo.compare(start.snapshot, after);
        if (!changes.fileCount && !changes.commits.length) return;
        const summary = {
          id: randomUUID(),
          endedAt: new Date().toISOString(),
          overlapping: turn.overlapping,
          ...changes,
        };
        await history.save(agent.id, { turn: summary, patches });
        await paseo.agents.ref(agent.id).timeline.append({
          type: "plugin",
          id: summary.id,
          kind,
          version: 1,
          data: summary,
        });
      } finally {
        if (active.get(agent.id) === turn) active.delete(agent.id);
        await start?.repo.close();
      }
    })().catch((error: unknown) => {
      console.warn("[chat-change-review] Unable to record the turn diff.", error instanceof Error ? error.message : "");
    });
    endings.add(task);
    return task.finally(() => endings.delete(task));
  });

  return async () => {
    started();
    ended();
    await Promise.allSettled(endings);
    await Promise.allSettled([...active.values()].map(async (turn) => (await turn.start)?.repo.close()));
    active.clear();
  };
}
