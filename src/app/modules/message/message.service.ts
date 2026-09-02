import { ChatType } from "@prisma/client";
import ApiError from "../../middlewares/classes/ApiError";
import prisma from "../../utils/prisma";
import { TSendMessage } from "./message.validation";
import {
  forumPostPreviewSelect,
  shapeForumPostPreview,
} from "../../utils/forumPostPreview";
import {
  calculatePagination,
  TPaginationOptions,
} from "../../utils/paginationCalculation";

const sendMessage = async (authId: string, payload: TSendMessage) => {
  const chat = await prisma.chat.findUniqueOrThrow({
    where: { id: payload.chatId },
    select: {
      id: true,
      type: true,
      blockedChatParticipants: true,
      participants: {
        select: {
          auth: {
            select: {
              id: true,
              business: {
                select: {
                  name: true,
                },
              },
              person: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      },
    },
  });

  const participantIds = chat.participants.map(p => p.auth.id);
  if (!participantIds.includes(authId)) {
    throw new ApiError(403, "You are not a participant of this chat!");
  }
  const partners = chat.participants.filter(p => p.auth.id !== authId);
  const partnerName =
    partners[0]?.auth.business?.name || partners[0]?.auth.person?.name;

  if (chat.blockedChatParticipants.some(bcp => bcp.authId === authId)) {
    throw new ApiError(
      400,
      `Can't send message! ${chat.type === ChatType.INDIVIDUAL ? `${partnerName} has blocked you!` : "You are blocked in this chat."}`
    );
  }

  // A private reply carries the post it is about. The id arrives from the
  // client, so it is checked here rather than trusted: the post must exist,
  // and the sender must be in the community it belongs to. Without the second
  // check, anyone could quote a post out of a community they cannot see and
  // hand its contents to someone else.
  if (payload.forumPostId) {
    const post = await prisma.forumPost.findUnique({
      where: { id: payload.forumPostId },
      select: { groupId: true },
    });
    if (!post) {
      throw new ApiError(404, "That forum post no longer exists.");
    }
    const membership = await prisma.chatParticipant.findFirst({
      where: { authId, chat: { groupId: post.groupId } },
      select: { id: true },
    });
    if (!membership) {
      throw new ApiError(403, "You are not in that post's community.");
    }
  }

  const messagePayload = {
    ...payload,
    senderId: authId,
  };

  const result = await prisma.$transaction(async tx => {
    const newMessage = await tx.message.create({
      data: messagePayload,
    });

    await tx.chat.update({
      where: { id: chat.id },
      data: {
        latestMessageAt: new Date(),
      },
    });

    return newMessage;
  });

  return result;
};

const getMessagesByChat = async (
  authId: string,
  chatId: string,
  options: TPaginationOptions
) => {
  const chat = await prisma.chat.findUniqueOrThrow({
    where: { id: chatId },
    select: {
      participants: {
        select: { authId: true },
      },
    },
  });

  const participantIds = chat.participants.map(p => p.authId);
  if (!participantIds.includes(authId)) {
    throw new ApiError(403, "You are not a participant of this chat!");
  }

  const { page, take, skip, sortBy, orderBy } = calculatePagination(options);

  const messages = await prisma.message.findMany({
    where: { chatId },
    select: {
      id: true,
      chatId: true,
      sender: {
        select: {
          id: true,
          person: { select: { id: true, name: true, image: true } },
          business: { select: { id: true, name: true, image: true } },
        },
      },
      text: true,
      file: true,
      fileType: true,
      isEdited: true,
      createdAt: true,
      // Null on an ordinary message; set when this is a private reply to a
      // forum post.
      forumPost: { select: forumPostPreviewSelect },
      messagesSeen: {
        select: {
          participant: {
            select: {
              auth: { select: { id: true } },
            },
          },
        },
      },
    },
    skip,
    take,
    orderBy: sortBy && orderBy ? { [sortBy]: orderBy } : { createdAt: "asc" },
  });

  const formattedMessages = await Promise.all(messages.map(async msg => {
    const seenIds = msg.messagesSeen.map((s: any) => s.participant.auth.id);
    const isRead = seenIds.includes(authId);

    // If this is an OFFER message, attach the offer data
    let offerData = null;
    if (msg.fileType === 'OFFER') {
      offerData = await prisma.offer.findFirst({
        where: { chatId: msg.chatId, senderId: msg.sender.id },
        include: {
          sender: {
            select: {
              id: true,
              person: { select: { name: true, image: true } },
              business: { select: { name: true, image: true } },
            },
          },
          receiver: {
            select: {
              id: true,
              person: { select: { name: true, image: true } },
              business: { select: { name: true, image: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    return {
      ...msg,
      messagesSeen: undefined,
      isRead,
      offerData,
      forumPost: shapeForumPostPreview(msg.forumPost),
    };
  }));

  const total = await prisma.message.count({ where: { chatId } });

  return {
    meta: { page, limit: take, total },
    messages: formattedMessages,
  };
};

const updateMessage = async (
  authId: string,
  messageId: string,
  payload: Partial<TSendMessage>
) => {
  const message = await prisma.message.findUniqueOrThrow({
    where: { id: messageId },
    select: {
      senderId: true,
    },
  });
  console.log("message.senderId, ", message.senderId, authId);
  if (message.senderId !== authId) {
    throw new ApiError(403, "You are not authorized to update this message!");
  }

  const result = await prisma.message.update({
    where: { id: messageId },
    data: {
      ...payload,
      isEdited: true,
    },
  });

  return result;
};

const seenMessages = async (authId: string, chatId: string) => {
  const chat = await prisma.chat.findUniqueOrThrow({
    where: { id: chatId },
    select: {
      participants: true,
    },
  });

  const myUnseenMessages = await prisma.message.findMany({
    where: {
      chatId,
      messagesSeen: {
        none: {
          participant: {
            authId,
          },
        },
      },
    },
    select: { id: true },
  });

  const participants = chat.participants.filter(p => p.authId === authId);

  const myParticipantId = participants.find(p => p.authId === authId)
    ?.id as string;

  const seenPayloads = myUnseenMessages.map(m => ({
    messageId: m.id,
    participantId: myParticipantId,
  }));

  const result = await prisma.messageSeen.createMany({
    data: seenPayloads,
    skipDuplicates: true,
  });

  return result;
};

export const messageService = {
  sendMessage,
  getMessagesByChat,
  updateMessage,
  seenMessages,
};
