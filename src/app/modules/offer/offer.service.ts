import { FileType, OfferStatus } from "@prisma/client";
import prisma from "../../utils/prisma";
import ApiError from "../../middlewares/classes/ApiError";
import { sendNotificationToUser } from "../../utils/sendNotification";

// Platform fee — 5% each side
const PLATFORM_FEE_PERCENT = 0.05;

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

const offerInclude = {
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
};

/** Get or create the admin escrow wallet. Uses ADMIN_ESCROW_AUTH_ID from env. */
const getEscrowWallet = async () => {
  const escrowAuthId = process.env.ADMIN_ESCROW_AUTH_ID;
  if (!escrowAuthId) {
    throw new ApiError(500, "Escrow wallet not configured. Contact support.");
  }

  let wallet = await prisma.wallet.findUnique({ where: { authId: escrowAuthId } });
  if (!wallet) {
    wallet = await prisma.wallet.create({ data: { authId: escrowAuthId, balance: 0 } });
  }
  return wallet;
};

// ─────────────────────────────────────────────
// CREATE OFFER
// ─────────────────────────────────────────────

const create = async (data: {
  senderId: string;
  receiverId: string;
  chatId: string;
  amount: number;
  description: string;
  duration: string;
}) => {
  const [offer] = await prisma.$transaction(async (tx) => {
    const newOffer = await tx.offer.create({
      data: { ...data, status: OfferStatus.PENDING },
      include: offerInclude,
    });

    await tx.message.create({
      data: {
        chatId: data.chatId,
        senderId: data.senderId,
        text: data.description,
        fileType: FileType.OFFER,
      },
    });

    await tx.chat.update({
      where: { id: data.chatId },
      data: { latestMessageAt: new Date() },
    });

    return [newOffer];
  });

  return offer;
};

// ─────────────────────────────────────────────
// GET OFFERS
// ─────────────────────────────────────────────

const getByChatId = async (chatId: string) => {
  return prisma.offer.findMany({
    where: { chatId },
    include: offerInclude,
    orderBy: { createdAt: "desc" },
  });
};

const getById = async (id: string) => {
  const offer = await prisma.offer.findUnique({ where: { id }, include: offerInclude });
  if (!offer) throw new ApiError(404, "Offer not found");
  return offer;
};

// ─────────────────────────────────────────────
// ACCEPT OFFER — Buyer pays into ESCROW
// Flow: buyer wallet → admin escrow wallet
// Buyer pays 5% platform fee upfront (total deducted = amount * 1.05)
// ─────────────────────────────────────────────

const accept = async (id: string, userId: string) => {
  const offer = await prisma.offer.findUnique({ where: { id } });
  if (!offer) throw new ApiError(404, "Offer not found");
  if (offer.receiverId !== userId) throw new ApiError(403, "Not authorized to accept this offer");
  if (offer.status !== OfferStatus.PENDING) throw new ApiError(400, "Offer is no longer pending");

  // Buyer pays: offer amount + 5% buyer fee
  const buyerFee = offer.amount * PLATFORM_FEE_PERCENT;
  const totalBuyerPays = offer.amount + buyerFee;

  const buyerWallet = await prisma.wallet.findUnique({ where: { authId: userId } });
  if (!buyerWallet) throw new ApiError(404, "Wallet not found. Please fund your wallet first.");
  if (buyerWallet.balance < totalBuyerPays) {
    throw new ApiError(
      400,
      `Insufficient balance. You need ₦${totalBuyerPays.toFixed(2)} (₦${offer.amount} + 5% fee) but have ₦${buyerWallet.balance.toFixed(2)}`
    );
  }

  const escrowWallet = await getEscrowWallet();

  const result = await prisma.$transaction(async (tx) => {
    // Deduct total from buyer (offer amount + 5% fee)
    await tx.wallet.update({
      where: { id: buyerWallet.id },
      data: { balance: { decrement: totalBuyerPays } },
    });

    await tx.transaction.create({
      data: {
        walletId: buyerWallet.id,
        type: "SPEND",
        amount: totalBuyerPays,
        date: new Date(),
      },
    });

    // Credit escrow with the offer amount only (platform keeps buyerFee)
    await tx.wallet.update({
      where: { id: escrowWallet.id },
      data: { balance: { increment: offer.amount } },
    });

    await tx.transaction.create({
      data: {
        walletId: escrowWallet.id,
        type: "DEPOSIT",
        amount: offer.amount,
        date: new Date(),
      },
    });

    // Mark offer ACCEPTED with escrow amount stored
    const updated = await tx.offer.update({
      where: { id },
      data: {
        status: OfferStatus.ACCEPTED,
        escrowAmount: offer.amount,
      },
      include: offerInclude,
    });

    return updated;
  });

  // Notify seller
  await sendNotificationToUser(
    offer.senderId,
    "Offer Accepted ✅",
    `Your offer of ₦${offer.amount} has been accepted. Payment is held in escrow.`
  );

  console.log(`Offer ${id} accepted — ₦${totalBuyerPays} deducted from buyer, ₦${offer.amount} in escrow`);
  return result;
};

// ─────────────────────────────────────────────
// RELEASE PAYMENT — Buyer releases escrow to seller after job completion
// Flow: admin escrow → seller wallet (minus 5% seller fee)
// ─────────────────────────────────────────────

const release = async (id: string, userId: string) => {
  const offer = await prisma.offer.findUnique({ where: { id } });
  if (!offer) throw new ApiError(404, "Offer not found");

  // Only the buyer (receiver) can release payment
  if (offer.receiverId !== userId) {
    throw new ApiError(403, "Only the buyer can release payment");
  }

  if (offer.status !== OfferStatus.ACCEPTED) {
    throw new ApiError(400, "Offer must be in ACCEPTED status to release payment");
  }

  const escrowAmount = offer.escrowAmount ?? offer.amount;
  const sellerFee = escrowAmount * PLATFORM_FEE_PERCENT;
  const sellerReceives = escrowAmount - sellerFee;

  const escrowWallet = await getEscrowWallet();

  if (escrowWallet.balance < sellerReceives) {
    throw new ApiError(500, "Escrow wallet has insufficient funds. Contact support.");
  }

  // Get or create seller wallet
  let sellerWallet = await prisma.wallet.findUnique({ where: { authId: offer.senderId } });
  if (!sellerWallet) {
    sellerWallet = await prisma.wallet.create({ data: { authId: offer.senderId, balance: 0 } });
  }

  const result = await prisma.$transaction(async (tx) => {
    // Deduct from escrow (full escrow amount — platform keeps seller fee from it)
    await tx.wallet.update({
      where: { id: escrowWallet.id },
      data: { balance: { decrement: escrowAmount } },
    });

    await tx.transaction.create({
      data: {
        walletId: escrowWallet.id,
        type: "SPEND",
        amount: escrowAmount,
        date: new Date(),
      },
    });

    // Credit seller (escrow amount - 5% seller fee)
    await tx.wallet.update({
      where: { id: sellerWallet!.id },
      data: { balance: { increment: sellerReceives } },
    });

    await tx.transaction.create({
      data: {
        walletId: sellerWallet!.id,
        type: "DEPOSIT",
        amount: sellerReceives,
        date: new Date(),
      },
    });

    const updated = await tx.offer.update({
      where: { id },
      data: { status: OfferStatus.RELEASED },
      include: offerInclude,
    });

    return updated;
  });

  // Notify seller
  await sendNotificationToUser(
    offer.senderId,
    "Payment Released 💰",
    `₦${sellerReceives.toFixed(2)} has been credited to your wallet (after 5% platform fee).`
  );

  console.log(
    `Offer ${id} released — escrow ₦${escrowAmount}, seller receives ₦${sellerReceives}, platform fee ₦${sellerFee}`
  );
  return result;
};

// ─────────────────────────────────────────────
// DISPUTE — Buyer opens a dispute
// ─────────────────────────────────────────────

const dispute = async (id: string, userId: string) => {
  const offer = await prisma.offer.findUnique({ where: { id } });
  if (!offer) throw new ApiError(404, "Offer not found");

  if (offer.receiverId !== userId) {
    throw new ApiError(403, "Only the buyer can open a dispute");
  }

  if (offer.status !== OfferStatus.ACCEPTED) {
    throw new ApiError(400, "Can only dispute an accepted offer");
  }

  const updated = await prisma.offer.update({
    where: { id },
    data: { status: OfferStatus.DISPUTED },
    include: offerInclude,
  });

  // Notify admin and seller
  const escrowAuthId = process.env.ADMIN_ESCROW_AUTH_ID;
  if (escrowAuthId) {
    await sendNotificationToUser(
      escrowAuthId,
      "Dispute Opened ⚠️",
      `A dispute has been opened for offer ${id}. Amount in escrow: ₦${offer.escrowAmount ?? offer.amount}.`
    );
  }
  await sendNotificationToUser(
    offer.senderId,
    "Dispute Opened ⚠️",
    "The buyer has opened a dispute on your offer. Our team will review and resolve it."
  );

  return updated;
};

// ─────────────────────────────────────────────
// DECLINE OFFER
// ─────────────────────────────────────────────

const decline = async (id: string, userId: string) => {
  const offer = await prisma.offer.findUnique({ where: { id } });
  if (!offer) throw new ApiError(404, "Offer not found");

  if (offer.receiverId !== userId && offer.senderId !== userId) {
    throw new ApiError(403, "Not authorized");
  }

  if (offer.status !== OfferStatus.PENDING) {
    throw new ApiError(400, "Offer is no longer pending");
  }

  return prisma.offer.update({
    where: { id },
    data: { status: OfferStatus.DECLINED },
    include: offerInclude,
  });
};

// ─────────────────────────────────────────────
// PAY (legacy — kept for backward compat)
// ─────────────────────────────────────────────

const pay = async (id: string, userId: string) => {
  // Redirect to release flow
  return release(id, userId);
};

export const offerService = {
  create,
  getByChatId,
  getById,
  accept,
  decline,
  pay,
  release,
  dispute,
};
