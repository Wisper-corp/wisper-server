import z from "zod";

export const createForumPostZod = z.object({
  groupId: z.string().uuid({ message: "Invalid group id" }),
  text: z.string().trim().min(1, "Say something first.").max(5000),
  images: z.array(z.string().url()).max(4).optional(),
});

export const createForumReplyZod = z.object({
  text: z.string().trim().min(1, "Say something first.").max(5000),
});

export type TCreateForumPost = z.infer<typeof createForumPostZod>;
export type TCreateForumReply = z.infer<typeof createForumReplyZod>;
