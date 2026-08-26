import { ModerationDecision } from "@prisma/client";
import { TRequest } from "../../interface/global.interface";
import handleAsyncRequest from "../../utils/handleAsyncRequest";
import { sendResponse } from "../../utils/sendResponse";
import { moderationServices } from "./moderation.service";

const appointModerator = handleAsyncRequest(async (req: TRequest, res) => {
  const { groupId, personaId } = req.body as {
    groupId: string;
    personaId?: string;
  };
  const result = await moderationServices.appointModerator(groupId, personaId);
  sendResponse(res, {
    message: `${result.name} is now this community's moderator.`,
    data: result,
  });
});

const log = handleAsyncRequest(async (req: TRequest, res) => {
  const decision = req.query.decision as ModerationDecision | undefined;
  const result = await moderationServices.log(
    req.params.groupId as string,
    Number(req.query.limit) || 50,
    decision
  );
  sendResponse(res, { message: "Moderation log retrieved.", data: result });
});

const flagged = handleAsyncRequest(async (req: TRequest, res) => {
  const result = await moderationServices.log(
    req.params.groupId as string,
    Number(req.query.limit) || 50,
    ModerationDecision.FLAGGED
  );
  sendResponse(res, {
    message: "Flagged content retrieved.",
    data: result.filter(v => v.reviewedAt === null),
  });
});

const resolve = handleAsyncRequest(async (req: TRequest, res) => {
  const { action } = req.body as { action: "keep" | "remove" };
  const result = await moderationServices.resolveVerdict(
    req.params.id as string,
    action === "remove" ? "remove" : "keep",
    req.user!.id
  );
  sendResponse(res, {
    message: action === "remove" ? "Content removed." : "Content kept.",
    data: result,
  });
});

const suspensions = handleAsyncRequest(async (req: TRequest, res) => {
  const result = await moderationServices.suspensions(
    req.params.groupId as string
  );
  sendResponse(res, { message: "Active suspensions retrieved.", data: result });
});

const liftSuspension = handleAsyncRequest(async (req: TRequest, res) => {
  const result = await moderationServices.liftSuspension(
    req.params.id as string
  );
  sendResponse(res, { message: "Suspension lifted.", data: result });
});

export const moderationController = {
  appointModerator,
  log,
  flagged,
  resolve,
  suspensions,
  liftSuspension,
};
