import { ChatRole, Prisma } from "@prisma/client";
import ApiError from "../../middlewares/classes/ApiError";
import prisma from "../../utils/prisma";
import {
  calculatePagination,
  TPaginationOptions,
} from "../../utils/paginationCalculation";
import { TFile } from "../../interface/file.interface";
import { uploadToS3 } from "../../utils/awss3";
import {
  FORUM_POLL_MAX_OPTIONS,
  FORUM_POLL_MIN_OPTIONS,
  TCreateForumPost,
  TCreateForumReply,
} from "./forum.validation";
import { sendRichNotification } from "../../utils/sendNotification";
import {
  activeSuspension,
  screenContent,
} from "../moderation/moderation.service";

// The author block every forum row carries. The card shows the poster's
// professional title under their name, so it has to come back with the post.
const authorSelect = {
  select: {
    id: true,
    person: { select: { name: true, image: true, title: true } },
    business: { select: { name: true, image: true, industry: true } },
  },
};

const shapeAuthor = (auth: {
  id: string;
  person: { name: string | null; image: string | null; title: string | null } | null;
  business: { name: string | null; image: string | null; industry: string | null } | null;
}) => ({
  id: auth.id,
  name: auth.person?.name || auth.business?.name || "User",
  image: auth.person?.image || auth.business?.image || null,
  title: auth.person?.title || auth.business?.industry || null,
});

// Admins and moderators police the forum; a plain member can only remove
// their own post.
const MODERATOR_ROLES = ["ADMIN", "MODERATOR"] as const;

const moderatorRoleIn = async (groupId: string, authId: string) => {
  const participant = await prisma.chatParticipant.findFirst({
    where: {
      authId,
      chat: { groupId },
      role: { in: MODERATOR_ROLES as unknown as ChatRole[] },
    },
    select: { role: true },
  });
  return participant?.role ?? null;
};

// The poll block every forum row carries, shaped so the card can draw bars
// without a second request.
const pollSelect = {
  select: {
    id: true,
    options: {
      orderBy: { position: "asc" as const },
      select: {
        id: true,
        text: true,
        position: true,
        _count: { select: { votes: true } },
      },
    },
  },
};

type RawPoll = {
  id: string;
  options: {
    id: string;
    text: string;
    position: number;
    _count: { votes: number };
  }[];
} | null;

const shapePoll = (poll: RawPoll, myOptionId: string | null) => {
  if (!poll) return null;
  const total = poll.options.reduce((sum, o) => sum + o._count.votes, 0);
  return {
    id: poll.id,
    totalVotes: total,
    // Which option this viewer picked, so the card can mark it without
    // the client having to work it out.
    myOptionId,
    options: poll.options.map(o => ({
      id: o.id,
      text: o.text,
      votes: o._count.votes,
      // Rounded here so every client shows the same number.
      percent: total === 0 ? 0 : Math.round((o._count.votes / total) * 100),
    })),
  };
};

/// Returns the message to show a suspended member, or null if they may post.
const assertNotSuspended = async (groupId: string, authId: string) => {
  const suspension = await activeSuspension(authId, groupId);
  if (!suspension) return null;
  return `You cannot post in this community until ${suspension.until.toUTCString()}. Reason: ${suspension.reason}`;
};

const replySelect = (authId: string) => ({
  id: true,
  text: true,
  isEdited: true,
  createdAt: true,
  parentId: true,
  author: authorSelect,
  _count: { select: { reactions: true, children: true } },
  // This viewer's own like, so the heart can render filled without a second
  // request.
  reactions: { where: { authId }, select: { id: true }, take: 1 },
});

type RawReply = {
  id: string;
  text: string;
  isEdited: boolean;
  createdAt: Date;
  parentId: string | null;
  author: Parameters<typeof shapeAuthor>[0];
  _count: { reactions: number; children: number };
  reactions: { id: string }[];
};

const shapeReply = (reply: RawReply, authId: string, children: unknown[] = []) => ({
  id: reply.id,
  text: reply.text,
  isEdited: reply.isEdited,
  createdAt: reply.createdAt,
  parentId: reply.parentId,
  author: shapeAuthor(reply.author),
  reactionCount: reply._count.reactions,
  hasReacted: reply.reactions.length > 0,
  isMine: reply.author.id === authId,
  replyCount: reply._count.children,
  replies: children,
});

const assertMember = async (groupId: string, authId: string) => {
  const participant = await prisma.chatParticipant.findFirst({
    where: { authId, chat: { groupId } },
    select: { id: true },
  });
  if (!participant) {
    throw new ApiError(403, "Join this community to post in its forum.");
  }
};

const getGroupForumPosts = async (
  groupId: string,
  options: TPaginationOptions,
  authId: string
) => {
  const { page, take, skip, sortBy, orderBy } = calculatePagination(options);

  const where: Prisma.ForumPostWhereInput = { groupId };

  const posts = await prisma.forumPost.findMany({
    where,
    select: {
      id: true,
      text: true,
      images: true,
      isEdited: true,
      createdAt: true,
      author: authorSelect,
      _count: { select: { replies: true, reactions: true } },
      // Who reacted, limited to the caller, so the heart can render filled
      // without a second round trip.
      reactions: { where: { authId }, select: { id: true }, take: 1 },
      poll: pollSelect,
      // This viewer's vote and follow state, fetched with the row.
      followers: { where: { authId }, select: { id: true }, take: 1 },
      // Avatars for the "12 replies" stack.
      replies: {
        take: 3,
        orderBy: { createdAt: "desc" },
        select: { author: authorSelect },
      },
    },
    orderBy: sortBy && orderBy ? { [sortBy]: orderBy } : { createdAt: "desc" },
    skip,
    take,
  });

  const total = await prisma.forumPost.count({ where });

  // Resolved once per request rather than per row, and sent down so the app
  // never has to reimplement the rule.
  const canModerate = (await moderatorRoleIn(groupId, authId)) !== null;

  // One query for every poll this viewer has voted in, rather than one per row.
  const pollIds = posts
    .map(p => p.poll?.id)
    .filter((id): id is string => Boolean(id));
  const myVotes = new Map<string, string>();
  if (pollIds.length) {
    const votes = await prisma.forumPollVote.findMany({
      where: { authId, pollId: { in: pollIds } },
      select: { pollId: true, optionId: true },
    });
    for (const v of votes) myVotes.set(v.pollId, v.optionId);
  }

  const shaped = posts.map(post => ({
    id: post.id,
    text: post.text,
    images: post.images,
    isEdited: post.isEdited,
    createdAt: post.createdAt,
    author: shapeAuthor(post.author),
    replyCount: post._count.replies,
    reactionCount: post._count.reactions,
    hasReacted: post.reactions.length > 0,
    isFollowing: post.followers.length > 0,
    poll: shapePoll(post.poll as RawPoll, myVotes.get(post.poll?.id ?? "") ?? null),
    isMine: post.author.id === authId,
    canDelete: post.author.id === authId || canModerate,
    replyAvatars: post.replies.map(reply => ({
      id: reply.author.id,
      image: reply.author.person?.image || reply.author.business?.image || null,
    })),
  }));

  return { meta: { page, limit: take, total }, posts: shaped };
};

/// A forum post carries at most this many images.
export /**
 * Child replies sent inline with each top-level reply. Enough to show a
 * conversation is happening; the rest arrive behind "Show more replies", so one
 * busy thread cannot bury every other reply on the screen.
 */
const INLINE_CHILDREN = 2;

const FORUM_MAX_IMAGES = 4;

const createForumPost = async (
  payload: TCreateForumPost,
  authId: string,
  files?: TFile[]
) => {
  await assertMember(payload.groupId, authId);

  // handleZodValidation only runs on multipart when a `payload` field is
  // present, so a differently shaped request can reach here unvalidated. The
  // caption is a product rule - images must go with text - so enforce it where
  // it cannot be skipped.
  const text = (payload.text ?? "").trim();
  if (!text) {
    throw new ApiError(400, "Add a caption to go with your post.");
  }

  // A suspended member cannot post, and is told why and until when.
  const suspended = await assertNotSuspended(payload.groupId, authId);
  if (suspended) throw new ApiError(403, suspended);

  if (files && files.length > FORUM_MAX_IMAGES) {
    throw new ApiError(
      400,
      `You can attach up to ${FORUM_MAX_IMAGES} images.`
    );
  }

  const images: string[] = [];
  if (files && files.length) {
    for (const file of files) {
      images.push(await uploadToS3(file));
    }
  }

  const rawOptions = (payload.pollOptions ?? [])
    .map(o => o.trim())
    .filter(o => o.length > 0);

  if (payload.pollOptions !== undefined) {
    if (rawOptions.length < FORUM_POLL_MIN_OPTIONS) {
      throw new ApiError(400, "A poll needs at least two options.");
    }
    if (rawOptions.length > FORUM_POLL_MAX_OPTIONS) {
      throw new ApiError(400, "A poll can have at most ten options.");
    }
    const seen = new Set(rawOptions.map(o => o.toLowerCase()));
    if (seen.size !== rawOptions.length) {
      throw new ApiError(400, "Poll options must be different from each other.");
    }
  }

  // Screened before it is written, so spam never appears at all.
  const screening = await screenContent({
    groupId: payload.groupId,
    authorId: authId,
    content: text,
    target: "POST",
  });
  if (!screening.allowed) {
    throw new ApiError(403, screening.message ?? "This post was removed.");
  }

  const post = await prisma.forumPost.create({
    data: {
      groupId: payload.groupId,
      authorId: authId,
      text,
      images,
      ...(rawOptions.length
        ? {
            poll: {
              create: {
                options: {
                  create: rawOptions.map((text, position) => ({
                    text,
                    position,
                  })),
                },
              },
            },
          }
        : {}),
    },
    select: {
      id: true,
      text: true,
      images: true,
      isEdited: true,
      createdAt: true,
      author: authorSelect,
      poll: pollSelect,
    },
  });

  return {
    ...post,
    author: shapeAuthor(post.author),
    poll: shapePoll(post.poll as RawPoll, null),
    isFollowing: false,
    replyCount: 0,
    reactionCount: 0,
    hasReacted: false,
    isMine: true,
    canDelete: true,
    replyAvatars: [],
  };
};

const deleteForumPost = async (postId: string, authId: string) => {
  const post = await prisma.forumPost.findUnique({
    where: { id: postId },
    select: { authorId: true, groupId: true },
  });
  if (!post) throw new ApiError(404, "Post not found.");

  if (post.authorId !== authId) {
    const role = await moderatorRoleIn(post.groupId, authId);
    if (!role) {
      throw new ApiError(
        403,
        "Only the author, an admin or a moderator can delete this post."
      );
    }
  }

  await prisma.forumPost.delete({ where: { id: postId } });
  return { id: postId };
};

const getForumReplies = async (
  postId: string,
  options: TPaginationOptions,
  authId: string
) => {
  const { page, take, skip } = calculatePagination(options);

  const post = await prisma.forumPost.findUnique({
    where: { id: postId },
    select: {
      id: true,
      text: true,
      images: true,
      createdAt: true,
      author: authorSelect,
      _count: { select: { replies: true, reactions: true } },
    },
  });
  if (!post) throw new ApiError(404, "Post not found.");

  // Only top-level replies are paged; their children ride along, so a thread
  // arrives whole rather than split across pages.
  const topLevel = await prisma.forumReply.findMany({
    where: { postId, parentId: null },
    select: replySelect(authId),
    orderBy: { createdAt: "asc" },
    skip,
    take,
  });

  // One query for every child of this page, rather than one query per reply.
  const parentIds = topLevel.map(r => r.id);
  const children = parentIds.length
    ? await prisma.forumReply.findMany({
        where: { parentId: { in: parentIds } },
        select: replySelect(authId),
        orderBy: { createdAt: "asc" },
      })
    : [];

  const childrenByParent = new Map<string, RawReply[]>();
  for (const child of children as RawReply[]) {
    if (!child.parentId) continue;
    const list = childrenByParent.get(child.parentId) ?? [];
    list.push(child);
    childrenByParent.set(child.parentId, list);
  }

  const replies = (topLevel as RawReply[]).map(reply =>
    shapeReply(
      reply,
      authId,
      (childrenByParent.get(reply.id) ?? [])
        .slice(0, INLINE_CHILDREN)
        .map(child => shapeReply(child, authId))
    )
  );

  return {
    // total counts every reply in the thread, including nested ones, so the
    // "12 Replies" label matches what a person would count.
    meta: { page, limit: take, total: post._count.replies },
    post: {
      id: post.id,
      text: post.text,
      images: post.images,
      createdAt: post.createdAt,
      author: shapeAuthor(post.author),
      replyCount: post._count.replies,
      reactionCount: post._count.reactions,
    },
    replies,
  };
};

/// Tells the post author and anyone following it that a reply landed. Fired
/// without awaiting: a notification failure must never fail the reply itself.
const notifyFollowers = async (
  postId: string,
  actorId: string,
  actor: {
    person: { name: string | null; image: string | null } | null;
    business: { name: string | null; image: string | null } | null;
  }
) => {
  try {
    const post = await prisma.forumPost.findUnique({
      where: { id: postId },
      select: {
        text: true,
        authorId: true,
        followers: { select: { authId: true } },
      },
    });
    if (!post) return;

    const audience = new Set<string>([
      post.authorId,
      ...post.followers.map(f => f.authId),
    ]);
    audience.delete(actorId);
    if (!audience.size) return;

    const name = actor.person?.name || actor.business?.name || "Someone";
    const snippet =
      post.text.length > 40 ? `${post.text.slice(0, 40)}...` : post.text;

    const avatar =
      actor.person?.image || actor.business?.image || null;

    await Promise.all(
      [...audience].map(userId =>
        sendRichNotification(userId, {
          kind: "forum",
          title: name,
          body: `replied to "${snippet}"`,
          avatarUrl: avatar,
          data: { post_id: postId },
        }).catch(() => null)
      )
    );
  } catch (error) {
    console.error("Failed to notify forum followers", error);
  }
};

const createForumReply = async (
  postId: string,
  payload: TCreateForumReply,
  authId: string
) => {
  const post = await prisma.forumPost.findUnique({
    where: { id: postId },
    select: { groupId: true },
  });
  if (!post) throw new ApiError(404, "Post not found.");

  await assertMember(post.groupId, authId);

  const suspendedReply = await assertNotSuspended(post.groupId, authId);
  if (suspendedReply) throw new ApiError(403, suspendedReply);

  const replyScreening = await screenContent({
    groupId: post.groupId,
    authorId: authId,
    content: payload.text,
    target: "REPLY",
  });
  if (!replyScreening.allowed) {
    throw new ApiError(403, replyScreening.message ?? "This reply was removed.");
  }

  // A reply to a reply must belong to the same post, or a thread could be
  // grafted onto a different discussion entirely.
  if (payload.parentId) {
    const parent = await prisma.forumReply.findUnique({
      where: { id: payload.parentId },
      select: { postId: true },
    });
    if (!parent || parent.postId !== postId) {
      throw new ApiError(400, "That reply is not on this post.");
    }
  }

  const reply = await prisma.forumReply.create({
    data: {
      postId,
      authorId: authId,
      text: payload.text,
      parentId: payload.parentId ?? null,
    },
    select: replySelect(authId),
  });

  void notifyFollowers(postId, authId, reply.author);

  return shapeReply(reply as RawReply, authId);
};

// One endpoint for both directions: reacting twice removes it, which is what
// tapping a filled heart means.
const toggleForumReaction = async (postId: string, authId: string) => {
  const post = await prisma.forumPost.findUnique({
    where: { id: postId },
    select: { groupId: true },
  });
  if (!post) throw new ApiError(404, "Post not found.");

  await assertMember(post.groupId, authId);

  const existing = await prisma.forumReaction.findUnique({
    where: { postId_authId: { postId, authId } },
    select: { id: true },
  });

  if (existing) {
    await prisma.forumReaction.delete({ where: { id: existing.id } });
  } else {
    await prisma.forumReaction.create({ data: { postId, authId } });
  }

  const reactionCount = await prisma.forumReaction.count({ where: { postId } });
  return { postId, hasReacted: !existing, reactionCount };
};

/// Voting again replaces your previous choice rather than adding a second, so
/// a poll always reports one vote per person.
const voteOnForumPoll = async (
  postId: string,
  optionId: string,
  authId: string
) => {
  const post = await prisma.forumPost.findUnique({
    where: { id: postId },
    select: { groupId: true, poll: { select: { id: true } } },
  });
  if (!post) throw new ApiError(404, "Post not found.");
  if (!post.poll) throw new ApiError(400, "This post has no poll.");

  await assertMember(post.groupId, authId);

  const option = await prisma.forumPollOption.findUnique({
    where: { id: optionId },
    select: { id: true, pollId: true },
  });
  if (!option || option.pollId !== post.poll.id) {
    throw new ApiError(400, "That option is not on this poll.");
  }

  await prisma.forumPollVote.upsert({
    where: { pollId_authId: { pollId: post.poll.id, authId } },
    create: { pollId: post.poll.id, optionId, authId },
    update: { optionId },
  });

  const poll = await prisma.forumPoll.findUnique({
    where: { id: post.poll.id },
    ...pollSelect,
  });

  return shapePoll(poll as RawPoll, optionId);
};

/// Following a post opts you into its reply notifications.
const toggleForumFollow = async (postId: string, authId: string) => {
  const post = await prisma.forumPost.findUnique({
    where: { id: postId },
    select: { groupId: true },
  });
  if (!post) throw new ApiError(404, "Post not found.");
  await assertMember(post.groupId, authId);

  const existing = await prisma.forumPostFollow.findUnique({
    where: { postId_authId: { postId, authId } },
    select: { id: true },
  });

  if (existing) {
    await prisma.forumPostFollow.delete({ where: { id: existing.id } });
  } else {
    await prisma.forumPostFollow.create({ data: { postId, authId } });
  }

  return { postId, isFollowing: !existing };
};

/// Toggles a like on a reply. Same shape as post reactions: a row per person,
/// so liking twice removes it rather than counting twice.
const toggleReplyReaction = async (replyId: string, authId: string) => {
  const reply = await prisma.forumReply.findUnique({
    where: { id: replyId },
    select: { post: { select: { groupId: true } } },
  });
  if (!reply) throw new ApiError(404, "Reply not found.");

  await assertMember(reply.post.groupId, authId);

  const existing = await prisma.forumReplyReaction.findUnique({
    where: { replyId_authId: { replyId, authId } },
    select: { id: true },
  });

  if (existing) {
    await prisma.forumReplyReaction.delete({ where: { id: existing.id } });
  } else {
    await prisma.forumReplyReaction.create({ data: { replyId, authId } });
  }

  const reactionCount = await prisma.forumReplyReaction.count({
    where: { replyId },
  });
  return { replyId, hasReacted: !existing, reactionCount };
};

/// Everything under one reply, for "Show more replies".
const getReplyThread = async (
  replyId: string,
  authId: string,
  options: TPaginationOptions
) => {
  const { page, take, skip } = calculatePagination(options);

  const children = await prisma.forumReply.findMany({
    where: { parentId: replyId },
    select: replySelect(authId),
    orderBy: { createdAt: "asc" },
    skip,
    take,
  });
  const total = await prisma.forumReply.count({ where: { parentId: replyId } });

  return {
    meta: { page, limit: take, total },
    replies: (children as RawReply[]).map(child => shapeReply(child, authId)),
  };
};

export const forumServices = {
  getGroupForumPosts,
  createForumPost,
  deleteForumPost,
  getForumReplies,
  createForumReply,
  toggleForumReaction,
  voteOnForumPoll,
  toggleForumFollow,
  toggleReplyReaction,
  getReplyThread,
};
