import { PostStatus } from '@prisma/client';
import prisma from '../../utils/prisma';
import ApiError from '../../middlewares/classes/ApiError';

// Get wallet balance - auto-create wallet if not exists
const getWalletBalance = async (authId: string) => {
  let wallet = await prisma.wallet.findUnique({
    where: { authId },
    select: { id: true, balance: true, bonusBalance: true },
  });

  // Auto-create wallet if it doesn't exist yet
  if (!wallet) {
    wallet = await prisma.wallet.create({
      data: { authId, balance: 0 },
      select: { id: true, balance: true, bonusBalance: true },
    });
  }

  // The bonus wallet shows what is waiting to be earned, so it is worked out
  // from the unclaimed bonuses rather than stored -- a stored figure would
  // have to be written to every account up front and would drift the moment a
  // bonus changed. The column stays for anything credited by hand.
  const bonuses = await getBonuses(authId);
  const waiting = bonuses
    .filter(b => !b.claimed && b.credits > 0)
    .reduce((sum, b) => sum + b.credits, 0);

  // bonusBalance is added alongside balance, never in place of it, so anything
  // already reading this endpoint keeps reading what it read before.
  return {
    balance: wallet.balance,
    bonusBalance: wallet.bonusBalance + waiting,
  };
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


/**
 * The bonuses, what each asks for, and what it pays.
 *
 * Kept as data rather than two near-identical functions, because the client
 * has already changed the conditions twice and will again.
 */
const BONUSES = {
  SIGNUP_1GB: {
    kind: 'SIGNUP_1GB',
    label: '1GB Signup Bonus',
    reward: '1GB data',
    /** Paid in data by Superjara, not in naira. */
    credits: 0,
  },
  INVITE_10K: {
    kind: 'INVITE_10K',
    label: 'NGN 10,000 Invite Bonus',
    reward: 'NGN 10,000',
    credits: 10000,
  },
} as const;

const SIGNUP_SERVICES = 2;
const SIGNUP_REVIEWS = 3;
const INVITES_REQUIRED = 10;

/**
 * Everything needed to judge both bonuses, in one pass.
 *
 * Eligibility is worked out fresh rather than stored: a photo can be removed,
 * a service deleted and a KYC field rejected, and a saved "eligible" flag
 * would outlive whatever earned it. A claim is a fact, so that is stored.
 */
const getBonuses = async (authId: string) => {
  const [auth, services, reviews, claims, kyc, invites] = await Promise.all([
    prisma.auth.findUnique({
      where: { id: authId },
      select: { person: { select: { id: true, image: true } } },
    }),
    prisma.post.count({ where: { authorId: authId, status: PostStatus.ACTIVE } }),
    prisma.recommendation.count({ where: { receiverId: authId } }),
    prisma.bonusClaim.findMany({ where: { authId } }),
    prisma.kycVerification.findUnique({
      where: { authId },
      select: {
        emailStatus: true,
        phoneStatus: true,
        ninStatus: true,
        addressStatus: true,
      },
    }),
    // "Invited" means someone signed up from this person's shared profile
    // link. It is the only invite there is.
    prisma.auth
      .findUnique({ where: { id: authId }, select: { person: { select: { id: true } } } })
      .then(a =>
        a?.person?.id
          ? prisma.person.count({ where: { referredById: a.person.id } })
          : 0
      ),
  ]);

  const claimed = (kind: string) => claims.find(c => c.kind === kind) ?? null;

  const kycFields = [
    kyc?.emailStatus,
    kyc?.phoneStatus,
    kyc?.ninStatus,
    kyc?.addressStatus,
  ];
  const kycDone = kycFields.filter(f => f === 'VERIFIED').length;
  const kycComplete = kycDone === kycFields.length;

  const build = (
    def: { kind: string; label: string; reward: string; credits: number },
    steps: { label: string; met: boolean; detail?: string }[]
  ) => {
    const claim = claimed(def.kind);
    return {
      ...def,
      steps,
      eligible: steps.every(st => st.met),
      claimed: !!claim,
      claimedAt: claim?.claimedAt ?? null,
      status: claim?.status ?? null,
    };
  };

  return [
    build(BONUSES.SIGNUP_1GB, [
      { label: 'Upload a profile photo', met: !!auth?.person?.image },
      {
        label: `Post ${SIGNUP_SERVICES} services`,
        met: services >= SIGNUP_SERVICES,
        detail: `${services} of ${SIGNUP_SERVICES}`,
      },
      {
        label: `Get ${SIGNUP_REVIEWS} reviews`,
        met: reviews >= SIGNUP_REVIEWS,
        detail: `${reviews} of ${SIGNUP_REVIEWS}`,
      },
    ]),
    build(BONUSES.INVITE_10K, [
      {
        label: 'Complete KYC',
        met: kycComplete,
        detail: `${kycDone} of ${kycFields.length} verified`,
      },
      {
        label: `Invite ${INVITES_REQUIRED} people`,
        met: invites >= INVITES_REQUIRED,
        detail: `${invites} of ${INVITES_REQUIRED}`,
      },
    ]),
  ];
};

/**
 * Takes one bonus, once, and pays it.
 *
 * The unique key on (authId, kind) is what actually prevents a double claim --
 * two taps arriving together would both pass a read-then-write check. The
 * credit and the claim go in one transaction so a paid bonus is always a
 * recorded one.
 */
const redeemBonus = async (authId: string, kind: string) => {
  const bonuses = await getBonuses(authId);
  const bonus = bonuses.find(b => b.kind === kind);

  if (!bonus) throw new ApiError(404, 'Unknown bonus!');
  if (bonus.claimed) throw new ApiError(400, 'You have already redeemed this bonus!');
  if (!bonus.eligible)
    throw new ApiError(400, 'Complete the steps above to redeem this bonus!');

  try {
    await prisma.$transaction(async tx => {
      await tx.bonusClaim.create({ data: { authId, kind } });

      if (bonus.credits > 0) {
        // Straight into the main balance: a bonus that cannot be withdrawn is
        // not money to the person holding it. The bonus wallet is where it
        // sits before it is earned, not after.
        await tx.wallet.upsert({
          where: { authId },
          update: { balance: { increment: bonus.credits } },
          create: { authId, balance: bonus.credits, bonusBalance: 0 },
        });

        await tx.transaction.create({
          data: {
            walletId: (await tx.wallet.findUniqueOrThrow({
              where: { authId },
              select: { id: true },
            })).id,
            type: 'DEPOSIT',
            amount: bonus.credits,
            date: new Date(),
          },
        });
      }
    });
  } catch (error: any) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'You have already redeemed this bonus!');
  }

  // The 1GB itself is dispensed by Superjara, which is not connected yet. The
  // claim is recorded either way, so nobody takes it twice and the backlog is
  // known when it is.
  return getBonuses(authId);
};

export const walletService = {
  getBonuses,
  redeemBonus,
  getWalletBalance,
  getWalletTransactions,
  processMonnifyWebhook,
  initializeMonnifyPayment,
  withdrawFunds,
  authorizeWithdrawal,
};
