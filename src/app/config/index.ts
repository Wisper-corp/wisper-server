import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.join(process.cwd(), ".env") });

export default {
  env: process.env.NODE_ENV,
  port: process.env.PORT,
  generalChatId: process.env.GENERAL_CHAT_ID,
  // Community whose Jobs tab also surfaces the scraped job pool.
  // Unset -> no community shows scraped jobs.
  scrapedJobsGroupId: process.env.SCRAPED_JOBS_GROUP_ID,
  email: {
    emailSendingApi: process.env.SEND_EMAIL_URL,
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    accessExpiration: process.env.JWT_ACCESS_EXPIRATION,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    refreshExpiration: process.env.JWT_REFRESH_EXPIRATION,
  },
  admin: {
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  },
  aws: {
    accessKeyId: process.env.S3_BUCKET_ACCESS_KEY,
    secretAccessKey: process.env.S3_BUCKET_SECRET_ACCESS_KEY,
    s3BaseUrl: process.env.S3_BASE_URL,
    s3_api: process.env.S3_API,
    region: process.env.AWS_REGION,
    bucket: process.env.AWS_BUCKET_NAME,
    endpoint: process.env.SPACES_API,
  },
  payment: {
    secret_key: process.env.STRIPE_SECRET_KEY,
    callback_endpoint: process.env.PAYMENT_CALLBACK_ENDPOINT,
  },
  // AI provider. Deliberately generic: swapping DeepSeek for Anthropic (or any
  // OpenAI-compatible host) is an env change, not a code change.
  //   AI_PROVIDER   deepseek | anthropic | openai | openai-compatible
  //   AI_API_KEY    the provider's key
  //   AI_MODEL      model id; defaults per provider below
  //   AI_BASE_URL   only for openai-compatible hosts
  ai: {
    provider: (process.env.AI_PROVIDER || "deepseek").toLowerCase(),
    apiKey: process.env.AI_API_KEY || "",
    model:
      process.env.AI_MODEL ||
      (process.env.AI_PROVIDER === "anthropic"
        ? "claude-opus-5"
        : "deepseek-chat"),
    baseUrl: process.env.AI_BASE_URL || "https://api.deepseek.com",
  },
  agora: {
    appId: process.env.AGORA_APP_ID,
    appCertificate: process.env.AGORA_APP_CERTIFICATE,
    tokenExpireSeconds: process.env.AGORA_TOKEN_EXPIRE_SECONDS,
  },
  apns: {
    keyId: process.env.APNS_KEY_ID,
    teamId: process.env.APNS_TEAM_ID,
    bundleId: process.env.APNS_BUNDLE_ID,
    voipTopic: process.env.APNS_VOIP_TOPIC,
    privateKey: process.env.APNS_PRIVATE_KEY,
    useSandbox: process.env.APNS_USE_SANDBOX,
  },
};
