import prisma from '../../utils/prisma';
import { ApiError } from '../../middlewares/globalErrorHandler';

// Get wallet balance
const getWalletBalance = async (authId: string) => {
  const wallet = await prisma.wallet.findUnique({
    where: { authId },
    select: {
      id: true,
      balance: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!wallet) {
    throw new ApiError(404, 'Wallet not found');
  }

  return { balance: wallet.balance };
};

// Get wallet transactions
const getWalletTransactions = async (authId: string, page: number = 1, limit: number = 20) => {
  const wallet = await prisma.wallet.findUnique({
    where: { authId },
  });

  if (!wallet) {
    throw new ApiError(404, 'Wallet not found');
  }

  const skip = (page - 1) * limit;

  const [transactions, total] = await Promise.all([
    prisma.transaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      select: {
        id: true,
        type: true,
        amount: true,
        status: true,
        description: true,
        reference: true,
        createdAt: true,
      },
    }),
    prisma.transaction.count({
      where: { walletId: wallet.id },
    }),
  ]);

  return {
    transactions,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

// Process Monnify webhook
const processMonnifyWebhook = async (eventData: any) => {
  const {
    transactionReference,
    paymentReference,
    amountPaid,
    paymentStatus,
    metaData,
  } = eventData;

  // Verify payment is paid
  if (paymentStatus !== 'PAID') {
    console.log('⚠️ Payment not completed:', paymentStatus);
    return { status: 'ignored', message: 'Payment not completed' };
  }

  // Check for duplicate
  const existingTx = await prisma.transaction.findFirst({
    where: { reference: transactionReference },
  });

  if (existingTx) {
    console.log('⚠️ Transaction already processed:', transactionReference);
    return { status: 'duplicate', message: 'Transaction already processed' };
  }

  // Get user from metadata
  const authId = metaData?.user_id;

  if (!authId) {
    throw new ApiError(400, 'User ID not found in metadata');
  }

  // Get or create wallet
  let wallet = await prisma.wallet.findUnique({
    where: { authId },
  });

  if (!wallet) {
    wallet = await prisma.wallet.create({
      data: {
        authId,
        balance: 0,
      },
    });
  }

  // Update wallet and create transaction in a transaction
  const result = await prisma.$transaction(async (tx) => {
    // Update wallet balance
    const updatedWallet = await tx.wallet.update({
      where: { id: wallet!.id },
      data: {
        balance: {
          increment: parseFloat(amountPaid),
        },
      },
    });

    // Create transaction record
    const transaction = await tx.transaction.create({
      data: {
        walletId: wallet!.id,
        type: 'CREDIT',
        amount: parseFloat(amountPaid),
        status: 'COMPLETED',
        description: 'Wallet Funding via Monnify',
        reference: transactionReference,
        metaData: JSON.stringify(eventData),
      },
    });

    return { wallet: updatedWallet, transaction };
  });

  console.log(`✅ Wallet credited: User ${authId}, Amount: ₦${amountPaid}`);

  return {
    status: 'success',
    message: 'Wallet updated successfully',
    data: {
      balance: result.wallet.balance,
      transaction: result.transaction,
    },
  };
};

// Initialize Monnify payment
const initializeMonnifyPayment = async (authId: string, amount: number) => {
  if (!amount || amount < 100) {
    throw new ApiError(400, 'Minimum amount is ₦100');
  }

  // Get user details
  const auth = await prisma.auth.findUnique({
    where: { id: authId },
    include: {
      person: true,
      business: true,
    },
  });

  if (!auth) {
    throw new ApiError(404, 'User not found');
  }

  const email = auth.person?.email || auth.business?.email || '';
  const name = auth.person?.name || auth.business?.name || 'User';

  // Generate transaction reference
  const transactionReference = `WSPR_${Date.now()}`;

  return {
    transactionReference,
    amount,
    email,
    name,
    user_id: authId,
  };
};

// Withdraw funds
const withdrawFunds = async (
  authId: string,
  data: {
    amount: number;
    bankCode: string;
    accountNumber: string;
    accountName: string;
  }
) => {
  const { amount, bankCode, accountNumber, accountName } = data;

  // Validate amount
  if (!amount || amount < 1000) {
    throw new ApiError(400, 'Minimum withdrawal amount is ₦1,000');
  }

  // Get wallet
  const wallet = await prisma.wallet.findUnique({
    where: { authId },
  });

  if (!wallet) {
    throw new ApiError(404, 'Wallet not found');
  }

  // Check balance
  if (wallet.balance < amount) {
    throw new ApiError(400, 'Insufficient balance');
  }

  // Create withdrawal transaction
  const transaction = await prisma.$transaction(async (tx) => {
    // Deduct balance
    await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        balance: {
          decrement: amount,
        },
      },
    });

    // Create transaction
    const txn = await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: 'DEBIT',
        amount,
        status: 'PENDING',
        description: `Withdrawal to ${accountName} - ${accountNumber}`,
        reference: `WTH_${Date.now()}`,
        metaData: JSON.stringify({ bankCode, accountNumber, accountName }),
      },
    });

    return txn;
  });

  console.log(`💸 Withdrawal initiated: User ${authId}, Amount: ₦${amount}`);

  return {
    message: 'Withdrawal request submitted. Processing within 24 hours.',
    transaction,
  };
};

export const walletService = {
  getWalletBalance,
  getWalletTransactions,
  processMonnifyWebhook,
  initializeMonnifyPayment,
  withdrawFunds,
};
