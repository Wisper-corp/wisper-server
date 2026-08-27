import z from "zod";

// Images ride along as multipart files, so only the text fields are validated
// here. A caption is required even when images are attached - a forum post is
// a discussion, not a bare photo dump.
export const FORUM_POLL_MIN_OPTIONS = 2;
export const FORUM_POLL_MAX_OPTIONS = 10;

export const createForumPostZod = z.object({
  groupId: z.string().uuid({ message: "Invalid group id" }),
  text: z.string().trim().min(1, "Add a caption to go with your post."),
  // A poll's question is the post text, so a poll post still reads like every
  // other post in the feed.
  pollOptions: z
    .array(z.string().trim().min(1, "Poll options cannot be blank.").max(120))
    .min(FORUM_POLL_MIN_OPTIONS, "A poll needs at least two options.")
    .max(FORUM_POLL_MAX_OPTIONS, "A poll can have at most ten options.")
    .optional(),
});

export const forumPollVoteZod = z.object({
  optionId: z.string().uuid({ message: "Invalid option id" }),
});

export const createForumReplyZod = z.object({
  text: z.string().trim().min(1, "Say something first.").max(5000),
  // Replying to another reply rather than to the post itself.
  parentId: z.string().uuid({ message: "Invalid reply id" }).optional(),
});

export type TCreateForumPost = z.infer<typeof createForumPostZod>;
export type TCreateForumReply = z.infer<typeof createForumReplyZod>;
export type TForumPollVote = z.infer<typeof forumPollVoteZod>;
