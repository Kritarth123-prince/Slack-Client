export interface ReactionGroup {
  emoji: string;
  count: number;
  reactedByMe: boolean;
}

/** Collapses a message's individual Reaction rows into per-emoji counts. */
export function groupReactions(
  reactions: { emoji: string; slackUserId: string }[],
  selfSlackUserRowId: string | undefined
): ReactionGroup[] {
  const groups = new Map<string, ReactionGroup>();

  for (const r of reactions) {
    const group = groups.get(r.emoji) ?? { emoji: r.emoji, count: 0, reactedByMe: false };
    group.count += 1;
    if (selfSlackUserRowId && r.slackUserId === selfSlackUserRowId) group.reactedByMe = true;
    groups.set(r.emoji, group);
  }

  return [...groups.values()];
}
