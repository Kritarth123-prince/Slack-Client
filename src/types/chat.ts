import type { SlackFileView } from "@/lib/slack/messageFiles";

export interface ReactionView {
  emoji: string;
  count: number;
  reactedByMe: boolean;
}

export interface ForwardedFromView {
  authorName: string;
  text: string;
}

export interface MessageView {
  id: string;
  slackTs: string;
  threadTs: string | null;
  text: string;
  createdAt: string;
  authorName: string;
  authorAvatarUrl: string | null;
  isSelf: boolean;
  isEdited: boolean;
  isDeleted: boolean;
  pinned: boolean;
  savedByMe: boolean;
  forwardedFrom: ForwardedFromView | null;
  files: SlackFileView[];
  reactions: ReactionView[];
}

export interface Member {
  id: string;
  displayName: string;
}

export interface ForwardTarget {
  id: string;
  label: string;
}
