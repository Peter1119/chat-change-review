import { execFile } from "node:child_process";
import { copyFile, lstat, mkdir, mkdtemp, realpath, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileLimit } from "../shared/turn-diff";

const patchBytes = 24 * 1024;
const maxUntrackedBytes = 1024 * 1024;
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")));
type Snapshot = {
  tree: string;
  head: string;
  omitted: Map<string, string>;
};

function git(root: string, args: string[], extra: NodeJS.ProcessEnv = {}, maxBuffer = 4 * 1024 * 1024) {
  return new Promise<{ text: string; truncated: boolean }>((resolve, reject) => {
    execFile(
      "git",
      ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", ...args],
      {
        cwd: root,
        env: {
          ...env,
          GIT_OPTIONAL_LOCKS: "0",
          GIT_TERMINAL_PROMPT: "0",
          GIT_NO_LAZY_FETCH: "1",
          GIT_LITERAL_PATHSPECS: "1",
          ...extra,
        },
        timeout: 7000,
        maxBuffer,
      },
      (error, stdout) => {
        if (error?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" && maxBuffer === patchBytes)
          resolve({ text: stdout, truncated: true });
        else if (error) reject(error);
        else resolve({ text: stdout, truncated: false });
      },
    );
  });
}

function nulList(text: string) {
  return text.split("\0").filter(Boolean);
}

async function disabledFilters(root: string) {
  const result = await git(root, ["config", "--null", "--name-only", "--get-regexp", "^filter\\."])
    .catch((error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === 1) return { text: "" };
      throw error;
    });
  const names = new Set(nulList(result.text).map((key) => key.slice(0, key.lastIndexOf("."))));
  return [...names].flatMap((name) => ["-c", `${name}.clean=`, "-c", `${name}.process=`, "-c", `${name}.required=false`]);
}

export async function openSnapshotRepo(cwd: string) {
  const root = (await git(cwd, ["rev-parse", "--show-toplevel"])).text.trimEnd();
  const paths = (await git(root, ["rev-parse", "--path-format=absolute", "--git-path", "objects", "--git-path", "index"]))
    .text.trimEnd().split("\n");
  const [objects, realIndex] = paths;
  if (paths.length !== 2 || !objects || !realIndex) throw new Error("Unable to resolve Git paths.");
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), "paseo-chat-change-review-")));
  const privateObjects = path.join(dir, "objects");
  const objectEnv = { GIT_OBJECT_DIRECTORY: privateObjects };

  async function close() {
    await rm(dir, { recursive: true, force: true });
  }

  try {
    await mkdir(path.join(privateObjects, "info"), { recursive: true, mode: 0o700 });
    await writeFile(path.join(privateObjects, "info", "alternates"), `${objects}\n`, { mode: 0o600 });
  } catch (error) {
    await close();
    throw error;
  }

  return {
    root,
    close,

    async capture(side: "before" | "after"): Promise<Snapshot> {
      const index = path.join(dir, `${side}.index`);
      try {
        const times = await lstat(realIndex);
        await copyFile(realIndex, index);
        await utimes(index, times.atime, times.mtime);
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      }
      const indexEnv = { ...objectEnv, GIT_INDEX_FILE: index };
      const head = (await git(root, ["rev-parse", "--verify", "HEAD"], indexEnv)).text.trim();
      const filters = await disabledFilters(root);
      const flags = ["-c", "core.splitIndex=false", "-c", "core.untrackedCache=false", ...filters];
      const actualIndex = (await git(root, ["rev-parse", "--path-format=absolute", "--git-path", "index"], indexEnv)).text.trimEnd();
      if (actualIndex !== index) throw new Error("Unable to verify the temporary Git index.");
      await git(root, [...flags, "add", "-u", "--", "."], indexEnv);
      const paths = nulList((await git(root, ["ls-files", "-z", "--others", "--exclude-standard"], indexEnv)).text);
      const selected: string[] = [];
      const omitted = new Map<string, string>();
      for (const name of paths) {
        const info = await lstat(path.join(root, name), { bigint: true }).catch(() => null);
        if (!info) continue;
        if (info.isFile() && info.size > maxUntrackedBytes)
          omitted.set(name, `${info.size}:${info.mtimeNs}:${info.ctimeNs}`);
        else selected.push(name);
      }
      if (selected.length) {
        const list = path.join(dir, `${side}.paths`);
        await writeFile(list, `${selected.join("\0")}\0`, { mode: 0o600 });
        await git(root, [...flags, "add", `--pathspec-from-file=${list}`, "--pathspec-file-nul"], indexEnv);
      }
      const tree = (await git(root, [...flags, "write-tree"], indexEnv)).text.trim();
      return { tree, head, omitted };
    },

    async compare(before: Snapshot, after: Snapshot) {
      const args = ["diff", "--no-ext-diff", "--no-textconv", "--no-color", "--no-renames", "--no-relative"];
      const names = new Set(nulList((await git(root, [...args, "--name-only", "-z", before.tree, after.tree, "--"], objectEnv)).text));
      for (const name of new Set([...before.omitted.keys(), ...after.omitted.keys()]))
        if (before.omitted.get(name) !== after.omitted.get(name)) names.add(name);
      const files = [];
      const patches = [];
      for (const name of [...names].slice(0, fileLimit)) {
        const patch = before.omitted.has(name) || after.omitted.has(name)
          ? null
          : await git(root, [...args, before.tree, after.tree, "--", name], objectEnv, patchBytes).catch(() => null);
        files.push({ path: name, available: patch !== null });
        patches.push(patch);
      }
      const commits = before.head === after.head ? [] : (
        await git(root, ["log", "-10", "--format=%h %s", `${before.head}..${after.head}`, "--"], objectEnv)
      ).text.trimEnd().split("\n").filter(Boolean).map((line) => line.slice(0, 240));
      return { files, patches, fileCount: names.size, commits };
    },
  };
}
