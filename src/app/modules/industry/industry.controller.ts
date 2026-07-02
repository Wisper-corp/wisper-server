import { Request, Response } from "express";
import handleAsyncRequest from "../../utils/handleAsyncRequest";
import { sendResponse } from "../../utils/sendResponse";
import { industryService } from "./industry.service";

const search = handleAsyncRequest(async (req: Request, res: Response) => {
  const q = (req.query.q as string) || "";
  const limit = parseInt((req.query.limit as string) || "20");
  const results = await industryService.search(q, limit);
  sendResponse(res, {
    message: "Industries retrieved successfully",
    data: results,
  });
});

const getSectors = handleAsyncRequest(async (req: Request, res: Response) => {
  const sectors = await industryService.getSectors();
  sendResponse(res, {
    message: "Sectors retrieved successfully",
    data: sectors,
  });
});

export const industryController = { search, getSectors };
