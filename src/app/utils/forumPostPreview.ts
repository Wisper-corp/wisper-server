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

/**
 * What a reply shows about the message it quotes.
 *
 * A line of text, or the kind of file it was, plus who sent it — enough for
 * the bar above a reply. Trimmed for the same reason the post preview is.
 */
export const quotedMessageSelect = {
  id: true,
  text: true,
  file: true,
  fileType: true,
  sender: {
    select: {
      id: true,
      person: { select: { name: true } },
      business: { select: { name: true } },
    },
  },
} as const;

const QUOTE_CHARS = 160;

type RawQuote = {
  id: string;
  text: string | null;
  file: string | null;
  fileType: string | null;
  sender?: {
    id?: string | null;
    person?: { name: string | null } | null;
    business?: { name: string | null } | null;
  } | null;
};

export const shapeQuotedMessage = (msg: RawQuote | null | undefined) => {
  if (!msg) return null;
  const profile = msg.sender?.person ?? msg.sender?.business ?? null;
  const text = msg.text ?? "";
  return {
    id: msg.id,
    text: text.length > QUOTE_CHARS ? `${text.slice(0, QUOTE_CHARS)}…` : text,
    fileType: msg.fileType,
    file: msg.file,
    senderId: msg.sender?.id ?? null,
    senderName: profile?.name ?? null,
  };
};
