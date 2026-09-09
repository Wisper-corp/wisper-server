import { TRequest } from "../../interface/global.interface";
import handleAsyncRequest from "../../utils/handleAsyncRequest";
import { sendResponse } from "../../utils/sendResponse";
import { adminServices } from "./admin.service";
import { Response } from "express";

const getProfile = handleAsyncRequest(async (req: TRequest, res: Response) => {
  const result = await adminServices.getProfile(req.user?.email as string);
  sendResponse(res, {
    message: "Profile fetched successfully!",
    data: result,
  });
});

const updateProfile = handleAsyncRequest(
  async (req: TRequest, res: Response) => {
    const result = await adminServices.updateProfile(
      req.user?.email as string,
      req.body,
      req.file
    );
    sendResponse(res, {
      message: "Profile updated successfully!",
      data: result,
    });
  }
);

const getWebStats = handleAsyncRequest(async (_req: TRequest, res: Response) => {
  const result = await adminServices.getWebStats();
  sendResponse(res, { message: "Stats retrieved successfully!", data: result });
});

const getWebCustomers = handleAsyncRequest(
  async (req: TRequest, res: Response) => {
    const take = Math.min(Number(req.query.limit) || 50, 200);
    const skip = Number(req.query.skip) || 0;
    const search =
      typeof req.query.search === "string" ? req.query.search.trim() : undefined;

    const result = await adminServices.getWebCustomers({
      search: search || undefined,
      skip,
      take,
    });
    sendResponse(res, {
      message: "Customers retrieved successfully!",
      data: result,
    });
  }
);

export const adminController = {
  getWebStats,
  getWebCustomers,
  getProfile,
  updateProfile,
};
