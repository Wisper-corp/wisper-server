import { CallParticipantStatus, CallRole, CallStatus } from "@prisma/client";
import ApiError from "../../../middlewares/classes/ApiError";
import prisma from "../../../utils/prisma";
import { sendRichNotification } from "../../../utils/sendNotification";
import { TAckFn, TSocket } from "../../interface/socket.interface";
import ackHandler from "../../utils/ackHandler";
import eventHandler from "../../utils/eventHandler";
import onlineUsers from "../../utils/onlineUsers";

type TCallCancelPayload = {
  callId: string;
};

const emitToParticipants = (
  participantIds: string[],
  event: string,
  payload: unknown
) => {
  participantIds.forEach(participantId => {
    const participantSocket = onlineUsers[participantId];
    if (participantSocket) {
      participantSocket.emit(event, payload);
    }
  });
};

export const callCancel = eventHandler<TCallCancelPayload>(
  async (socket: TSocket, data, ack: TAckFn) => {
    const authId = socket.auth.id;

    const call = await prisma.call.findUnique({
      where: {
        id: data.callId,
      },
      include: {
        participants: {
          select: {
            authId: true,
            role: true,
          },
        },
      },
    });

    if (!call) throw new ApiError(404, "Call not found.");

    const isCaller = call.participants.some(
      participant =>
        participant.authId === authId && participant.role === CallRole.CALLER
    );

    if (!isCaller) {
      throw new ApiError(403, "Only the caller can cancel this call.");
    }

    if (call.status !== CallStatus.RINGING) {
      throw new ApiError(400, "Call can only be canceled before acceptance.");
    }

    const now = new Date();

    const updatedCall = await prisma.call.update({
      where: {
        id: call.id,
      },
      data: {
        status: CallStatus.CANCELED,
        endedAt: now,
        duration: 0,
      },
    });

    await prisma.callParticipant.updateMany({
      where: {
        callId: call.id,
        leftAt: null,
      },
      data: {
        leftAt: now,
      },
    });

    // A caller who hangs up before anyone answers is the commonest missed
    // call, and it was not being recorded: only an explicit decline set
    // MISSED, so these calls never reached the receiver's Missed Calls tab.
    const missed = await prisma.callParticipant.findMany({
      where: {
        callId: call.id,
        role: CallRole.RECEIVER,
        status: CallParticipantStatus.INCOMING,
      },
      select: { authId: true },
    });

    await prisma.callParticipant.updateMany({
      where: {
        callId: call.id,
        role: CallRole.RECEIVER,
        status: CallParticipantStatus.INCOMING,
      },
      data: {
        status: CallParticipantStatus.MISSED,
      },
    });

    // Tell them they missed it. Without this the call simply never happened
    // from the receiver's point of view - the ring stops and nothing is left
    // behind.
    if (missed.length) {
      // The call record only carries ids, so look the caller up for a name
      // and face to put on the notification.
      const callerId = call.participants.find(
        participant => participant.role === CallRole.CALLER
      )?.authId;
      const caller = callerId
        ? await prisma.auth.findUnique({
            where: { id: callerId },
            select: {
              person: { select: { name: true, image: true } },
              business: { select: { name: true, image: true } },
            },
          })
        : null;
      const callerName =
        caller?.person?.name || caller?.business?.name || "Someone";
      const callerImage =
        caller?.person?.image || caller?.business?.image || null;
      const label = call.type === "VIDEO" ? "video call" : "voice call";

      void Promise.all(
        missed.map(participant =>
          sendRichNotification(participant.authId, {
            kind: "call_missed",
            title: callerName,
            body: `Missed ${label}`,
            avatarUrl: callerImage,
            data: { call_id: call.id, call_type: call.type },
          }).catch(() => null)
        )
      );
    }

    const participantIds = call.participants.map(
      participant => participant.authId
    );

    emitToParticipants(participantIds, "callCanceled", {
      callId: updatedCall.id,
      status: updatedCall.status,
    });

    ackHandler(ack, {
      success: true,
      message: "Call canceled.",
    });
  }
);

