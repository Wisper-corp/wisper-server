import { Request, Response } from 'express';
import { handleAsyncRequest } from '../../utils/handleAsyncRequest';
import { walletService } from './wallet.service';
import sendResponse from '../../utils/sendResponse';

// Get wallet balance
const getWalletBalance = handleAsyncRequest(async (req: Request, res: Response) => {
  const authId = req.user?.authId;
  
  const result = await walletService.getWalletBalance(authId);
  
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Wallet balance retrieved successfully',
    data: result,
  });
});

// Get wallet transactions
const getWalletTransactions = handleAsyncRequest(async (req: Request, res: Response) => {
  const authId = req.user?.authId;
  const { page = '1', limit = '20' } = req.query;
  
  const result = await walletService.getWalletTransactions(
    authId, 
    parseInt(page as string), 
    parseInt(limit as string)
  );
  
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Transactions retrieved successfully',
    data: result,
  });
});

// Monnify webhook handler
const monnifyWebhook = handleAsyncRequest(async (req: Request, res: Response) => {
  const { eventType, eventData } = req.body;
  
  console.log('🔔 Monnify Webhook Received:', { eventType, transactionRef: eventData?.transactionReference });
  
  // Only process successful transactions
  if (eventType !== 'SUCCESSFUL_TRANSACTION') {
    return sendResponse(res, {
      statusCode: 200,
      success: true,
      message: 'Event ignored - not a successful transaction',
      data: { status: 'ignored' },
    });
  }
  
  const result = await walletService.processMonnifyWebhook(eventData);
  
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Webhook processed successfully',
    data: result,
  });
});

// Initialize Monnify payment
const initializeMonnifyPayment = handleAsyncRequest(async (req: Request, res: Response) => {
  const authId = req.user?.authId;
  const { amount } = req.body;
  
  const result = await walletService.initializeMonnifyPayment(authId, amount);
  
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Payment initialized successfully',
    data: result,
  });
});

// Withdraw funds
const withdrawFunds = handleAsyncRequest(async (req: Request, res: Response) => {
  const authId = req.user?.authId;
  const { amount, bankCode, accountNumber, accountName } = req.body;
  
  const result = await walletService.withdrawFunds(authId, {
    amount,
    bankCode,
    accountNumber,
    accountName,
  });
  
  sendResponse(res, {
    statusCode: 200,
    success: true,
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
