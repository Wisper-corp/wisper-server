import { OfferStatus } from "@prisma/client";
import prisma from "../../utils/prisma";
import ApiError from "../../errors/ApiError";

// Create a new offer
const create = async (data: {
  senderId: string;
  receiverId: string;
  chatId: string;
  amount: number;
  description: string;
}) => {
  const offer = await prisma.offer.create({
    data: {
      ...data,
      status: OfferStatus.PENDING,
    },
    include: {
      sender: {
        select: {
          id: true,
          person: {
            select: {
              name: true,
              image: true,
            },
          },
          business: {
            select: {
              name: true,
              image: true,
            },
          },
        },
      },
      receiver: {
        select: {
          id: true,
          person: {
            select: {
              name: true,
              image: true,
            },
          },
          business: {
            select: {
              name: true,
              image: true,
            },
          },
        },
      },
    },
  });

  return offer;
};

// Get offers for a chat
const getByChatId = async (chatId: string) => {
  const offers = await prisma.offer.findMany({
    where: { chatId },
    include: {
      sender: {
        select: {
          id: true,
          person: {
            select: {
              name: true,
              image: true,
            },
          },
          business: {
            select: {
              name: true,
              image: true,
            },
          },
        },
      },
      receiver: {
        select: {
          id: true,
          person: {
            select: {
              name: true,
              image: true,
            },
          },
          business: {
            select: {
              name: true,
              image: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return offers;
};

// Get a single offer
const getById = async (id: string) => {
  const offer = await prisma.offer.findUnique({
    where: { id },
    include: {
      sender: {
        select: {
          id: true,
          person: {
            select: {
              name: true,
              image: true,
            },
          },
          business: {
            select: {
              name: true,
              image: true,
            },
          },
        },
      },
      receiver: {
        select: {
          id: true,
          person: {
            select: {
              name: true,
              image: true,
            },
          },
          business: {
            select: {
              name: true,
              image: true,
            },
          },
        },
      },
    },
  });

  if (!offer) {
    throw new ApiError(404, "Offer not found");
  }

  return offer;
};

// Accept an offer
const accept = async (id: string, userId: string) => {
  const offer = await prisma.offer.findUnique({
    where: { id },
  });

  if (!offer) {
    throw new ApiError(404, "Offer not found");
  }

  if (offer.receiverId !== userId) {
    throw new ApiError(403, "You are not authorized to accept this offer");
  }

  if (offer.status !== OfferStatus.PENDING) {
    throw new ApiError(400, "Offer is no longer pending");
  }

  const updatedOffer = await prisma.offer.update({
    where: { id },
    data: { status: OfferStatus.ACCEPTED },
    include: {
      sender: {
        select: {
          id: true,
          person: {
            select: {
              name: true,
              image: true,
            },
          },
          business: {
            select: {
              name: true,
              image: true,
            },
          },
        },
      },
      receiver: {
        select: {
          id: true,
          person: {
            select: {
              name: true,
              image: true,
            },
          },
          business: {
            select: {
              name: true,
              image: true,
            },
          },
        },
      },
    },
  });

  return updatedOffer;
};

// Decline an offer
const decline = async (id: string, userId: string) => {
  const offer = await prisma.offer.findUnique({
    where: { id },
  });

  if (!offer) {
    throw new ApiError(404, "Offer not found");
  }

  if (offer.receiverId !== userId) {
    throw new ApiError(403, "You are not authorized to decline this offer");
  }

  if (offer.status !== OfferStatus.PENDING) {
    throw new ApiError(400, "Offer is no longer pending");
  }

  const updatedOffer = await prisma.offer.update({
    where: { id },
    data: { status: OfferStatus.DECLINED },
    include: {
      sender: {
        select: {
          id: true,
          person: {
            select: {
              name: true,
              image: true,
            },
          },
          business: {
            select: {
              name: true,
              image: true,
            },
          },
        },
      },
      receiver: {
        select: {
          id: true,
          person: {
            select: {
              name: true,
              image: true,
            },
          },
          business: {
            select: {
              name: true,
              image: true,
            },
          },
        },
      },
    },
  });

  return updatedOffer;
};

// Pay for an offer
const pay = async (id: string, userId: string) => {
  const offer = await prisma.offer.findUnique({
    where: { id },
  });

  if (!offer) {
    throw new ApiError(404, "Offer not found");
  }

  if (offer.receiverId !== userId) {
    throw new ApiError(403, "You are not authorized to pay for this offer");
  }

  if (offer.status !== OfferStatus.ACCEPTED) {
    throw new ApiError(400, "Offer must be accepted before payment");
  }

  // Get receiver's wallet
  const receiverWallet = await prisma.wallet.findUnique({
    where: { authId: userId },
  });

  if (!receiverWallet) {
    throw new ApiError(404, "Wallet not found");
  }

  if (receiverWallet.balance < offer.amount) {
    throw new ApiError(400, "Insufficient balance");
  }

  // Get sender's wallet
  const senderWallet = await prisma.wallet.findUnique({
    where: { authId: offer.senderId },
  });

  if (!senderWallet) {
    throw new ApiError(404, "Sender wallet not found");
  }

  // Perform transaction in a database transaction
  const result = await prisma.$transaction(async (tx) => {
    // Deduct from receiver's wallet
    await tx.wallet.update({
      where: { authId: userId },
      data: { balance: receiverWallet.balance - offer.amount },
    });

    // Add to sender's wallet
    await tx.wallet.update({
      where: { authId: offer.senderId },
      data: { balance: senderWallet.balance + offer.amount },
    });

    // Create transaction records
    await tx.transaction.createMany({
      data: [
        {
          walletId: receiverWallet.id,
          amount: -offer.amount,
          type: "SPEND",
          date: new Date(),
        },
        {
          walletId: senderWallet.id,
          amount: offer.amount,
          type: "DEPOSIT",
          date: new Date(),
        },
      ],
    });

    // Update offer status to PAID
    const updatedOffer = await tx.offer.update({
      where: { id },
      data: { status: OfferStatus.PAID },
      include: {
        sender: {
          select: {
            id: true,
            person: {
              select: {
                name: true,
                image: true,
              },
            },
            business: {
              select: {
                name: true,
                image: true,
              },
            },
          },
        },
        receiver: {
          select: {
            id: true,
            person: {
              select: {
                name: true,
                image: true,
              },
            },
            business: {
              select: {
                name: true,
                image: true,
              },
            },
          },
        },
      },
    });

    return updatedOffer;
  });

  return result;
};

export const offerService = {
  create,
  getByChatId,
  getById,
  accept,
  decline,
  pay,
};
