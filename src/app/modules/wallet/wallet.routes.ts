import { Router } from 'express';
import { walletController } from './wallet.controller';
import authorize from '../../middlewares/authorize';

const router = Router();

// Protected routes (require authentication)
router.get('/balance', authorize(), walletController.getWalletBalance);
router.get('/transactions', authorize(), walletController.getWalletTransactions);
router.post('/initialize', authorize(), walletController.initializeMonnifyPayment);
router.post('/withdraw', authorize(), walletController.withdrawFunds);
router.post('/authorize-withdrawal', authorize(), walletController.authorizeWithdrawal);

// Public webhook route (no auth required)
router.post('/monnify/webhook', walletController.monnifyWebhook);
router.post('/monnify/disbursement-webhook', walletController.monnifyDisbursementWebhook);

export const walletRoutes = router;
