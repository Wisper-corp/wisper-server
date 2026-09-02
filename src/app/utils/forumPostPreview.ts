/**
 * What a private reply shows about the forum post it is about.
 *
 * Small on purpose: enough for a card above the message -- who wrote it, what
 * it said, one picture -- and the ids needed to open the post itself. The
 * whole post, with its replies and reactions, would be sent with every message
 * in the conversation.
 */
export const forumPostPreviewSelect = {
  id: true,
  text: true,
  images: true,
  groupId: true,
  createdAt: true,
  author: {
    select: {
      id: true,
      person: { select: { name: true, image: true } },
      business: { select: { name: true, image: true } },
    },
  },
} as const;

/** How much of the post travels with the message. */
const PREVIEW_CHARS = 220;

type RawPreview = {
  id: string;
  text: string | null;
  images: string[] | null;
  groupId: string | null;
  createdAt: Date | null;
  author?: {
    id?: string | null;
    person?: { name: string | null; image: string | null } | null;
    business?: { name: string | null; image: string | null } | null;
  } | null;
};

/** Flattens the post for the client, which does not care which kind of
 * account wrote it. */
export const shapeForumPostPreview = (post: RawPreview | null | undefined) => {
  if (!post) return null;
  const profile = post.author?.person ?? post.author?.business ?? null;
  const text = post.text ?? "";
  return {
    id: post.id,
    groupId: post.groupId,
    // Trimmed here rather than in the app, so the same card is drawn wherever
    // it is shown and a long post does not travel with every message.
    text: text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text,
    isTrimmed: text.length > PREVIEW_CHARS,
    image: post.images?.[0] ?? null,
    createdAt: post.createdAt,
    author: {
      id: post.author?.id ?? null,
      name: profile?.name ?? null,
      image: profile?.image ?? null,
    },
  };
};
