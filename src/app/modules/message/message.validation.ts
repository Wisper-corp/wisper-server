import { z } from "zod";

export const sendMessageZod = z
  .object({
    chatId: z
      .string()
      .uuid({ message: "chatId is required and must be a valid UUID" }),
    text: z.string().optional(),
    file: z.string().optional(),
    fileType: z.enum(["IMAGE", "VIDEO", "AUDIO", "DOC", "OFFER"]).optional(),
    link: z.string().optional(),
    // Set when the message is a private reply to a forum post, so the
    // recipient can see what it is about.
    forumPostId: z
      .string()
      .uuid({ message: "forumPostId must be a valid UUID" })
      .optional(),
    // Set when this message quotes another one in the same chat.
    replyToId: z
      .string()
      .uuid({ message: "replyToId must be a valid UUID" })
      .optional(),
  })
  .refine(
    data => {
      if (data.file) return !!data.fileType;
      return true;
    },
    {
      message: "fileType is required when file is attached",
      path: ["fileType"],
    }
  );

export type TSendMessage = z.infer<typeof sendMessageZod>;
