import admin from "firebase-admin";
import { connect } from "http2";
import jwt from "jsonwebtoken";
import ApiError from "../middlewares/classes/ApiError";
import config from "../config";
import prisma from "./prisma";
import serviceAccount from "../private/firebase-service.json";

type TNotificationPayload = {
  receiverId: string;
  title: string;
  body: string;
};

const normalizeDataPayload = (data?: Record<string, any>) => {
  if (!data) return undefined;
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      value === undefined || value === null ? "" : String(value),
    ])
  );
};

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount as any),
  });
}

export const sendNotification = async (
  fcmToken: string[],
  payload: TNotificationPayload,
  extraData?: Record<string, any>
): Promise<any> => {
  try {
    if (!fcmToken?.length) return null;

    const dataPayload = normalizeDataPayload(extraData);

    // Android gets a DATA-ONLY message on purpose. A `notification` block is
    // drawn by the system tray, which cannot carry a large icon -- so the
    // sender's face never appears, and the app's own handler posts a second,
    // duplicate notification beside it. Data-only leaves rendering entirely to
    // RichNotification, which draws the avatar as the large icon with the
    // Wisper mark badged underneath it. Title and body therefore travel inside
    // `data` for Android; iOS still needs a real alert, so APNs carries one.
    const response = await admin.messaging().sendEachForMulticast({
      tokens: fcmToken,
      data: {
        ...(dataPayload ?? {}),
        title: payload.title,
        body: payload.body,
      },
      android: {
        // High priority so a message arrives while the phone is idle rather
        // than being batched until the next maintenance window.
        priority: "high" as const,
      },
      apns: {
        headers: {
          "apns-push-type": "alert",
        },
        payload: {
          aps: {
            alert: {
              title: payload.title,
              body: payload.body,
            },
            badge: 1,
            sound: "default",
          },
        },
      },
    });
    if (response.successCount) {
      await prisma.notification.create({ data: payload });
    }

    return response;
  } catch (error: any) {
    if (error?.code === "messaging/third-party-auth-error") {
      return null;
    } else {
      throw new ApiError(500, error.message || "Failed to send notification");
    }
  }
};

export const sendDataMessageToToken = async (
  fcmToken: string,
  data: Record<string, any>
) => {
  if (!fcmToken) return null;
  const payload = normalizeDataPayload(data);
  return admin.messaging().send({
    token: fcmToken,
    data: payload,
    android: {
      priority: "high",
    },
  });
};

const getApnsPrivateKey = () => {
  const privateKey = config.apns.privateKey;
  if (!privateKey) return null;

  return privateKey.includes("\\n")
    ? privateKey.replace(/\\n/g, "\n")
    : privateKey;
};

const createApnsAuthToken = () => {
  const teamId = config.apns.teamId;
  const keyId = config.apns.keyId;
  const privateKey = getApnsPrivateKey();

  if (!teamId || !keyId || !privateKey) {
    return null;
  }

  return jwt.sign({}, privateKey, {
    algorithm: "ES256",
    issuer: teamId,
    header: {
      alg: "ES256",
      kid: keyId,
    },
    expiresIn: "50m",
  });
};

export const sendVoipPushToToken = async (
  voipToken: string,
  data: Record<string, any>
) => {
  if (!voipToken) return null;

  const authToken = createApnsAuthToken();
  const bundleId = config.apns.bundleId;
  const topic = config.apns.voipTopic || (bundleId ? `${bundleId}.voip` : null);

  if (!authToken || !topic) {
    return null;
  }

  const host =
    config.apns.useSandbox === "true"
      ? "https://api.sandbox.push.apple.com"
      : "https://api.push.apple.com";

  const payload = JSON.stringify({
    aps: {
      "content-available": 1,
      sound: "default",
    },
    ...normalizeDataPayload(data),
  });

  return new Promise<{ status: number; body: string } | null>(
    (resolve, reject) => {
      const client = connect(host);

      client.on("error", error => {
        client.close();
        reject(error);
      });

      const request = client.request({
        ":method": "POST",
        ":path": `/3/device/${voipToken}`,
        authorization: `bearer ${authToken}`,
        "apns-push-type": "voip",
        "apns-priority": "10",
        "apns-topic": topic,
        "content-type": "application/json",
      });

      let responseBody = "";
      let statusCode = 0;

      request.setEncoding("utf8");

      request.on("response", headers => {
        statusCode = Number(headers[":status"] || 0);
      });

      request.on("data", chunk => {
        responseBody += chunk;
      });

      request.on("end", () => {
        client.close();

        if (statusCode >= 200 && statusCode < 300) {
          resolve({
            status: statusCode,
            body: responseBody,
          });
          return;
        }

        reject(
          new ApiError(
            500,
            responseBody || `APNs VoIP push failed with status ${statusCode}`
          )
        );
      });

      request.on("error", error => {
        client.close();
        reject(error);
      });

      request.end(payload);
    }
  );
};

/**
 * The kinds of notification the app knows how to draw.
 *
 * Each maps to its own Android channel so the phone can sound and group them
 * differently - a missed call should not arrive looking like a forum reply.
 */
export type NotificationKind =
  | "message"
  | "forum"
  | "activity"
  | "call_missed";

const CHANNEL_FOR: Record<NotificationKind, string> = {
  message: "messages_channel",
  forum: "forum_channel",
  activity: "activity_channel",
  call_missed: "calls_channel",
};

/**
 * Sends a notification the app can render richly.
 *
 * [avatarUrl] is the picture shown beside the text - the sender's face for a
 * message, the author's for a forum reply. The app downloads and draws it;
 * the server only carries the URL.
 */
export const sendRichNotification = async (
  receiverId: string,
  params: {
    kind: NotificationKind;
    title: string;
    body: string;
    avatarUrl?: string | null;
    data?: Record<string, any>;
  }
): Promise<any> =>
  sendNotificationToUser(receiverId, params.title, params.body, {
    ...(params.data ?? {}),
    type: params.kind,
    channel: CHANNEL_FOR[params.kind],
    ...(params.avatarUrl ? { avatar_url: params.avatarUrl } : {}),
  });

export const sendNotificationToUser = async (
  receiverId: string,
  title: string,
  body: string,
  extraData?: Record<string, any>
): Promise<any> => {
  const auth = await prisma.auth.findUnique({
    where: {
      id: receiverId,
    },
    select: {
      fcmToken: true,
      allowNotifications: true,
    },
  });

  if (!auth?.fcmToken || auth.allowNotifications === false) return null;

  return sendNotification(
    [auth.fcmToken],
    {
      receiverId,
      title,
      body,
    },
    extraData
  );
};

export const firebaseAdmin = admin;
