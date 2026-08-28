import ApiError from "../middlewares/classes/ApiError";

/// Sending an SMS, kept behind one function so the provider can be swapped
/// without touching the code that owns the OTP.
///
/// Sendchamp, previously Termii. The OTP itself is still generated, hashed,
/// expired and attempt-limited by us -- the provider only carries the text.

/// Most Nigerian mobile numbers sit on the DND register, which blocks ordinary
/// marketing traffic. OTPs have to go out on the `dnd` route or they are
/// accepted by the API and then never delivered.
const DEFAULT_ROUTE = "dnd";

/// Sendchamp wants a bare international number: digits only, no plus.
const normalizePhone = (phone: string) => {
  const digits = phone.replace(/[^\d]/g, "");
  // A local Nigerian number ("0803...") is not routable internationally.
  if (digits.startsWith("0")) return `234${digits.slice(1)}`;
  return digits;
};

export const sendSms = async (phone: string, message: string) => {
  const apiKey = process.env.SENDCHAMP_PUBLIC_KEY || "";
  const senderName = process.env.SENDCHAMP_SENDER_NAME || "Sendchamp";
  const baseUrl =
    process.env.SENDCHAMP_BASE_URL || "https://api.sendchamp.com/api/v1";
  const route = process.env.SENDCHAMP_ROUTE || DEFAULT_ROUTE;

  // Never fall back to logging the message. This used to print the OTP into
  // the server log and return success, so verification looked like it worked
  // while nothing was ever sent.
  if (!apiKey) {
    console.error("[Sendchamp] SENDCHAMP_PUBLIC_KEY is not set.");
    throw new ApiError(500, "SMS is not configured. Please contact support.");
  }

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/sms/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        to: [normalizePhone(phone)],
        message,
        sender_name: senderName,
        route,
      }),
    });
  } catch (error) {
    console.error("[Sendchamp] request failed:", error);
    throw new ApiError(500, "Failed to send SMS. Please try again.");
  }

  const raw = await res.text();

  if (!res.ok) {
    console.error(`[Sendchamp] ${res.status} for ${phone}:`, raw);
    throw new ApiError(500, "Failed to send SMS. Please try again.");
  }

  // A 200 is not proof of acceptance: an unregistered sender name or an
  // out-of-credit account comes back 200 with a failure in the body.
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error("[Sendchamp] unreadable response:", raw);
    throw new ApiError(500, "Failed to send SMS. Please try again.");
  }

  const ok =
    parsed?.status === "success" ||
    parsed?.code === "200" ||
    parsed?.code === 200;

  if (!ok) {
    console.error(`[Sendchamp] rejected for ${phone}:`, raw);
    throw new ApiError(
      500,
      parsed?.message || "Failed to send SMS. Please try again."
    );
  }

  return parsed;
};
