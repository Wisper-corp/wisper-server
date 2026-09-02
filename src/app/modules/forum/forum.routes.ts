import { Router } from "express";
import { UserRole } from "@prisma/client";
import authorize from "../../middlewares/authorize";
import { upload } from "../../utils/awss3";
import handleZodValidation from "../../middlewares/handleZodValidation";
import { forumController } from "./forum.controller";
import {
  createForumPostZod,
  createForumReplyZod,
  forumPollVoteZod,
} from "./forum.validation";

const router = Router();

router.get(
  "/group/:groupId",
  authorize(UserRole.PERSON, UserRole.BUSINESS),
  forumController.getGroupForumPosts
);

router.post(
  "/",
  authorize(UserRole.PERSON, UserRole.BUSINESS),
  upload.array("images"),
  handleZodValidation(createForumPostZod, { formData: true }),
  forumController.createForumPost
);

router.get(
  "/:id",
  authorize(UserRole.PERSON, UserRole.BUSINESS),
  forumController.getForumPost
);

router.delete(
  "/:id",
  authorize(UserRole.PERSON, UserRole.BUSINESS),
  forumController.deleteForumPost
);

router.get(
  "/:id/replies",
  authorize(UserRole.PERSON, UserRole.BUSINESS),
  forumController.getForumReplies
);

router.post(
  "/:id/replies",
  authorize(UserRole.PERSON, UserRole.BUSINESS),
  handleZodValidation(createForumReplyZod),
  forumController.createForumReply
);

router.patch(
  "/:id/reaction",
  authorize(UserRole.PERSON, UserRole.BUSINESS),
  forumController.toggleForumReaction
);

router.post(
  "/:id/poll/vote",
  authorize(UserRole.PERSON, UserRole.BUSINESS),
  handleZodValidation(forumPollVoteZod),
  forumController.voteOnForumPoll
);

router.patch(
  "/:id/follow",
  authorize(UserRole.PERSON, UserRole.BUSINESS),
  forumController.toggleForumFollow
);

// A reply's own thread and its likes.
router.get(
  "/reply/:id/thread",
  authorize(UserRole.PERSON, UserRole.BUSINESS),
  forumController.getReplyThread
);

router.delete(
  "/reply/:id",
  authorize(UserRole.PERSON, UserRole.BUSINESS),
  forumController.deleteForumReply
);

router.patch(
  "/reply/:id/reaction",
  authorize(UserRole.PERSON, UserRole.BUSINESS),
  forumController.toggleReplyReaction
);

export const forumRoutes = router;
