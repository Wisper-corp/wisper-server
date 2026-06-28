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

  console.log('Monnify Webhook Full Body:', JSON.stringify(req.body, null, 2));

  // Respond immediately with 200 - Monnify requires this fast response
  res.status(200).json({ success: true });

  // Process asynchronously after responding
  if (eventType === 'SUCCESSFUL_TRANSACTION' && eventData) {
    try {
      await walletService.processMonnifyWebhook(eventData);
      console.log('Monnify: wallet credited successfully');
    } catch (err: any) {
      console.error('Monnify: error crediting wallet:', err?.message);
    }
  }
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

// Monnify disbursement webhook - handles SUCCESSFUL_DISBURSEMENT / FAILED_DISBURSEMENT
const monnifyDisbursementWebhook = handleAsyncRequest(async (req: TRequest, res: Response) => {
  const { eventType, eventData } = req.body;
  console.log('Monnify Disbursement Webhook:', JSON.stringify({ eventType, ref: eventData?.reference }));

  // Respond 200 immediately
  res.status(200).json({ success: true });

  if (eventType === 'FAILED_DISBURSEMENT' && eventData) {
    try {
      const reference = eventData.reference;
      console.log('Disbursement failed for reference:', reference);
    } catch (err: any) {
      console.error('Error handling failed disbursement:', err?.message);
    }
  }
});

export const walletController = {
  getWalletBalance,
  getWalletTransactions,
  monnifyWebhook,
  monnifyDisbursementWebhook,
  initializeMonnifyPayment,
  withdrawFunds,
};
