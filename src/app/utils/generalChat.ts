import { Prisma, PrismaClient } from "@prisma/client";
import config from "../config";

type PrismaClientLike = Prisma.TransactionClient | PrismaClient;

export const addUserToGeneralChat = async (
  prismaClient: PrismaClientLike,
  authId: string
) => {
  const generalChatId = config.generalChatId;
  if (!generalChatId) return;
  console.log("hitting here 1");
  const generalChat = await prismaClient.chat.findUnique({
    where: {
      id: generalChatId,
    },
    select: {
      id: true,
    },
  });

  if (!generalChat) return;
  console.log("hitting here 2");
  const existingParticipant = await prismaClient.chatParticipant.findFirst({
    where: {
      chatId: generalChatId,
      authId,
    },
    select: {
      id: true,
    },
  });
  console.log("existingParticipant", existingParticipant);
  if (existingParticipant) return;
  console.log("hitting here 3");
  await prismaClient.chatParticipant.create({
    data: {
      chatId: generalChatId,
      authId,
    },
  });
};
