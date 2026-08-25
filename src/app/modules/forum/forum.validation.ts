import z from "zod";

// Images ride along as multipart files, so only the text fields are validated
// here. A caption is required even when images are attached - a forum post is
// a discussion, not a bare photo dump.
export const createForumPostZod = z.object({
  groupId: z.string().uuid({ message: "Invalid group id" }),
  text: z.string().trim().min(1, "Add a caption to go with your post."),
});

export const createForumReplyZod = z.object({
  text: z.string().trim().min(1, "Say something first.").max(5000),
});

export type TCreateForumPost = z.infer<typeof createForumPostZod>;
export type TCreateForumReply = z.infer<typeof createForumReplyZod>;
