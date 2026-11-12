import { useRpc } from "@getpaseo/plugin/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  clearComments,
  deleteComment,
  kind,
  listComments,
  saveComment,
  type CommentDraft,
} from "../shared/turn-diff";

export function commentsKey(hostId: string, agentId: string) {
  return [kind, hostId, agentId, "comments"];
}

// Reads and changes the review comments of one chat (agent).
export function useComments(hostId: string, agentId: string) {
  const queryClient = useQueryClient();
  const key = commentsKey(hostId, agentId);
  const list = useRpc(listComments);
  const save = useRpc(saveComment);
  const remove = useRpc(deleteComment);
  const clear = useRpc(clearComments);
  const query = useQuery({ queryKey: key, queryFn: () => list({ agentId }), retry: false });
  const apply = (result: Awaited<ReturnType<typeof list>>) => queryClient.setQueryData(key, result);

  return {
    query,
    items: query.data?.items ?? [],
    save: useMutation({
      mutationFn: (input: { id: string | null; comment: CommentDraft }) => save({ agentId, ...input }),
      onSuccess: apply,
    }),
    remove: useMutation({ mutationFn: (id: string) => remove({ agentId, id }), onSuccess: apply }),
    clear: useMutation({ mutationFn: (ids: string[]) => clear({ agentId, ids }), onSuccess: apply }),
  };
}
