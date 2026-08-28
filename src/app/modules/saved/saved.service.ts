import { Prisma } from "@prisma/client";
import ApiError from "../../middlewares/classes/ApiError";
import prisma from "../../utils/prisma";

/// What a saved thing looks like once it is flattened for the client. Service
/// posts and forum posts are different shapes, so the list says which it is
/// rather than pretending they are one type.
export type TSavedKind = "service" | "forum";

const authorSelect = {
  id: true,
  person: { select: { name: true, image: true, title: true } },
  business: { select: { name: true, image: true, title: true } },
};

const shapeAuthor = (author: {
  id: string;
  person: { name: string | null; image: string | null; title: string | null } | null;
  business: { name: string | null; image: string | null; title: string | null } | null;
}) => ({
  id: author.id,
  name: author.person?.name || author.business?.name || "Someone",
  image: author.person?.image || author.business?.image || null,
  title: author.person?.title || author.business?.title || null,
});

/// Saving is one endpoint in both directions: tapping a filled bookmark means
/// "unsave", which is the same gesture.
const toggleSaved = async (
  authId: string,
  kind: TSavedKind,
  itemId: string
) => {
  if (kind === "service") {
    const post = await prisma.post.findUnique({
      where: { id: itemId },
      select: { id: true },
    });
    if (!post) throw new ApiError(404, "Post not found.");
  } else {
    const post = await prisma.forumPost.findUnique({
      where: { id: itemId },
      select: { id: true },
    });
    if (!post) throw new ApiError(404, "Post not found.");
  }

  const where: Prisma.SavedItemWhereInput =
    kind === "service"
      ? { authId, postId: itemId }
      : { authId, forumPostId: itemId };

  const existing = await prisma.savedItem.findFirst({
    where,
    select: { id: true },
  });

  if (existing) {
    await prisma.savedItem.delete({ where: { id: existing.id } });
    return { kind, itemId, isSaved: false };
  }

  await prisma.savedItem.create({
    data:
      kind === "service"
        ? { authId, postId: itemId }
        : { authId, forumPostId: itemId },
  });
  return { kind, itemId, isSaved: true };
};

/// Which of the given posts this person has saved, so a list of posts can show
/// filled bookmarks without a query per row.
const savedPostIds = async (
  authId: string,
  postIds: string[],
  kind: TSavedKind
) => {
  if (!authId || !postIds.length) return new Set<string>();
  const rows = await prisma.savedItem.findMany({
    where:
      kind === "service"
        ? { authId, postId: { in: postIds } }
        : { authId, forumPostId: { in: postIds } },
    select: { postId: true, forumPostId: true },
  });
  return new Set(
    rows
      .map(r => (kind === "service" ? r.postId : r.forumPostId))
      .filter((id): id is string => Boolean(id))
  );
};

/// Everything this person kept, newest first, optionally narrowed to one kind
/// or filtered by what the text says.
const getSavedItems = async (
  authId: string,
  query: { type?: string; searchTerm?: string }
) => {
  const wantsService = query.type !== "forum";
  const wantsForum = query.type !== "service";
  const term = (query.searchTerm ?? "").trim();

  const rows = await prisma.savedItem.findMany({
    where: {
      authId,
      OR: [
        ...(wantsService ? [{ postId: { not: null } }] : []),
        ...(wantsForum ? [{ forumPostId: { not: null } }] : []),
      ],
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      post: {
        select: {
          id: true,
          caption: true,
          images: true,
          price: true,
          currency: true,
          deliveryTime: true,
          createdAt: true,
          groupId: true,
          author: { select: authorSelect },
        },
      },
      forumPost: {
        select: {
          id: true,
          text: true,
          images: true,
          createdAt: true,
          groupId: true,
          author: { select: authorSelect },
          group: { select: { name: true } },
        },
      },
    },
  });

  const items = rows
    .map(row => {
      if (row.post) {
        return {
          savedId: row.id,
          savedAt: row.createdAt,
          kind: "service" as const,
          id: row.post.id,
          text: row.post.caption ?? "",
          images: row.post.images,
          price: row.post.price,
          currency: row.post.currency,
          deliveryTime: row.post.deliveryTime,
          groupId: row.post.groupId,
          groupName: null as string | null,
          createdAt: row.post.createdAt,
          author: shapeAuthor(row.post.author),
        };
      }
      if (row.forumPost) {
        return {
          savedId: row.id,
          savedAt: row.createdAt,
          kind: "forum" as const,
          id: row.forumPost.id,
          text: row.forumPost.text,
          images: row.forumPost.images,
          price: null,
          currency: null,
          deliveryTime: null,
          groupId: row.forumPost.groupId,
          groupName: row.forumPost.group?.name ?? null,
          createdAt: row.forumPost.createdAt,
          author: shapeAuthor(row.forumPost.author),
        };
      }
      return null;
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  // Searching in the database would need two different text columns unioned,
  // so it happens here instead: the list is one person's saved items, not a
  // whole table, and it matches the author's name as well as the text.
  if (!term) return items;
  const needle = term.toLowerCase();
  return items.filter(
    item =>
      item.text.toLowerCase().includes(needle) ||
      item.author.name.toLowerCase().includes(needle) ||
      (item.groupName ?? "").toLowerCase().includes(needle)
  );
};

export const savedServices = {
  toggleSaved,
  savedPostIds,
  getSavedItems,
};
