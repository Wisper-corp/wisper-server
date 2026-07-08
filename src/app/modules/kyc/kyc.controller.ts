import { Response } from "express";
import handleAsyncRequest from "../../utils/handleAsyncRequest";
import { sendResponse } from "../../utils/sendResponse";
import { TRequest } from "../../interface/global.interface";
import { kycService } from "./kyc.service";
import ApiError from "../../middlewares/classes/ApiError";

// ── Email ──────────────────────────────────────────────────────────────────
const sendEmailOtp = handleAsyncRequest(async (req: TRequest, res: Response) => {
  const authId = req.user!.id;
  const { email } = req.body;
  if (!email) throw new ApiError(400, "email is required");
  const result = await kycService.sendEmailOtp(authId, email);
  sendResponse(res, { message: result.message, data: null });
});

const verifyEmail = handleAsyncRequest(async (req: TRequest, res: Response) => {
  const authId = req.user!.id;
  const { email, otp } = req.body;
  if (!email || !otp) throw new ApiError(400, "email and otp are required");
  const result = await kycService.verifyEmail(authId, email, otp);
  sendResponse(res, { message: result.message, data: null });
});

// ── Phone ──────────────────────────────────────────────────────────────────
const sendPhoneOtp = handleAsyncRequest(async (req: TRequest, res: Response) => {
  const authId = req.user!.id;
  const { phone } = req.body;
  if (!phone) throw new ApiError(400, "phone is required");
  const result = await kycService.sendPhoneOtp(authId, phone);
  sendResponse(res, { message: result.message, data: null });
});

const verifyPhone = handleAsyncRequest(async (req: TRequest, res: Response) => {
  const authId = req.user!.id;
  const { phone, otp } = req.body;
  if (!phone || !otp) throw new ApiError(400, "phone and otp are required");
  const result = await kycService.verifyPhone(authId, phone, otp);
  sendResponse(res, { message: result.message, data: null });
});

// ── NIN ────────────────────────────────────────────────────────────────────
const verifyNin = handleAsyncRequest(async (req: TRequest, res: Response) => {
  const authId = req.user!.id;
  const { nin } = req.body;
  if (!nin) throw new ApiError(400, "nin is required");
  const result = await kycService.verifyNin(authId, nin);
  sendResponse(res, { message: result.message, data: result.data });
});

// ── Address ────────────────────────────────────────────────────────────────
const submitAddress = handleAsyncRequest(async (req: TRequest, res: Response) => {
  const authId = req.user!.id;
  const { addressText, addressDocUrl, addressDocType } = req.body;
  if (!addressText || !addressDocUrl || !addressDocType) {
    throw new ApiError(400, "addressText, addressDocUrl and addressDocType are required");
  }
  const result = await kycService.submitAddress(authId, addressText, addressDocUrl, addressDocType);
  sendResponse(res, { message: result.message, data: null });
});

// ── Status ─────────────────────────────────────────────────────────────────
const getStatus = handleAsyncRequest(async (req: TRequest, res: Response) => {
  const authId = req.user!.id;
  const data = await kycService.getKycStatus(authId);
  sendResponse(res, { message: "KYC status retrieved successfully.", data });
});

// ── Badge ──────────────────────────────────────────────────────────────────
const activateBadge = handleAsyncRequest(async (req: TRequest, res: Response) => {
  const authId = req.user!.id;
  const result = await kycService.activateBadge(authId);
  sendResponse(res, { message: result.message, data: { nextBillingDate: result.nextBillingDate } });
});

const payOutstandingFee = handleAsyncRequest(async (req: TRequest, res: Response) => {
  const authId = req.user!.id;
  const result = await kycService.payOutstandingBadgeFee(authId);
  sendResponse(res, { message: result.message, data: { nextBillingDate: result.nextBillingDate } });
});

// ── Admin ──────────────────────────────────────────────────────────────────
const adminReviewAddress = handleAsyncRequest(async (req: TRequest, res: Response) => {
  const userId = req.params.userId as string;
  const { action } = req.body;
  if (!action) throw new ApiError(400, "action is required");
  const result = await kycService.reviewAddress(userId, action as "approve" | "reject");
  sendResponse(res, { message: result.message, data: null });
});

const adminManageBadge = handleAsyncRequest(async (req: TRequest, res: Response) => {
  const userId = req.params.userId as string;
  const { action, exemptUntil } = req.body;
  if (!action) throw new ApiError(400, "action is required");
  const result = await kycService.adminManageBadge(userId, action, exemptUntil ?? undefined);
  sendResponse(res, { message: result.message, data: null });
});

const runBilling = handleAsyncRequest(async (_req: TRequest, res: Response) => {
  const result = await kycService.runMonthlyBadgeBilling();
  sendResponse(res, {
    message: `Billing complete. Deactivated: ${result.deactivated}, Billed: ${result.billed}`,
    data: result,
  });
});

export const kycController = {
  sendEmailOtp,
  verifyEmail,
  sendPhoneOtp,
  verifyPhone,
  verifyNin,
  submitAddress,
  getStatus,
  activateBadge,
  payOutstandingFee,
  adminReviewAddress,
  adminManageBadge,
  runBilling,
};
