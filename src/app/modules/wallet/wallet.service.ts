import prisma from '../../utils/prisma';
import ApiError from '../../middlewares/classes/ApiError';

// Get wallet balance - auto-create wallet if not exists
const getWalletBalance = async (authId: string) => {
  let wallet = await prisma.wallet.findUnique({
    where: { authId },
    select: { id: true, balance: true },
  });

  // Auto-create wallet if it doesn't exist yet
  if (!wallet) {
    wallet = await prisma.wallet.create({
      data: { authId, balance: 0 },
      select: { id: true, balance: true },
    });
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
  console.log('Processing Monnify eventData:', JSON.stringify(eventData, null, 2));

  const { amountPaid, totalPayable, paymentStatus, metaData, customerEmail } = eventData;

  const isPaid = paymentStatus === 'PAID' || paymentStatus === 'SUCCESS' || paymentStatus === 'COMPLETED';
  if (!isPaid) {
    console.log('Payment not completed, status:', paymentStatus);
    return { status: 'ignored', message: 'Payment not completed' };
  }

  // Get amount - use amountPaid or totalPayable
  const amount = parseFloat(amountPaid || totalPayable || '0');
  if (amount <= 0) {
    throw new ApiError(400, 'Invalid payment amount');
  }

  // Get user from metadata or find by email
  let authId = metaData?.user_id || metaData?.userId;

  if (!authId && customerEmail) {
    console.log('No user_id in metaData, searching by email:', customerEmail);

    // First try auth table directly
    const auth = await prisma.auth.findFirst({
      where: { email: customerEmail },
      select: { id: true },
    });
    authId = auth?.id;

    if (!authId) {
      const person = await prisma.person.findFirst({
        where: { email: customerEmail },
        select: { auth: { select: { id: true } } },
      });
      const business = !person ? await prisma.business.findFirst({
        where: { email: customerEmail },
        select: { auth: { select: { id: true } } },
      }) : null;
      authId = person?.auth?.id || business?.auth?.id;
    }
  }

  if (!authId) {
    console.error('Cannot find user for payment. metaData:', metaData, 'email:', customerEmail);
    throw new ApiError(400, 'User ID not found - cannot credit wallet');
  }

  console.log('Crediting wallet for user:', authId, 'amount:', amount);

  // Get or create wallet
  let wallet = await prisma.wallet.findUnique({ where: { authId } });
  if (!wallet) {
    wallet = await prisma.wallet.create({ data: { authId, balance: 0 } });
  }

  // Update wallet balance and create transaction
  const result = await prisma.$transaction(async (tx) => {
    const updatedWallet = await tx.wallet.update({
      where: { id: wallet!.id },
      data: { balance: { increment: amount } },
    });

    const transaction = await tx.transaction.create({
      data: {
        walletId: wallet!.id,
        type: 'DEPOSIT',
        amount: amount,
        date: new Date(),
      },
    });

    return { wallet: updatedWallet, transaction };
  });

  console.log('Wallet credited. New balance:', result.wallet.balance);

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

// Helper: get Monnify access token
const getMonnifyToken = async (): Promise<string> => {
  const monnifyApiKey = process.env.MONNIFY_API_KEY!;
  const monnifySecretKey = process.env.MONNIFY_SECRET_KEY!;
  const monnifyBaseUrl = process.env.MONNIFY_BASE_URL || 'https://api.monnify.com';

  const credentials = Buffer.from(`${monnifyApiKey}:${monnifySecretKey}`).toString('base64');
  const authRes = await fetch(`${monnifyBaseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/json' },
  });

  if (!authRes.ok) throw new ApiError(500, 'Failed to authenticate with Monnify');
  const authData = await authRes.json() as any;
  const accessToken = authData.responseBody?.accessToken;
  if (!accessToken) throw new ApiError(500, 'Failed to get Monnify access token');
  return accessToken;
};

// Withdraw funds - calls Monnify Disbursement API
// Returns PENDING_OTP when Monnify requires OTP authorization (2FA enabled on account)
const withdrawFunds = async (
  authId: string,
  data: { amount: number; bankCode: string; accountNumber: string; accountName: string }
) => {
  const { amount, bankCode, accountNumber, accountName } = data;

  if (!amount || amount < 1000) throw new ApiError(400, 'Minimum withdrawal amount is ₦1,000');
  if (!bankCode) throw new ApiError(400, 'Bank code is required');
  if (!accountNumber) throw new ApiError(400, 'Account number is required');
  if (!accountName) throw new ApiError(400, 'Account name is required');

  const wallet = await prisma.wallet.findUnique({ where: { authId } });
  if (!wallet) throw new ApiError(404, 'Wallet not found');
  if (wallet.balance < amount) throw new ApiError(400, 'Insufficient balance');

  const monnifyBaseUrl = process.env.MONNIFY_BASE_URL || 'https://api.monnify.com';
  const sourceAccountNumber = process.env.MONNIFY_SOURCE_CODE!;

  // Step 1: Get access token
  const accessToken = await getMonnifyToken();

  // Step 2: Initiate disbursement
  const reference = `WSPR_WD_${Date.now()}_${authId.slice(0, 8)}`;
  const disbursementRes = await fetch(`${monnifyBaseUrl}/api/v2/disbursements/single`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount,
      reference,
      narration: 'Wisper Wallet Withdrawal',
      destinationBankCode: bankCode,
      destinationAccountNumber: accountNumber,
      destinationAccountName: accountName,
      currency: 'NGN',
      sourceAccountNumber,
    }),
  });

  const disbursementData = await disbursementRes.json() as any;
  console.log('Monnify disbursement response:', JSON.stringify(disbursementData));

  if (!disbursementRes.ok || disbursementData.requestSuccessful === false) {
    throw new ApiError(400, disbursementData.responseMessage || 'Monnify disbursement failed');
  }

  const responseBody = disbursementData.responseBody || {};
  const monnifyStatus = responseBody.status || '';

  // Step 3: Check if OTP authorization is required (Monnify 2FA enabled)
  if (monnifyStatus === 'PENDING_AUTHORIZATION') {
    const authorizationCode = responseBody.authorizationCode || '';
    console.log('Monnify requires OTP authorization. Reference:', reference, 'AuthCode:', authorizationCode);

    // Do NOT deduct balance yet — wait for OTP confirmation
    return {
      status: 'PENDING_OTP',
      message: 'An OTP has been sent to your registered email. Please enter it to complete the withdrawal.',
      reference,
      authorizationCode,
      amount,
    };
  }

  // Step 4: If no OTP needed, deduct balance and record transaction immediately
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
    status: 'SUCCESS',
    message: 'Withdrawal successful! Money will be in your account shortly.',
    reference,
    transaction,
    monnifyStatus,
  };
};

// Authorize withdrawal with OTP - called after user enters the OTP from email
const authorizeWithdrawal = async (
  authId: string,
  data: { reference: string; otp: string; authorizationCode: string; amount: number }
) => {
  const { reference, otp, authorizationCode, amount } = data;

  if (!reference) throw new ApiError(400, 'Reference is required');
  if (!otp) throw new ApiError(400, 'OTP is required');
  if (!authorizationCode) throw new ApiError(400, 'Authorization code is required');
  if (!amount || amount <= 0) throw new ApiError(400, 'Amount is required');

  const wallet = await prisma.wallet.findUnique({ where: { authId } });
  if (!wallet) throw new ApiError(404, 'Wallet not found');
  if (wallet.balance < amount) throw new ApiError(400, 'Insufficient balance');

  const monnifyBaseUrl = process.env.MONNIFY_BASE_URL || 'https://api.monnify.com';

  // Step 1: Get fresh access token
  const accessToken = await getMonnifyToken();

  // Step 2: Submit OTP to Monnify validate-otp endpoint
  const validateRes = await fetch(`${monnifyBaseUrl}/api/v2/disbursements/single/validate-otp`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      reference,
      authorizationCode,
      otp,
    }),
  });

  const validateData = await validateRes.json() as any;
  console.log('Monnify OTP validation response:', JSON.stringify(validateData));

  if (!validateRes.ok || validateData.requestSuccessful === false) {
    throw new ApiError(400, validateData.responseMessage || 'OTP validation failed. Please try again.');
  }

  const responseBody = validateData.responseBody || {};
  const monnifyStatus = responseBody.status || '';

  if (monnifyStatus !== 'SUCCESS' && monnifyStatus !== 'PENDING') {
    throw new ApiError(400, `Withdrawal not approved by Monnify (status: ${monnifyStatus})`);
  }

  // Step 3: OTP accepted — deduct balance and record transaction
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

  console.log('Withdrawal authorized and balance deducted for user:', authId, 'amount:', amount);

  return {
    status: 'SUCCESS',
    message: 'Withdrawal successful! Money will be in your account shortly.',
    reference,
    transaction,
    monnifyStatus,
  };
};

export const walletService = {
  getWalletBalance,
  getWalletTransactions,
  processMonnifyWebhook,
  initializeMonnifyPayment,
  withdrawFunds,
  authorizeWithdrawal,
};
