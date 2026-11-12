import { useSyncExternalStore } from "react";
import type { Turn } from "../shared/turn-diff";

export type Entry = { turn: Turn; fileIndex: number };
export type Selection =
  | { mode: "turn"; turn: Turn; fileIndex: number | null }
  | { mode: "file"; path: string; entries: Entry[] };

const selections = new Map<string, Selection>();
const listeners = new Set<() => void>();

function key(hostId: string, agentId: string) {
  return JSON.stringify([hostId, agentId]);
}

function notify() {
  for (const listener of listeners) listener();
}

export function selectFile(hostId: string, agentId: string, turn: Turn, fileIndex: number | null) {
  selections.set(key(hostId, agentId), { mode: "turn", turn, fileIndex });
  notify();
}

export function selectAggregate(hostId: string, agentId: string, path: string, entries: Entry[]) {
  selections.set(key(hostId, agentId), { mode: "file", path, entries });
  notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useSelection(hostId: string, agentId: string) {
  return useSyncExternalStore(subscribe, () => selections.get(key(hostId, agentId)) ?? null);
}

export function clearSelections() {
  selections.clear();
  notify();
}

export type AggregateFile = {
  path: string;
  entries: Entry[];
  lastEndedAt: string;
  skipped: number;
};

// Groups turns (newest first) by file, stacking each file's turns oldest first.
export function aggregateFiles(turns: readonly Turn[]): AggregateFile[] {
  const files = new Map<string, AggregateFile>();
  for (const turn of [...turns].reverse()) {
    turn.files.forEach((file, fileIndex) => {
      const current = files.get(file.path) ?? { path: file.path, entries: [], lastEndedAt: turn.endedAt, skipped: 0 };
      if (file.available) current.entries.push({ turn, fileIndex });
      else current.skipped += 1;
      current.lastEndedAt = turn.endedAt;
      files.set(file.path, current);
    });
  }
  return [...files.values()].sort((left, right) => Date.parse(right.lastEndedAt) - Date.parse(left.lastEndedAt));
}
