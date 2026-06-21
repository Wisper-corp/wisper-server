import { Response } from 'express';
import handleAsyncRequest from '../../utils/handleAsyncRequest';
import { walletService } from './wallet.service';
import { sendResponse } from '../../utils/sendResponse';
import { TRequest } from '../../interface/global.interface';

// Get wallet balance
const getWalletBalance = handleAsyncRequest(async (req: TRequest, res: Response) => {
  const authId = req.user!.id;
  const result = await walletService.getWalletBalance(authId);
  sendResponse(res, {
    message: 'Wallet balance retrieved successfully',
    data: result,
  });
});

// Get wallet transactions
const getWalletTransactions = handleAsyncRequest(async (req: TRequest, res: Response) => {
  const authId = req.user!.id;
  const { page = '1', limit = '20' } = req.query;
  const result = await walletService.getWalletTransactions(
    authId,
    parseInt(page as string),
    parseInt(limit as string)
  );
  sendResponse(res, {
    message: 'Transactions retrieved successfully',
    data: result,
  });
});

// Monnify webhook handler (no auth needed)
const monnifyWebhook = handleAsyncRequest(async (req: TRequest, res: Response) => {
  const { eventType, eventData } = req.body;
  console.log('Monnify Webhook Received:', { eventType, transactionRef: eventData?.transactionReference });

  if (eventType !== 'SUCCESSFUL_TRANSACTION') {
    return sendResponse(res, {
      message: 'Event ignored - not a successful transaction',
      data: { status: 'ignored' },
    });
  }

  const result = await walletService.processMonnifyWebhook(eventData);
  sendResponse(res, {
    message: 'Webhook processed successfully',
    data: result,
  });
});

// Initialize Monnify payment
const initializeMonnifyPayment = handleAsyncRequest(async (req: TRequest, res: Response) => {
  const authId = req.user!.id;
  const { amount } = req.body;
  const result = await walletService.initializeMonnifyPayment(authId, amount);
  sendResponse(res, {
    message: 'Payment initialized successfully',
    data: result,
  });
});

// Withdraw funds
const withdrawFunds = handleAsyncRequest(async (req: TRequest, res: Response) => {
  const authId = req.user!.id;
  const { amount, bankCode, accountNumber, accountName } = req.body;
  const result = await walletService.withdrawFunds(authId, { amount, bankCode, accountNumber, accountName });
  sendResponse(res, {
    message: 'Withdrawal request submitted successfully',
    data: result,
  });
});

export const walletController = {
  getWalletBalance,
  getWalletTransactions,
  monnifyWebhook,
  initializeMonnifyPayment,
  withdrawFunds,
};
