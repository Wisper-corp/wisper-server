import { Request, Response } from "express";
import handleAsyncRequest from "../../utils/handleAsyncRequest";
import { sendResponse } from "../../utils/sendResponse";
import { bankService } from "./bank.service";

const getNigerianBanks = handleAsyncRequest(async (_req: Request, res: Response) => {
  const banks = await bankService.getNigerianBanks();
  sendResponse(res, { message: "Banks retrieved successfully", data: { banks } });
});

export const bankController = { getNigerianBanks };
