import {
  useAgent,
  usePaseo,
  useRpc,
  useTabState,
  useTranslation,
  type PluginAgentPanelProps,
  type PluginClientContext,
  type PluginTimelineItemProps,
} from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { z } from "zod";
import { useComments } from "./client/comments";
import { messages, timeLabel } from "./client/messages";
import { PatchView } from "./client/patch-view";
import {
  aggregateFiles,
  clearSelections,
  selectAggregate,
  selectFile,
  useSelection,
  type AggregateFile,
} from "./client/selection";
import {
  kind,
  readHistory,
  reviewMessage,
  turnSchema,
  type Turn,
} from "./shared/turn-diff";

type Theme = PluginTimelineItemProps["theme"];
const filesPanel = `${kind}-files`;

function firstAvailableFile(turn: Turn) {
  const index = turn.files.findIndex((file) => file.available);
  return index < 0 ? null : index;
}

function useHistory(hostId: string, agentId: string) {
  const getHistory = useRpc(readHistory);
  return useQuery({
    queryKey: [kind, hostId, agentId, "history"],
    queryFn: () => getHistory({ agentId }),
    refetchInterval: 10000,
    retry: false,
  });
}

function openDiff(client: PluginClientContext, workspaceId: string, agentId: string) {
  client.openPanel(kind, { workspaceId, agentId, location: "workspace" });
}

function TurnCard({ theme, turn, onOpen }: {
  theme: Theme;
  turn: Turn;
  onOpen: ((fileIndex: number | null) => void) | null;
}) {
  const { t } = useTranslation(messages);
  const colors = theme.colors;
  const muted = { color: colors.foregroundMuted, fontSize: 12 };
  return (
    <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, gap: 6, backgroundColor: colors.surface1 }}>
      <Pressable accessibilityRole="button" disabled={!onOpen}
        onPress={() => onOpen?.(firstAvailableFile(turn))} style={{ paddingVertical: 4 }}>
        <Text style={{ color: colors.foreground, fontWeight: "600" }}>
          {t("card.title", { count: turn.fileCount })}
        </Text>
        <Text style={muted}>{t("card.hint")}</Text>
      </Pressable>
      {turn.overlapping && <Text style={{ color: colors.statusWarning }}>{t("card.overlap")}</Text>}
      {turn.commits.map((commit) => <Text key={commit} style={muted}>{commit}</Text>)}
      {turn.files.map((file, index) => (
        <Pressable key={file.path} accessibilityRole="button" disabled={!onOpen || !file.available}
          onPress={() => onOpen?.(index)} style={{ paddingVertical: 4 }}>
          <Text style={{ color: file.available ? colors.accent : colors.foregroundMuted }}>
            {file.path}{file.available ? "" : ` · ${t("card.omitted")}`}
          </Text>
        </Pressable>
      ))}
      {turn.fileCount > turn.files.length && <Text style={muted}>{t("card.firstFiles", { count: turn.files.length })}</Text>}
    </View>
  );
}

function TimelineCard({ item, agentId, host, theme, client }: PluginTimelineItemProps<Turn> & {
  client: PluginClientContext;
}) {
  const workspaceId = useAgent(agentId, (agent) => agent.workspaceId);
  return (
    <TurnCard turn={item.data} theme={theme} onOpen={workspaceId ? (fileIndex) => {
      selectFile(host.id, agentId, item.data, fileIndex);
      openDiff(client, workspaceId, agentId);
    } : null} />
  );
}

// Main-area diff panel. Shows the file picked in the Explorer or timeline.
function DiffPanel({ params, host, theme, layout }: PluginAgentPanelProps) {
  const agentId = params.agentId;
  const history = useHistory(host.id, agentId);
  const selected = useSelection(host.id, agentId);
  const latest = history.data?.turns[0];
  const selection = selected ?? (latest ? { mode: "turn" as const, turn: latest, fileIndex: firstAvailableFile(latest) } : null);
  const { t, locale } = useTranslation(messages);
  const colors = theme.colors;
  const muted = { color: colors.foregroundMuted, fontSize: 12 };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.surface0 }}
      contentContainerStyle={{ padding: layout.compact ? 8 : 12, gap: 12 }}>
      {selection?.mode === "turn" && (
        <>
          <Text style={{ color: colors.foreground, fontWeight: "600" }}>
            {t("diff.turnTitle", { time: timeLabel(selection.turn.endedAt, locale), count: selection.turn.fileCount })}
          </Text>
          {selection.turn.overlapping && <Text style={{ color: colors.statusWarning }}>{t("card.overlap")}</Text>}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {selection.turn.files.map((file, index) => (
              <Pressable key={file.path} accessibilityRole="button"
                accessibilityState={{ selected: selection.fileIndex === index }}
                disabled={!file.available}
                onPress={() => selectFile(host.id, agentId, selection.turn, index)}
                style={{ paddingVertical: 4, paddingHorizontal: 8, borderRadius: 4, backgroundColor: selection.fileIndex === index ? colors.surface2 : colors.surface1 }}>
                <Text style={{ color: file.available ? colors.foreground : colors.foregroundMuted, fontSize: 12 }}>
                  {file.path.split("/").pop()}{file.available ? "" : ` · ${t("diff.omittedShort")}`}
                </Text>
              </Pressable>
            ))}
          </View>
          <PatchView agentId={agentId} hostId={host.id} turnId={selection.turn.id} fileIndex={selection.fileIndex}
            path={selection.fileIndex === null ? null : selection.turn.files[selection.fileIndex]?.path ?? null} theme={theme} />
        </>
      )}
      {selection?.mode === "file" && (
        <>
          <Text style={{ color: colors.foreground, fontWeight: "600" }}>
            {t("diff.chatTitle", { count: selection.entries.length })}
          </Text>
          {selection.entries.map((entry) => (
            <View key={entry.turn.id} style={{ gap: 4 }}>
              <Text style={muted}>{t("diff.turnAt", { time: timeLabel(entry.turn.endedAt, locale) })}</Text>
              <PatchView agentId={agentId} hostId={host.id} turnId={entry.turn.id} fileIndex={entry.fileIndex}
                path={selection.path} theme={theme} />
            </View>
          ))}
          {selection.entries.length === 0 && <Text style={muted}>{t("diff.notStored")}</Text>}
        </>
      )}
      {history.isPending && <Text style={muted}>{t("diff.loadingHistory")}</Text>}
      {history.error && <Text style={muted}>{t("diff.historyError")}</Text>}
      {history.data?.turns.length === 0 && !selection && <Text style={muted}>{t("diff.empty")}</Text>}
    </ScrollView>
  );
}

// Review comments left in this chat, sent to the agent as one message.
function CommentSection({ theme, hostId, agentId }: { theme: Theme; hostId: string; agentId: string }) {
  const colors = theme.colors;
  const paseo = usePaseo();
  const toast = useToast();
  const comments = useComments(hostId, agentId);
  const status = useAgent(agentId, (agent) => agent.status);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const { t } = useTranslation(messages);
  const items = comments.items;
  const busy = status === "running" || status === "initializing";
  const closed = status === "closed" || status === null;
  const canSend = items.length > 0 && !busy && !closed && !sending;
  const muted = { color: colors.foregroundMuted, fontSize: 12 };

  async function send() {
    const batch = [...items];
    setSending(true);
    setSendError(null);
    try {
      await paseo.agents.ref(agentId).send(reviewMessage(batch, {
        header: t("send.header", { count: batch.length }),
        beforeCode: t("send.beforeCode"),
      }));
    } catch (error) {
      setSendError(error instanceof Error ? error.message : t("send.failedGeneric"));
      setSending(false);
      return;
    }
    // Clear only the sent comments; keep any added while sending.
    comments.clear.mutate(batch.map((item) => item.id), {
      onSuccess: () => toast.show(t("send.sent", { count: batch.length }), { variant: "success" }),
      onError: () => toast.error(t("send.clearFailed")),
      onSettled: () => setSending(false),
    });
  }

  return (
    <View style={{ gap: 6, borderTopWidth: 1, borderColor: colors.border, paddingTop: 10 }}>
      <Text style={{ color: colors.foreground, fontWeight: "600" }}>{t("send.title", { count: items.length })}</Text>
      {items.length === 0 && <Text style={muted}>{t("send.empty")}</Text>}
      {items.map((item) => (
        <View key={item.id} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.foreground, fontSize: 12 }} numberOfLines={1}>
              {item.path.split("/").pop()}:{item.line}{item.side === "before" ? ` · ${t("send.before")}` : ""}
            </Text>
            <Text style={muted} numberOfLines={1}>{item.body}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={t("send.remove")} hitSlop={6}
            onPress={() => comments.remove.mutate(item.id, { onError: () => toast.error(t("comment.deleteFailed")) })}>
            <Icon name="X" size={14} color={colors.foregroundMuted} />
          </Pressable>
        </View>
      ))}
      {items.length > 0 && (
        <Pressable accessibilityRole="button" accessibilityLabel={t("send.button", { count: items.length })}
          accessibilityState={{ disabled: !canSend }} disabled={!canSend} onPress={() => { void send(); }}
          style={{ alignItems: "center", paddingVertical: 7, borderRadius: 6, backgroundColor: colors.accent, opacity: canSend ? 1 : 0.5 }}>
          <Text style={{ color: colors.accentForeground, fontSize: 13, fontWeight: "600" }}>
            {sending ? t("send.sending") : t("send.button", { count: items.length })}
          </Text>
        </Pressable>
      )}
      {items.length > 0 && busy && <Text style={muted}>{t("send.busy")}</Text>}
      {items.length > 0 && closed && <Text style={muted}>{t("send.closed")}</Text>}
      {sendError && <Text style={{ color: colors.statusDanger, fontSize: 12 }}>{t("send.failed", { error: sendError })}</Text>}
    </View>
  );
}

const filesTabSchema = z.object({ view: z.enum(["all", "turn"]) });

// Explorer panel. Lists files changed in this chat, combined or by turn.
function FilesPanel({ params, host, theme, layout, tab, workspaceId, client }: PluginAgentPanelProps & {
  client: PluginClientContext;
}) {
  const agentId = params.agentId;
  const history = useHistory(host.id, agentId);
  const [state, setState] = useTabState(tab, filesTabSchema, { view: "all" });
  const selection = useSelection(host.id, agentId);
  const turns = useMemo(() => history.data?.turns ?? [], [history.data]);
  const files = useMemo(() => aggregateFiles(turns), [turns]);
  const { t, locale } = useTranslation(messages);
  const colors = theme.colors;
  const muted = { color: colors.foregroundMuted, fontSize: 12 };

  function openAggregate(file: AggregateFile) {
    selectAggregate(host.id, agentId, file.path, file.entries);
    openDiff(client, workspaceId, agentId);
  }
  function openTurnFile(turn: Turn, fileIndex: number) {
    selectFile(host.id, agentId, turn, fileIndex);
    openDiff(client, workspaceId, agentId);
  }

  const tabButton = (view: "all" | "turn", label: string) => (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: state.view === view }}
      onPress={() => setState({ view })}
      style={{ paddingVertical: 4, paddingHorizontal: 10, borderRadius: 6, backgroundColor: state.view === view ? colors.surface2 : "transparent" }}>
      <Text style={{ color: state.view === view ? colors.foreground : colors.foregroundMuted, fontSize: 12 }}>{label}</Text>
    </Pressable>
  );
  const fileRow = (key: string, path: string, detail: string, selected: boolean, onPress: (() => void) | null) => (
    <Pressable key={key} accessibilityRole="button" accessibilityState={{ selected }} disabled={!onPress} onPress={onPress ?? undefined}
      style={{ paddingVertical: 5, paddingHorizontal: 6, borderRadius: 4, backgroundColor: selected ? colors.surface2 : "transparent" }}>
      <Text style={{ color: onPress ? colors.foreground : colors.foregroundMuted, fontSize: 13 }} numberOfLines={1}>{path.split("/").pop()}</Text>
      <Text style={muted} numberOfLines={1}>{path.includes("/") ? `${path.slice(0, path.lastIndexOf("/"))} · ` : ""}{detail}</Text>
    </Pressable>
  );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.surface0 }}
      contentContainerStyle={{ padding: layout.compact ? 8 : 10, gap: 8 }}>
      <Text style={{ color: colors.foreground, fontWeight: "600" }}>{t("files.title")}</Text>
      <View style={{ flexDirection: "row", gap: 4 }}>
        {tabButton("all", t("files.all", { count: files.length }))}
        {tabButton("turn", t("files.byTurn", { count: turns.length }))}
      </View>
      {history.isPending && <Text style={muted}>{t("diff.loadingHistory")}</Text>}
      {history.error && <Text style={muted}>{t("diff.historyError")}</Text>}
      {history.data && turns.length === 0 && <Text style={muted}>{t("diff.empty")}</Text>}
      {state.view === "all" && files.map((file) => fileRow(
        file.path,
        file.path,
        `${t("files.turns", { count: file.entries.length + file.skipped })} · ${timeLabel(file.lastEndedAt, locale)}${file.skipped ? ` · ${t("files.partlyOmitted")}` : ""}`,
        selection?.mode === "file" && selection.path === file.path,
        file.entries.length ? () => openAggregate(file) : null,
      ))}
      {state.view === "turn" && turns.map((turn) => (
        <View key={turn.id} style={{ gap: 2 }}>
          <Text style={{ color: colors.foregroundMuted, fontSize: 12, fontWeight: "600" }}>
            {t("files.turnFiles", { time: timeLabel(turn.endedAt, locale), count: turn.fileCount })}{turn.overlapping ? ` · ${t("files.overlaps")}` : ""}
          </Text>
          {turn.files.map((file, index) => fileRow(
            `${turn.id}:${file.path}`,
            file.path,
            file.available ? t("files.viewDiff") : t("files.omitted"),
            selection?.mode === "turn" && selection.turn.id === turn.id && selection.fileIndex === index,
            file.available ? () => openTurnFile(turn, index) : null,
          ))}
        </View>
      ))}
      <CommentSection theme={theme} hostId={host.id} agentId={agentId} />
    </ScrollView>
  );
}

export default function contribute(client: PluginClientContext) {
  const Renderer = (props: PluginTimelineItemProps<Turn>) => <TimelineCard {...props} client={client} />;
  const Files = (props: PluginAgentPanelProps) => <FilesPanel {...props} client={client} />;
  const removers = [
    client.addTimelineRenderer({ kind, version: 1, schema: turnSchema, Component: Renderer }),
    client.addAgentPanel({ id: kind, title: messages.message("panel.review"), icon: "FileDiff", locations: ["workspace"], Component: DiffPanel }),
    client.addAgentPanel({ id: filesPanel, title: messages.message("panel.files"), icon: "Files", locations: ["explorer"], Component: Files }),
    client.addCommandCenterItem({
      id: "open-change-review",
      title: messages.message("panel.openReview"),
      icon: "FileDiff",
      context: "agent",
      onSelect: ({ openPanel }) => openPanel(kind, { location: "workspace" }),
    }),
    client.addCommandCenterItem({
      id: "open-conversation-files",
      title: messages.message("panel.openFiles"),
      icon: "Files",
      context: "agent",
      onSelect: ({ openPanel }) => openPanel(filesPanel, { location: "explorer" }),
    }),
  ];
  return () => {
    for (const remove of removers.reverse()) remove();
    clearSelections();
  };
}
