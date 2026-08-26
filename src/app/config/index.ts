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
  // Agent bots. Polls are held back until the communities have enough real
  // members for a poll to gather meaningful votes - a poll with two voters
  // reads worse than no poll. Flip AGENT_POLLS=on to enable.
  agents: {
    pollsEnabled: (process.env.AGENT_POLLS || "").toLowerCase() === "on",
  },
  ai: (() => {
    // Accept the provider's own conventional key name as well as AI_API_KEY,
    // so an existing DEEPSEEK_API_KEY / ANTHROPIC_API_KEY just works and the
    // provider is inferred from whichever one is present.
    const explicit = (process.env.AI_PROVIDER || "").toLowerCase();
    const provider =
      explicit ||
      (process.env.ANTHROPIC_API_KEY ? "anthropic" : "") ||
      (process.env.DEEPSEEK_API_KEY ? "deepseek" : "") ||
      (process.env.OPENAI_API_KEY ? "openai" : "") ||
      "deepseek";

    const keyForProvider: Record<string, string | undefined> = {
      anthropic: process.env.ANTHROPIC_API_KEY,
      deepseek: process.env.DEEPSEEK_API_KEY,
      openai: process.env.OPENAI_API_KEY,
    };

    const defaults: Record<string, { model: string; baseUrl: string }> = {
      anthropic: { model: "claude-opus-5", baseUrl: "" },
      deepseek: { model: "deepseek-chat", baseUrl: "https://api.deepseek.com" },
      openai: { model: "gpt-4o-mini", baseUrl: "https://api.openai.com/v1" },
    };
    const fallback = defaults[provider] ?? defaults.deepseek!;

    return {
      provider,
      apiKey: process.env.AI_API_KEY || keyForProvider[provider] || "",
      model: process.env.AI_MODEL || fallback.model,
      baseUrl: process.env.AI_BASE_URL || fallback.baseUrl,
    };
  })(),
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
