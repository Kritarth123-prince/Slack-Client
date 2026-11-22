"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { MessageBubble } from "@/components/conversation/MessageBubble";
import { Composer } from "@/components/composer/Composer";
import { TypingLine } from "@/components/conversation/TypingLine";
import type { ForwardTarget, Member, MessageView } from "@/types/chat";

/** A thread: docked beside the conversation on wide screens, full-screen over it on smaller ones. */
export function ThreadPanel({
  conversationId,
  conversationTitle,
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
  onNotice,
  onSent,
  onClose,
  typingNames = [],
}: {
  conversationId: string;
  conversationTitle: string;
  rootMessage: MessageView;
  replies: MessageView[];
  userNames: Record<string, string>;
  members: Member[];
  ensureMembersLoaded: () => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onSaveEdit: (messageId: string, text: string) => void;
  onDelete: (message: MessageView) => void;
  onTogglePin: (message: MessageView) => void;
  onToggleSave: (message: MessageView) => void;
  forwardTargets: ForwardTarget[] | null;
  ensureForwardTargetsLoaded: () => void;
  onForwardTo: (messageId: string, targetConversationId: string) => void;
  onNotice: (text: string) => void;
  onSent: () => void;
  onClose: () => void;
  typingNames?: string[];
}) {
  const threadTs = rootMessage.threadTs ?? rootMessage.slackTs;
  const scrollRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Leave Escape to whatever popover/dialog is open inside the thread first.
      if (e.key === "Escape" && !document.querySelector('[role="dialog"], [role="menu"]')) onCloseRef.current();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // New replies scroll into view, like the main feed.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [replies.length, threadTs]);

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
    onNotice,
  };

  return (
    <aside
      className="fixed inset-0 z-40 flex flex-col bg-surface lg:static lg:z-auto lg:w-[26rem] lg:shrink-0 lg:border-l lg:border-line"
      aria-label="Thread"
    >
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold text-fg">Thread</h2>
          <p className="truncate text-xs text-subtle">{conversationTitle}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close thread"
          title="Close (Esc)"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg"
        >
          <X size={18} />
        </button>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-canvas">
        <div className="message-feed px-3 py-5 sm:px-4">
          <MessageBubble message={rootMessage} {...bubbleProps} />

          <div className="flex items-center gap-3 text-xs font-medium text-subtle" role="separator">
            <span>
              {replies.length} {replies.length === 1 ? "reply" : "replies"}
            </span>
            <span className="h-px flex-1 bg-line" />
          </div>

          {replies.map((reply, i) => {
            const prev = replies[i - 1];
            const continuation =
              Boolean(prev && prev.authorId && prev.authorId === reply.authorId) &&
              Number(reply.slackTs) - Number(prev.slackTs) < 5 * 60;
            return <MessageBubble key={reply.id} message={reply} continuation={continuation} {...bubbleProps} />;
          })}
        </div>
      </div>

      <div className="shrink-0 bg-canvas px-3 pb-3 sm:px-4">
        <TypingLine names={typingNames} />
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
    </aside>
  );
}
