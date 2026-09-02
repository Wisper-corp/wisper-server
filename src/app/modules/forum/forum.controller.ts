import { TRequest } from "../../interface/global.interface";
import handleAsyncRequest from "../../utils/handleAsyncRequest";
import pick from "../../utils/pick";
import { sendResponse } from "../../utils/sendResponse";
import { forumServices } from "./forum.service";

const getGroupForumPosts = handleAsyncRequest(async (req: TRequest, res) => {
  const options = pick(req.query, ["page", "limit", "sortBy", "orderBy"]);
  const result = await forumServices.getGroupForumPosts(
    req.params.groupId as string,
    options,
    req.user!.id
  );
  sendResponse(res, {
    message: "Forum posts retrieved successfully!",
    data: result,
  });
});

const getForumPost = handleAsyncRequest(async (req: TRequest, res) => {
  const result = await forumServices.getForumPost(
    req.params.id as string,
    req.user!.id
  );
  sendResponse(res, {
    message: "Forum post retrieved successfully!",
    data: result,
  });
});

const createForumPost = handleAsyncRequest(async (req: TRequest, res) => {
  const result = await forumServices.createForumPost(
    req.body,
    req.user!.id,
    req.files as never
  );
  sendResponse(res, {
    message: "Posted to the forum!",
    data: result,
    status: 201,
  });
});

const deleteForumPost = handleAsyncRequest(async (req: TRequest, res) => {
  const result = await forumServices.deleteForumPost(
    req.params.id as string,
    req.user!.id
  );
  sendResponse(res, { message: "Post deleted!", data: result });
});

const deleteForumReply = handleAsyncRequest(async (req: TRequest, res) => {
  const result = await forumServices.deleteForumReply(
    req.params.id as string,
    req.user!.id
  );
  sendResponse(res, {
    message: "Reply deleted.",
    data: result,
  });
});

const getForumReplies = handleAsyncRequest(async (req: TRequest, res) => {
  const options = pick(req.query, ["page", "limit"]);
  const result = await forumServices.getForumReplies(
    req.params.id as string,
    options,
    req.user!.id
  );
  sendResponse(res, {
    message: "Replies retrieved successfully!",
    data: result,
  });
});

const createForumReply = handleAsyncRequest(async (req: TRequest, res) => {
  const result = await forumServices.createForumReply(
    req.params.id as string,
    req.body,
    req.user!.id
  );
  sendResponse(res, { message: "Reply posted!", data: result, status: 201 });
});

const toggleForumReaction = handleAsyncRequest(async (req: TRequest, res) => {
  const result = await forumServices.toggleForumReaction(
    req.params.id as string,
    req.user!.id
  );
  sendResponse(res, { message: "Reaction updated!", data: result });
});

const voteOnForumPoll = handleAsyncRequest(async (req: TRequest, res) => {
  const result = await forumServices.voteOnForumPoll(
    req.params.id as string,
    req.body.optionId as string,
    req.user!.id
  );
  sendResponse(res, { message: "Vote recorded!", data: result });
});

const toggleForumFollow = handleAsyncRequest(async (req: TRequest, res) => {
  const result = await forumServices.toggleForumFollow(
    req.params.id as string,
    req.user!.id
  );
  sendResponse(res, {
    message: result.isFollowing
      ? "You'll be notified about new replies."
      : "You'll no longer be notified about this post.",
    data: result,
  });
});

const toggleReplyReaction = handleAsyncRequest(async (req: TRequest, res) => {
  const result = await forumServices.toggleReplyReaction(
    req.params.id as string,
    req.user!.id
  );
  sendResponse(res, { message: "Reaction updated!", data: result });
});

const getReplyThread = handleAsyncRequest(async (req: TRequest, res) => {
  const options = pick(req.query, ["page", "limit"]);
  const result = await forumServices.getReplyThread(
    req.params.id as string,
    req.user!.id,
    options
  );
  sendResponse(res, { message: "Thread retrieved successfully!", data: result });
});

export const forumController = {
  getGroupForumPosts,
  getForumPost,
  createForumPost,
  deleteForumPost,
  deleteForumReply,
  getForumReplies,
  createForumReply,
  toggleForumReaction,
  voteOnForumPoll,
  toggleForumFollow,
  toggleReplyReaction,
  getReplyThread,
};
