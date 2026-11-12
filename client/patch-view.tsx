import { useRpc, useTranslation, type PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { kind, readPatch, type ReviewComment } from "../shared/turn-diff";
import { useComments } from "./comments";
import { messages } from "./messages";
import { readCodeFontSettings, subscribeSettingsChange, type CodeFontSettings } from "./web";
import { buildLineSpans, hexToRgba, languageForPath, tokenizeLine, type Token, type TokenizeState } from "./syntax";

type Theme = PluginTimelineItemProps["theme"];
type RowKind = "hunk" | "context" | "added" | "removed";
export type DiffRow = {
  kind: RowKind;
  before: number | null;
  after: number | null;
  text: string;
};

// Matches the Paseo built-in diff (packages/app/src/git/diff-document, components/code-insets.ts).
// On web it follows the Paseo code font settings and falls back to the defaults.
const DEFAULT_CODE_FONT_SIZE = 12;
const DEFAULT_MONO_FONT = Platform.select({
  web: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  ios: "ui-monospace",
  default: "monospace",
});
type Typography = { size: number; lineHeight: number; family: string };

function typographyFrom(settings: CodeFontSettings): Typography {
  const size = settings.size ?? DEFAULT_CODE_FONT_SIZE;
  return { size, lineHeight: Math.round(size * 1.5), family: settings.family ?? DEFAULT_MONO_FONT };
}

function useCodeTypography(): Typography {
  const [typography, setTypography] = useState(() => typographyFrom(readCodeFontSettings()));
  useEffect(() => {
    const reload = () => setTypography(typographyFrom(readCodeFontSettings()));
    reload();
    return subscribeSettingsChange(reload);
  }, []);
  return typography;
}
const CODE_LEFT_PADDING = 8;
const NUMBER_RIGHT_PADDING = 7;
const syntaxTheme = "one";

function gutterWidth(maxLineNumber: number, fontSize: number) {
  const digits = Math.max(2, String(maxLineNumber).length);
  return digits * Math.ceil(fontSize * 0.62) + 12;
}

// Turns git diff output into unified rows. File headers are dropped; hunk headers stay as separator rows.
export function diffRows(patch: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let before = 0;
  let after = 0;
  let inHunk = false;
  for (const line of patch.split("\n")) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
    if (hunk) {
      before = Number(hunk[1]);
      after = Number(hunk[2]);
      inHunk = true;
      rows.push({ kind: "hunk", before: null, after: null, text: line });
      continue;
    }
    if (line.startsWith("diff --git ")) inHunk = false;
    if (!inHunk || line.startsWith("\\")) continue;
    if (line.startsWith("+")) rows.push({ kind: "added", before: null, after: after++, text: line.slice(1) });
    else if (line.startsWith("-")) rows.push({ kind: "removed", before: before++, after: null, text: line.slice(1) });
    else if (line.startsWith(" ")) rows.push({ kind: "context", before: before++, after: after++, text: line.slice(1) });
  }
  return rows;
}

// Unified view uses one line number column: old numbers for removed lines, new numbers otherwise.
function lineNumber(row: DiffRow) {
  return row.kind === "removed" ? row.before : row.after;
}

type EditorState = { rowIndex: number; commentId: string | null; text: string };

function CommentEditor({ theme, editor, saving, onChange, onCancel, onSave }: {
  theme: Theme;
  editor: EditorState;
  saving: boolean;
  onChange: (text: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation(messages);
  const colors = theme.colors;
  const canSave = editor.text.trim().length > 0 && !saving;
  return (
    <View style={{ backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12, gap: 12 }}>
      <TextInput
        accessibilityLabel={t("comment.label")}
        placeholder={t("comment.placeholder")}
        placeholderTextColor={colors.foregroundMuted}
        value={editor.text}
        onChangeText={onChange}
        multiline
        autoFocus
        style={{
          minHeight: 66, color: colors.foreground, backgroundColor: colors.surface1,
          borderWidth: 1, borderColor: colors.border, borderRadius: 6,
          paddingHorizontal: 12, paddingVertical: 8, fontSize: 15, lineHeight: 21, textAlignVertical: "top",
        }}
      />
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("comment.cancelLabel")} onPress={onCancel}
          style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6 }}>
          <Text style={{ color: colors.foreground, fontSize: 13 }}>{t("comment.cancel")}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t("comment.saveLabel")} accessibilityState={{ disabled: !canSave }}
          disabled={!canSave} onPress={onSave}
          style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6, backgroundColor: colors.accent, opacity: canSave ? 1 : 0.5 }}>
          <Text style={{ color: colors.accentForeground, fontSize: 13, fontWeight: "600" }}>{editor.commentId ? t("comment.update") : t("comment.save")}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function CommentBlock({ theme, comment, onEdit, onDelete }: {
  theme: Theme;
  comment: ReviewComment;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation(messages);
  const colors = theme.colors;
  return (
    <View style={{ backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Text selectable style={{ flex: 1, color: colors.foreground, fontSize: 15, lineHeight: 21 }}>{comment.body}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={t("comment.edit")} hitSlop={4} onPress={onEdit}
        style={{ width: 26, height: 26, alignItems: "center", justifyContent: "center", borderRadius: 13 }}>
        <Icon name="Pencil" size={14} color={colors.foregroundMuted} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={t("comment.delete")} hitSlop={4} onPress={onDelete}
        style={{ width: 26, height: 26, alignItems: "center", justifyContent: "center", borderRadius: 13 }}>
        <Icon name="Trash2" size={14} color={colors.foregroundMuted} />
      </Pressable>
    </View>
  );
}

function rowSide(row: DiffRow): "before" | "after" {
  return row.kind === "removed" ? "before" : "after";
}

function DiffLines({ rows, path, theme, turnId, agentId, hostId }: {
  rows: DiffRow[];
  path: string;
  theme: Theme;
  turnId: string;
  agentId: string;
  hostId: string;
}) {
  const { t } = useTranslation(messages);
  const colors = theme.colors;
  const toast = useToast();
  const comments = useComments(hostId, agentId);
  const [hovered, setHovered] = useState<number | null>(null);
  // Hover briefly ends when the pointer moves onto the line number cell; delay hiding so the + button stays.
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showAddButton = (index: number) => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = null;
    setHovered(index);
  };
  const hideAddButton = (index: number) => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      hideTimer.current = null;
      setHovered((current) => current === index ? null : current);
    }, 150);
  };
  useEffect(() => () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const language = languageForPath(path);
  const backgrounds = useMemo(() => ({
    added: hexToRgba(colors.statusSuccess, 0.15),
    removed: hexToRgba(colors.statusDanger, 0.1),
  }), [colors]);
  const typography = useCodeTypography();
  const lineHeight = typography.lineHeight;
  const gutter = useMemo(() => gutterWidth(Math.max(0, ...rows.map((row) => lineNumber(row) ?? 0)), typography.size), [rows, typography.size]);
  const lineComments = useMemo(() => {
    const byLine = new Map<string, ReviewComment[]>();
    for (const item of comments.items) {
      if (item.turnId !== turnId || item.path !== path) continue;
      const key = `${item.side}:${item.line}`;
      byLine.set(key, [...(byLine.get(key) ?? []), item]);
    }
    return byLine;
  }, [comments.items, turnId, path]);
  const spans = useMemo(() => {
    let beforeState: TokenizeState = { inBlock: false, inTag: false, inFence: false };
    let afterState: TokenizeState = { ...beforeState };
    return rows.map((row) => {
      if (row.kind === "hunk") return [];
      let tokens: Token[] = row.text ? [{ text: row.text, kind: "plain" }] : [];
      if (language) {
        const state = row.kind === "added" ? afterState : beforeState;
        const result = tokenizeLine(language, row.text, state);
        tokens = result.tokens;
        if (row.kind !== "added") beforeState = result.next;
        if (row.kind !== "removed") afterState = result.next;
      }
      return buildLineSpans(tokens, row.text, [], colors, null, null, syntaxTheme);
    });
  }, [rows, language, colors]);
  const font = { fontFamily: typography.family, fontSize: typography.size, lineHeight };

  function neighbor(index: number) {
    const row = rows[index];
    return row && row.kind !== "hunk" ? row.text : null;
  }

  function submit() {
    if (!editor) return;
    const row = rows[editor.rowIndex];
    const line = row ? lineNumber(row) : null;
    if (!row || line === null) return;
    comments.save.mutate({
      id: editor.commentId,
      comment: {
        turnId, path, line, side: rowSide(row),
        code: row.text.slice(0, 4000),
        contextBefore: neighbor(editor.rowIndex - 1)?.slice(0, 2000) ?? null,
        contextAfter: neighbor(editor.rowIndex + 1)?.slice(0, 2000) ?? null,
        body: editor.text.trim(),
      },
    }, {
      onSuccess: () => setEditor(null),
      onError: () => toast.error(t("comment.saveFailed")),
    });
  }

  return (
    <ScrollView horizontal style={{ backgroundColor: colors.surface0 }}>
      <View style={{ minWidth: "100%" }}>
        {rows.map((row, index) => {
          if (row.kind === "hunk") {
            return (
              <View key={index} style={{ flexDirection: "row", height: lineHeight, backgroundColor: colors.surface0 }}>
                <View style={{ width: gutter, borderRightWidth: 1, borderColor: colors.border }} />
                <Text style={{ ...font, color: colors.foregroundMuted, paddingLeft: CODE_LEFT_PADDING }}>{row.text}</Text>
              </View>
            );
          }
          const background = row.kind === "added" ? backgrounds.added : row.kind === "removed" ? backgrounds.removed : colors.surface0;
          const numberColor = row.kind === "added" ? colors.statusSuccess : row.kind === "removed" ? colors.statusDanger : colors.foregroundMuted;
          const line = lineNumber(row);
          const thread = line === null ? [] : lineComments.get(`${rowSide(row)}:${line}`) ?? [];
          const editing = editor?.rowIndex === index;
          const showAdd = hovered === index || editing;
          return (
            <View key={index}>
              <Pressable onHoverIn={() => showAddButton(index)} onHoverOut={() => hideAddButton(index)}
                style={{ flexDirection: "row", height: lineHeight, backgroundColor: background }}>
                <Pressable accessibilityRole="button" accessibilityLabel={t("comment.addOnLine", { path, line: line ?? "" })}
                  onHoverIn={() => showAddButton(index)} onHoverOut={() => hideAddButton(index)}
                  onPress={() => setEditor({ rowIndex: index, commentId: null, text: "" })}
                  style={{ width: gutter, height: lineHeight, borderRightWidth: 1, borderColor: colors.border, backgroundColor: editing ? colors.surface2 : undefined }}>
                  <Text style={{ ...font, color: numberColor, textAlign: "right", paddingRight: NUMBER_RIGHT_PADDING }}>{line ?? ""}</Text>
                  {showAdd && (
                    <View pointerEvents="none" style={{ position: "absolute", right: 2, top: Math.max(0, Math.floor((lineHeight - 16) / 2)), width: 16, height: 16, borderRadius: 4, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" }}>
                      <Icon name="Plus" size={12} color={colors.accentForeground} />
                    </View>
                  )}
                </Pressable>
                <Text selectable style={{ ...font, paddingLeft: CODE_LEFT_PADDING, paddingRight: 16 }}>
                  {spans[index]?.length ? spans[index]?.map((span, spanIndex) => (
                    <Text key={spanIndex} style={{ ...font, color: span.color }}>{span.text}</Text>
                  )) : " "}
                </Text>
              </Pressable>
              {(thread.length > 0 || editing) && (
                <View style={{ gap: 6, paddingVertical: 8, paddingHorizontal: 12, maxWidth: 720, minWidth: 320 }}>
                  {thread.map((comment) => editor?.commentId === comment.id ? null : (
                    <CommentBlock key={comment.id} theme={theme} comment={comment}
                      onEdit={() => setEditor({ rowIndex: index, commentId: comment.id, text: comment.body })}
                      onDelete={() => comments.remove.mutate(comment.id, {
                        onError: () => toast.error(t("comment.deleteFailed")),
                      })} />
                  ))}
                  {editing && editor && (
                    <CommentEditor theme={theme} editor={editor} saving={comments.save.isPending}
                      onChange={(text) => setEditor({ ...editor, text })}
                      onCancel={() => setEditor(null)} onSave={submit} />
                  )}
                </View>
              )}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

export function PatchView({ agentId, hostId, turnId, fileIndex, path, theme }: {
  agentId: string;
  hostId: string;
  turnId: string;
  fileIndex: number | null;
  path: string | null;
  theme: Theme;
}) {
  const getPatch = useRpc(readPatch);
  const patch = useQuery({
    queryKey: [kind, hostId, agentId, turnId, fileIndex],
    queryFn: () => {
      if (fileIndex === null) throw new Error("No file selected.");
      return getPatch({ agentId, id: turnId, fileIndex });
    },
    enabled: fileIndex !== null,
    staleTime: Infinity,
    retry: false,
  });
  const rows = useMemo(() => (patch.data ? diffRows(patch.data.text) : []), [patch.data]);
  const { t } = useTranslation(messages);
  const colors = theme.colors;
  const muted = { color: colors.foregroundMuted, fontSize: 12 };
  if (fileIndex === null || !path) return <Text style={muted}>{t("diff.noDiff")}</Text>;
  if (patch.isPending) return <Text style={muted}>{t("diff.loadingDiff")}</Text>;
  if (patch.error) return <Text style={muted}>{t("diff.diffError")}</Text>;

  const added = rows.filter((row) => row.kind === "added").length;
  const removed = rows.filter((row) => row.kind === "removed").length;
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Text style={{ color: colors.foreground, fontWeight: "600", flexShrink: 1 }} numberOfLines={2}>{path}</Text>
        {added > 0 && <Text style={{ color: colors.statusSuccess, fontSize: 12, fontWeight: "600" }}>+{added}</Text>}
        {removed > 0 && <Text style={{ color: colors.statusDanger, fontSize: 12, fontWeight: "600" }}>-{removed}</Text>}
      </View>
      <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 6, overflow: "hidden" }}>
        <DiffLines rows={rows} path={path} theme={theme} turnId={turnId} agentId={agentId} hostId={hostId} />
      </View>
      {patch.data.truncated && <Text style={muted}>{t("diff.truncated")}</Text>}
    </View>
  );
}
