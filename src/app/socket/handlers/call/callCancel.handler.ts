import { CallParticipantStatus, CallRole, CallStatus } from "@prisma/client";
import ApiError from "../../../middlewares/classes/ApiError";
import prisma from "../../../utils/prisma";
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

