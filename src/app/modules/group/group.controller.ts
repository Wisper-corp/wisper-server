import { TFile } from "../../interface/file.interface";
import { TRequest } from "../../interface/global.interface";
import handleAsyncRequest from "../../utils/handleAsyncRequest";
import pick from "../../utils/pick";
import { sendResponse } from "../../utils/sendResponse";
import { groupServices } from "./group.service";
import prisma from "../../utils/prisma";
import ApiError from "../../middlewares/classes/ApiError";

const createGroup = handleAsyncRequest(async (req: TRequest, res) => {
  const result = await groupServices.createGroup(req.body, req.user!.id);
  sendResponse(res, {
    message: "Group created successfully!",
    data: result,
    status: 201,
  });
});

const getAllGroups = handleAsyncRequest(async (req: TRequest, res) => {
  const options = pick(req.query, ["page", "limit", "sortBy", "orderBy"]);
  const result = await groupServices.getAllGroups(
    options,
    req.query,
    req.user!.id
  );
  sendResponse(res, {
    message: "Groups retrieved successfully!",
    data: result,
  });
});

const getPublicGroups = handleAsyncRequest(async (req: TRequest, res) => {
  const options = pick(req.query, ["page", "limit", "sortBy", "orderBy"]);
  const result = await groupServices.getPublicGroups(options, req.query, req.user!.id);
  sendResponse(res, {
    message: "Public groups retrieved successfully!",
    data: result,
  });
});

const getSingleGroup = handleAsyncRequest(async (req: TRequest, res) => {
  const result = await groupServices.getSingleGroup(req.params.id as string);
  sendResponse(res, {
    message: "Group retrieved successfully!",
    data: result,
  });
});

const getGroupMembers = handleAsyncRequest(async (req: TRequest, res) => {
  const options = pick(req.query, ["page", "limit", "sortBy", "orderBy"]);
  const result = await groupServices.getGroupMembers(
    req.params.id as string,
    options,
    req.query
  );
  sendResponse(res, {
    message: "Group members retrieved successfully!",
    data: result,
  });
});

const addGroupMember = handleAsyncRequest(async (req: TRequest, res) => {
  const result = await groupServices.addGroupMember(
    req.params.id as string,
    req.body.member,
    req.user!.id
  );
  sendResponse(res, {
    message: "Group member added successfully!",
    data: result,
  });
});

const joinGroup = handleAsyncRequest(async (req: TRequest, res) => {
  const result = await groupServices.joinGroup(
    req.params.id as string,
    req.user!.id
  );
  sendResponse(res, {
    message: "Joined group successfully!",
    data: result,
  });
});

const changeGroupImage = handleAsyncRequest(async (req: TRequest, res) => {
  const result = await groupServices.changeGroupImage(
    req.params.id as string,
    req.file as TFile
  );
  sendResponse(res, {
    message: "Group image changed successfully!",
    data: result,
  });
});

const updateGroupData = handleAsyncRequest(async (req: TRequest, res) => {
  const result = await groupServices.updateGroupData(
    req.params.id as string,
    req.body
  );
  sendResponse(res, {
    message: "Group data updated successfully!",
    data: result,
  });
});

const toggleGroupVisibility = handleAsyncRequest(async (req: TRequest, res) => {
  const result = await groupServices.toggleGroupVisibility(
    req.params.id as string
  );
  sendResponse(res, {
    message: "Group visibility updated successfully!",
    data: result,
  });
});

const toggleGroupInvitationAccess = handleAsyncRequest(
  async (req: TRequest, res) => {
    const result = await groupServices.toggleGroupInvitationAccess(
      req.params.id as string
    );
    sendResponse(res, {
      message: "Group invitation access updated successfully!",
      data: result,
    });
  }
);

const updateGroupTags = handleAsyncRequest(async (req: TRequest, res) => {
  const groupId = req.params.id as string;
  const { tags } = req.body as { tags: string[] };
  if (!Array.isArray(tags)) throw new Error("tags must be an array");
  const result = await prisma.group.update({
    where: { id: groupId },
    data: { tags },
    select: { id: true, name: true, tags: true },
  });
  sendResponse(res, { message: "Group tags updated!", data: result });
});

const toggleGroupFeatured = handleAsyncRequest(async (req: TRequest, res) => {
  const groupId = req.params.id as string;
  const { isFeatured } = req.body as { isFeatured?: boolean };
  if (typeof isFeatured !== "boolean") {
    throw new ApiError(400, "isFeatured must be true or false.");
  }
  const result = await prisma.group.update({
    where: { id: groupId },
    data: { isFeatured },
    select: { id: true, name: true, isFeatured: true },
  });
  sendResponse(res, {
    message: result.isFeatured
      ? "Community will show on Explore."
      : "Community removed from Explore suggestions.",
    data: result,
  });
});

export const groupController = {
  createGroup,
  getAllGroups,
  getPublicGroups,
  getSingleGroup,
  addGroupMember,
  joinGroup,
  changeGroupImage,
  updateGroupData,
  updateGroupTags,
  toggleGroupVisibility,
  toggleGroupInvitationAccess,
  getGroupMembers,
  toggleGroupFeatured,
};
