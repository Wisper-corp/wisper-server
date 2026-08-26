import { TRequest } from "../../interface/global.interface";
import handleAsyncRequest from "../../utils/handleAsyncRequest";
import { sendResponse } from "../../utils/sendResponse";
import { agentServices } from "./agent.service";

const seedAgents = handleAsyncRequest(async (req: TRequest, res) => {
  const { groupId, total, activeCount } = req.body as {
    groupId: string;
    total?: number;
    activeCount?: number;
  };
  const result = await agentServices.seedAgents(
    groupId,
    total ?? 350,
    activeCount ?? 10
  );
  sendResponse(res, {
    message: `Seeded ${result.created} members, ${result.active} of them active.`,
    data: result,
    status: 201,
  });
});

const runNow = handleAsyncRequest(async (req: TRequest, res) => {
  const groupId = req.params.groupId as string;
  const mode = (req.query.mode as string) || "post";
  const result =
    mode === "reply"
      ? await agentServices.runReplyToUnanswered(groupId)
      : await agentServices.runStartDiscussion(groupId);
  sendResponse(res, { message: "Agent run complete.", data: result });
});

const listAgents = handleAsyncRequest(async (req: TRequest, res) => {
  const result = await agentServices.listAgents(req.params.groupId as string);
  sendResponse(res, { message: "Agents retrieved.", data: result });
});

const setPaused = handleAsyncRequest(async (req: TRequest, res) => {
  const { isPaused } = req.body as { isPaused: boolean };
  const result = await agentServices.setAgentPaused(
    req.params.id as string,
    Boolean(isPaused)
  );
  sendResponse(res, {
    message: result.isPaused ? "Agent paused." : "Agent resumed.",
    data: result,
  });
});

const activityLog = handleAsyncRequest(async (req: TRequest, res) => {
  const result = await agentServices.activityLog(
    req.params.groupId as string,
    Number(req.query.limit) || 50
  );
  sendResponse(res, { message: "Agent activity retrieved.", data: result });
});

const removeAgents = handleAsyncRequest(async (req: TRequest, res) => {
  const result = await agentServices.removeAgents(
    req.params.groupId as string
  );
  sendResponse(res, {
    message: `Removed ${result.removed} agent accounts.`,
    data: result,
  });
});

export const agentController = {
  seedAgents,
  runNow,
  listAgents,
  setPaused,
  activityLog,
  removeAgents,
};
