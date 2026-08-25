import { Prisma } from "@prisma/client";
import ApiError from "../../middlewares/classes/ApiError";
import prisma from "../../utils/prisma";
import {
  calculatePagination,
  TPaginationOptions,
} from "../../utils/paginationCalculation";
import { TFile } from "../../interface/file.interface";
import { uploadToS3 } from "../../utils/awss3";
import { TCreateForumPost, TCreateForumReply } from "./forum.validation";

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
    isMine: post.author.id === authId,
    replyAvatars: post.replies.map(reply => ({
      id: reply.author.id,
      image: reply.author.person?.image || reply.author.business?.image || null,
    })),
  }));

  return { meta: { page, limit: take, total }, posts: shaped };
};

/// A forum post carries at most this many images.
export const FORUM_MAX_IMAGES = 4;

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

  const post = await prisma.forumPost.create({
    data: {
      groupId: payload.groupId,
      authorId: authId,
      text,
      images,
    },
    select: {
      id: true,
      text: true,
      images: true,
      isEdited: true,
      createdAt: true,
      author: authorSelect,
    },
  });

  return {
    ...post,
    author: shapeAuthor(post.author),
    replyCount: 0,
    reactionCount: 0,
    hasReacted: false,
    isMine: true,
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
    const admin = await prisma.chatParticipant.findFirst({
      where: { authId, chat: { groupId: post.groupId }, role: "ADMIN" },
      select: { id: true },
    });
    if (!admin) throw new ApiError(403, "You can only delete your own posts.");
  }

  await prisma.forumPost.delete({ where: { id: postId } });
  return { id: postId };
};

const getForumReplies = async (postId: string, options: TPaginationOptions) => {
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

  const replies = await prisma.forumReply.findMany({
    where: { postId },
    select: {
      id: true,
      text: true,
      isEdited: true,
      createdAt: true,
      author: authorSelect,
    },
    orderBy: { createdAt: "asc" },
    skip,
    take,
  });

  return {
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
    replies: replies.map(reply => ({
      id: reply.id,
      text: reply.text,
      isEdited: reply.isEdited,
      createdAt: reply.createdAt,
      author: shapeAuthor(reply.author),
    })),
  };
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

  const reply = await prisma.forumReply.create({
    data: { postId, authorId: authId, text: payload.text },
    select: {
      id: true,
      text: true,
      isEdited: true,
      createdAt: true,
      author: authorSelect,
    },
  });

  return { ...reply, author: shapeAuthor(reply.author) };
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

export const forumServices = {
  getGroupForumPosts,
  createForumPost,
  deleteForumPost,
  getForumReplies,
  createForumReply,
  toggleForumReaction,
};
