import { Response } from "express";
import { TRequest } from "../../interface/global.interface";
import handleAsyncRequest from "../../utils/handleAsyncRequest";
import { sendResponse } from "../../utils/sendResponse";
import { offerService } from "./offer.service";

// Create a new offer
const create = handleAsyncRequest(async (req: TRequest, res: Response) => {
  const { receiverId, chatId, amount, description } = req.body;
  const senderId = req.user!.id;

  const offer = await offerService.create({
    senderId,
    receiverId,
    chatId,
    amount,
    description,
  });

  sendResponse(res, {
    status: 201,
    message: "Offer created successfully!",
    data: offer,
  });
});

// Get offers for a chat
const getByChatId = handleAsyncRequest(
  async (req: TRequest, res: Response) => {
    const { chatId } = req.params;
    const offers = await offerService.getByChatId(chatId);

    sendResponse(res, {
      message: "Offers retrieved successfully!",
      data: offers,
    });
  }
);

// Get a single offer
const getById = handleAsyncRequest(async (req: TRequest, res: Response) => {
  const { id } = req.params;
  const offer = await offerService.getById(id);

  sendResponse(res, {
    message: "Offer retrieved successfully!",
    data: offer,
  });
});

// Accept an offer
const accept = handleAsyncRequest(async (req: TRequest, res: Response) => {
  const { id } = req.params;
  const userId = req.user!.id;

  const offer = await offerService.accept(id, userId);

  sendResponse(res, {
    message: "Offer accepted successfully!",
    data: offer,
  });
});

// Decline an offer
const decline = handleAsyncRequest(async (req: TRequest, res: Response) => {
  const { id } = req.params;
  const userId = req.user!.id;

  const offer = await offerService.decline(id, userId);

  sendResponse(res, {
    message: "Offer declined successfully!",
    data: offer,
  });
});

// Pay for an offer
const pay = handleAsyncRequest(async (req: TRequest, res: Response) => {
  const { id } = req.params;
  const userId = req.user!.id;

  const offer = await offerService.pay(id, userId);

  sendResponse(res, {
    message: "Payment processed successfully!",
    data: offer,
  });
});

export const offerController = {
  create,
  getByChatId,
  getById,
  accept,
  decline,
  pay,
};
