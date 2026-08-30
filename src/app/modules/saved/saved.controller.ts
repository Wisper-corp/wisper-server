import { Response } from "express";
import { TRequest } from "../../interface/global.interface";
import ApiError from "../../middlewares/classes/ApiError";
import handleAsyncRequest from "../../utils/handleAsyncRequest";
import { sendResponse } from "../../utils/sendResponse";
import { savedServices, TSavedKind } from "./saved.service";

const readKind = (raw: string | undefined): TSavedKind => {
  if (raw === "service" || raw === "forum" || raw === "reply") return raw;
  throw new ApiError(400, "Save a service post, a forum post or a reply.");
};

const toggleSaved = handleAsyncRequest(async (req: TRequest, res: Response) => {
  const result = await savedServices.toggleSaved(
    req.user!.id,
    readKind(req.params.kind),
    req.params.id as string
  );
  sendResponse(res, {
    message: result.isSaved ? "Saved!" : "Removed from saved.",
    data: result,
  });
});

const getSavedItems = handleAsyncRequest(
  async (req: TRequest, res: Response) => {
    const result = await savedServices.getSavedItems(req.user!.id, {
      type: typeof req.query.type === "string" ? req.query.type : undefined,
      searchTerm:
        typeof req.query.searchTerm === "string"
          ? req.query.searchTerm
          : undefined,
    });
    sendResponse(res, {
      message: "Saved items retrieved successfully!",
      data: result,
    });
  }
);

export const savedController = {
  toggleSaved,
  getSavedItems,
};
