import { PostStatus } from '@prisma/client';
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

  // The fields above are everything the mobile SDK needs -- it opens its own
  // checkout. A browser has no SDK, so it needs somewhere to actually go, and
  // Monnify will hand back a hosted checkout page for the same reference.
  // Added alongside the existing fields rather than replacing them, so the app
  // keeps reading exactly what it read before.
  let checkoutUrl: string | null = null;
  try {
    const monnifyBaseUrl = process.env.MONNIFY_BASE_URL || 'https://api.monnify.com';
    const accessToken = await getMonnifyToken();

    const res = await fetch(`${monnifyBaseUrl}/api/v1/merchant/transactions/init-transaction`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount,
        customerName: name,
        customerEmail: email,
        paymentReference: transactionReference,
        paymentDescription: 'Wisper wallet top-up',
        currencyCode: 'NGN',
        contractCode: process.env.MONNIFY_CONTRACT_CODE,
        redirectUrl: process.env.WALLET_REDIRECT_URL || 'https://app.joinwisper.com/wallet',
        paymentMethods: ['CARD', 'ACCOUNT_TRANSFER', 'USSD'],
      }),
    });

    const body = (await res.json()) as any;
    checkoutUrl = body?.responseBody?.checkoutUrl ?? null;
  } catch (error: any) {
    // A checkout that could not be opened must not take the whole call down --
    // the mobile path does not need it and still works.
    console.error('Monnify init-transaction failed:', error?.message);
  }

  return { transactionReference, amount, email, name, user_id: authId, checkoutUrl };
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
    console.log('Monnify requires OTP authorization. Reference:', reference);

    // Do NOT deduct balance yet — wait for OTP confirmation
    // NOTE: Monnify does not return an authorizationCode in this response.
    // The user's OTP (from email) IS used directly as the authorizationCode in validate-otp.
    return {
      status: 'PENDING_OTP',
      message: 'An OTP has been sent to the registered Monnify email. Please enter it to complete the withdrawal.',
      reference,
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
// Monnify uses the OTP itself as the "authorizationCode" in the validate-otp request
const authorizeWithdrawal = async (
  authId: string,
  data: { reference: string; otp: string; amount: number }
) => {
  const { reference, otp, amount } = data;

  if (!reference) throw new ApiError(400, 'Reference is required');
  if (!otp) throw new ApiError(400, 'OTP is required');
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
      authorizationCode: otp,  // Monnify uses the OTP from email as the authorizationCode
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


/** What the signup bonus asks for, and what it gives. */
const SIGNUP_BONUS = {
  kind: "SIGNUP_1GB",
  label: "1GB Signup Bonus",
  services: 2,
  reviews: 3,
} as const;

/**
 * Whether this person has earned the signup bonus, and whether they took it.
 *
 * Eligibility is worked out fresh each time rather than stored: a photo can be
 * removed and a service deleted, and a saved "eligible" flag would outlive the
 * thing that earned it. A claim, by contrast, is a fact and is stored.
 */
const getSignupBonus = async (authId: string) => {
  const [auth, services, reviews, claim] = await Promise.all([
    prisma.auth.findUnique({
      where: { id: authId },
      select: { person: { select: { image: true } } },
    }),
    prisma.post.count({ where: { authorId: authId, status: PostStatus.ACTIVE } }),
    prisma.recommendation.count({ where: { receiverId: authId } }),
    prisma.bonusClaim.findUnique({
      where: { authId_kind: { authId, kind: SIGNUP_BONUS.kind } },
    }),
  ]);

  const steps = [
    { label: "Upload a profile photo", met: !!auth?.person?.image },
    {
      label: `Post ${SIGNUP_BONUS.services} services`,
      met: services >= SIGNUP_BONUS.services,
      detail: `${services} of ${SIGNUP_BONUS.services}`,
    },
    {
      label: `Get ${SIGNUP_BONUS.reviews} reviews`,
      met: reviews >= SIGNUP_BONUS.reviews,
      detail: `${reviews} of ${SIGNUP_BONUS.reviews}`,
    },
  ];

  return {
    kind: SIGNUP_BONUS.kind,
    label: SIGNUP_BONUS.label,
    steps,
    eligible: steps.every(s => s.met),
    claimed: !!claim,
    claimedAt: claim?.claimedAt ?? null,
    status: claim?.status ?? null,
  };
};

/**
 * Takes the bonus, once.
 *
 * The unique constraint on (authId, kind) is what actually prevents a double
 * claim -- two taps arriving together would both pass a read-then-write check.
 */
const redeemSignupBonus = async (authId: string) => {
  const bonus = await getSignupBonus(authId);

  if (bonus.claimed) throw new ApiError(400, "You have already redeemed this bonus!");
  if (!bonus.eligible)
    throw new ApiError(400, "Complete the steps above to redeem this bonus!");

  try {
    await prisma.bonusClaim.create({
      data: { authId, kind: SIGNUP_BONUS.kind },
    });
  } catch {
    throw new ApiError(400, "You have already redeemed this bonus!");
  }

  // The data itself is dispensed by Superjara, which is not connected yet.
  // The claim is recorded either way so nobody can take it twice in the
  // meantime, and so the backlog to dispense is known when it is.
  return getSignupBonus(authId);
};

export const walletService = {
  getSignupBonus,
  redeemSignupBonus,
  getWalletBalance,
  getWalletTransactions,
  processMonnifyWebhook,
  initializeMonnifyPayment,
  withdrawFunds,
  authorizeWithdrawal,
};
