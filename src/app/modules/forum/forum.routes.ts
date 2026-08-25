import { Router } from "express";
import { UserRole } from "@prisma/client";
import authorize from "../../middlewares/authorize";
import { upload } from "../../utils/awss3";
import handleZodValidation from "../../middlewares/handleZodValidation";
import { forumController } from "./forum.controller";
import { createForumPostZod, createForumReplyZod } from "./forum.validation";

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

export const forumRoutes = router;
