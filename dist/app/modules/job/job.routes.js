"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.jobRoutes = void 0;
const express_1 = require("express");
const authorize_1 = __importDefault(require("../../middlewares/authorize"));
const client_1 = require("@prisma/client");
const job_controller_1 = require("./job.controller");
const handleZodValidation_1 = __importDefault(require("../../middlewares/handleZodValidation"));
const job_validation_1 = require("./job.validation");
const router = (0, express_1.Router)();
router.post("/", (0, authorize_1.default)(client_1.UserRole.BUSINESS, client_1.UserRole.PERSON), (0, handleZodValidation_1.default)(job_validation_1.createJobSchema), job_controller_1.jobController.createJob);
router.get("/", (0, authorize_1.default)(client_1.UserRole.BUSINESS, client_1.UserRole.PERSON, client_1.UserRole.ADMIN), job_controller_1.jobController.getAllJobs);
router.get("/group/:groupId", (0, authorize_1.default)(client_1.UserRole.BUSINESS, client_1.UserRole.PERSON), job_controller_1.jobController.getGroupJobs);
router.get("/:id", (0, authorize_1.default)(client_1.UserRole.BUSINESS, client_1.UserRole.PERSON, client_1.UserRole.ADMIN), job_controller_1.jobController.getSingleJob);
router.patch("/:id", (0, authorize_1.default)(client_1.UserRole.BUSINESS, client_1.UserRole.PERSON), (0, handleZodValidation_1.default)(job_validation_1.createJobSchema.partial()), job_controller_1.jobController.updateJob);
router.delete("/:id", (0, authorize_1.default)(client_1.UserRole.BUSINESS, client_1.UserRole.PERSON), job_controller_1.jobController.deleteJob);
exports.jobRoutes = router;
//# sourceMappingURL=job.routes.js.map