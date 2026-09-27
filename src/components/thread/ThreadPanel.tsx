"use client";

import { MessageBubble } from "@/components/conversation/MessageBubble";
import { Composer } from "@/components/composer/Composer";
import type { ForwardTarget, Member, MessageView } from "@/types/chat";

export function ThreadPanel({
  conversationId,
  rootMessage,
  replies,
  userNames,
  members,
  ensureMembersLoaded,
  onToggleReaction,
  onSaveEdit,
  onDelete,
  onTogglePin,
  onToggleSave,
  forwardTargets,
  ensureForwardTargetsLoaded,
  onForwardTo,
  onSent,
  onClose,
}: {
  conversationId: string;
  rootMessage: MessageView;
  replies: MessageView[];
  userNames: Record<string, string>;
  members: Member[];
  ensureMembersLoaded: () => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onSaveEdit: (messageId: string, text: string) => void;
  onDelete: (messageId: string) => void;
  onTogglePin: (message: MessageView) => void;
  onToggleSave: (message: MessageView) => void;
  forwardTargets: ForwardTarget[] | null;
  ensureForwardTargetsLoaded: () => void;
  onForwardTo: (messageId: string, targetConversationId: string) => void;
  onSent: () => void;
  onClose: () => void;
}) {
  const threadTs = rootMessage.threadTs ?? rootMessage.slackTs;

  const bubbleProps = {
    userNames,
    context: "thread" as const,
    onReply: () => {},
    onToggleReaction,
    onSaveEdit,
    onDelete,
    onTogglePin,
    onToggleSave,
    forwardTargets,
    ensureForwardTargetsLoaded,
    onForwardTo,
  };

  return (
    <div className="card-surface fixed inset-y-0 right-0 z-30 flex h-dvh w-full flex-col overflow-x-hidden border-l p-3 sm:w-[420px] sm:p-4">
      <div className="mb-3 flex items-center gap-3">
        <h2 className="flex-1 text-base font-bold">Thread</h2>
        <button
          onClick={onClose}
          aria-label="Close thread"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-500 hover:bg-black/[.04] dark:text-zinc-400 dark:hover:bg-white/[.06]"
        >
          ✕
        </button>
      </div>

      <div className="message-feed flex-1 overflow-x-hidden overflow-y-auto px-1 py-2">
        <MessageBubble message={rootMessage} {...bubbleProps} />

        <div className="flex items-center gap-2 px-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          <span className="h-px flex-1 bg-black/[.06] dark:bg-white/[.08]" />
          {replies.length} {replies.length === 1 ? "reply" : "replies"}
          <span className="h-px flex-1 bg-black/[.06] dark:bg-white/[.08]" />
        </div>

        {replies.map((reply) => (
          <MessageBubble key={reply.id} message={reply} {...bubbleProps} />
        ))}
      </div>

      <div className="mt-3">
        <Composer
          key={threadTs}
          conversationId={conversationId}
          threadTs={threadTs}
          members={members}
          ensureMembersLoaded={ensureMembersLoaded}
          placeholder="Reply in thread…"
          onSent={onSent}
        />
      </div>
    </div>
  );
}
