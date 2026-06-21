import prisma from '../../utils/prisma';
import ApiError from '../../middlewares/classes/ApiError';

// Get wallet balance
const getWalletBalance = async (authId: string) => {
  const wallet = await prisma.wallet.findUnique({
    where: { authId },
    select: {
      id: true,
      balance: true,
    },
  });

  if (!wallet) {
    throw new ApiError(404, 'Wallet not found');
  }

  return { balance: wallet.balance };
};

// Get wallet transactions
const getWalletTransactions = async (authId: string, page: number = 1, limit: number = 20) => {
  const wallet = await prisma.wallet.findUnique({ where: { authId } });

  if (!wallet) {
    throw new ApiError(404, 'Wallet not found');
  }

  const skip = (page - 1) * limit;

  const [transactions, total] = await Promise.all([
    prisma.transaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { date: 'desc' },
      skip,
      take: limit,
      select: {
        id: true,
        type: true,
        amount: true,
        date: true,
      },
    }),
    prisma.transaction.count({ where: { walletId: wallet.id } }),
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
  const { transactionReference, amountPaid, paymentStatus, metaData } = eventData;

  if (paymentStatus !== 'PAID') {
    return { status: 'ignored', message: 'Payment not completed' };
  }

  // Get user from metadata
  const authId = metaData?.user_id;
  if (!authId) throw new ApiError(400, 'User ID not found in metadata');

  // Get or create wallet
  let wallet = await prisma.wallet.findUnique({ where: { authId } });
  if (!wallet) {
    wallet = await prisma.wallet.create({ data: { authId, balance: 0 } });
  }

  // Update wallet balance and create transaction
  const result = await prisma.$transaction(async (tx) => {
    const updatedWallet = await tx.wallet.update({
      where: { id: wallet!.id },
      data: { balance: { increment: parseFloat(amountPaid) } },
    });

    const transaction = await tx.transaction.create({
      data: {
        walletId: wallet!.id,
        type: 'DEPOSIT',
        amount: parseFloat(amountPaid),
        date: new Date(),
      },
    });

    return { wallet: updatedWallet, transaction };
  });

  return {
    status: 'success',
    message: 'Wallet updated successfully',
    data: { balance: result.wallet.balance },
  };
};

// Initialize Monnify payment
const initializeMonnifyPayment = async (authId: string, amount: number) => {
  if (!amount || amount < 100) throw new ApiError(400, 'Minimum amount is ₦100');

  const auth = await prisma.auth.findUnique({
    where: { id: authId },
    include: { person: true, business: true },
  });

  if (!auth) throw new ApiError(404, 'User not found');

  const email = auth.person?.email || auth.business?.email || '';
  const name = auth.person?.name || auth.business?.name || 'User';
  const transactionReference = `WSPR_${Date.now()}`;

  return { transactionReference, amount, email, name, user_id: authId };
};

// Withdraw funds
const withdrawFunds = async (
  authId: string,
  data: { amount: number; bankCode: string; accountNumber: string; accountName: string }
) => {
  const { amount, bankCode, accountNumber, accountName } = data;

  if (!amount || amount < 1000) throw new ApiError(400, 'Minimum withdrawal amount is ₦1,000');

  const wallet = await prisma.wallet.findUnique({ where: { authId } });
  if (!wallet) throw new ApiError(404, 'Wallet not found');
  if (wallet.balance < amount) throw new ApiError(400, 'Insufficient balance');

  const transaction = await prisma.$transaction(async (tx) => {
    await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: { decrement: amount } },
    });

    const txn = await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: 'WITHDRAW',
        amount,
        date: new Date(),
      },
    });

    return txn;
  });

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
