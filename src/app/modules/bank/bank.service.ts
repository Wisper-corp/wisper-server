// Cache banks for 24 hours to avoid hitting Monnify repeatedly
let cachedBanks: Array<{ name: string; code: string }> = [];
let cacheExpiry = 0;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const getNigerianBanks = async (): Promise<Array<{ name: string; code: string }>> => {
  const now = Date.now();
  if (cachedBanks.length > 0 && now < cacheExpiry) {
    return cachedBanks;
  }

  try {
    const monnifyApiKey = process.env.MONNIFY_API_KEY || "";
    const monnifySecretKey = process.env.MONNIFY_SECRET_KEY || "";
    const monnifyBaseUrl = process.env.MONNIFY_BASE_URL || "https://api.monnify.com";

    // Get Monnify auth token
    const credentials = Buffer.from(`${monnifyApiKey}:${monnifySecretKey}`).toString("base64");
    const authRes = await fetch(`${monnifyBaseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/json" },
    });

    if (!authRes.ok) throw new Error("Monnify auth failed");
    const authData = await authRes.json() as any;
    const accessToken = authData.responseBody?.accessToken;

    // Fetch banks from Monnify
    const banksRes = await fetch(`${monnifyBaseUrl}/api/v1/sdk/transactions/banks`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!banksRes.ok) throw new Error("Failed to fetch banks from Monnify");
    const banksData = await banksRes.json() as any;
    const banks = (banksData.responseBody || []).map((b: any) => ({
      name: b.name,
      code: b.code,
    }));

    if (banks.length > 0) {
      cachedBanks = banks;
      cacheExpiry = now + CACHE_TTL_MS;
      return banks;
    }
  } catch (err) {
    console.error("Monnify banks fetch failed, using fallback:", err);
  }

  // Comprehensive fallback list of Nigerian banks
  return [
    { name: "Access Bank", code: "044" },
    { name: "Citibank Nigeria", code: "023" },
    { name: "Diamond Bank", code: "063" },
    { name: "Ecobank Nigeria", code: "050" },
    { name: "Fidelity Bank", code: "070" },
    { name: "First Bank of Nigeria", code: "011" },
    { name: "First City Monument Bank (FCMB)", code: "214" },
    { name: "Globus Bank", code: "103" },
    { name: "Guaranty Trust Bank (GTBank)", code: "058" },
    { name: "Heritage Bank", code: "030" },
    { name: "Jaiz Bank", code: "301" },
    { name: "Keystone Bank", code: "082" },
    { name: "Kuda Bank", code: "50211" },
    { name: "Moniepoint Microfinance Bank", code: "50515" },
    { name: "OPay", code: "999992" },
    { name: "PalmPay", code: "999991" },
    { name: "Parallex Bank", code: "104" },
    { name: "Polaris Bank", code: "076" },
    { name: "Providus Bank", code: "101" },
    { name: "Stanbic IBTC Bank", code: "221" },
    { name: "Standard Chartered Bank", code: "068" },
    { name: "Sterling Bank", code: "232" },
    { name: "SunTrust Bank", code: "100" },
    { name: "Titan Trust Bank", code: "102" },
    { name: "Union Bank of Nigeria", code: "032" },
    { name: "United Bank for Africa (UBA)", code: "033" },
    { name: "Unity Bank", code: "215" },
    { name: "VFD Microfinance Bank", code: "566" },
    { name: "Wema Bank", code: "035" },
    { name: "Zenith Bank", code: "057" },
  ];
};

export const bankService = { getNigerianBanks };
