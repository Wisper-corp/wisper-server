"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.chatRoutes = void 0;
const express_1 = require("express");
const authorize_1 = __importDefault(require("../../middlewares/authorize"));
const client_1 = require("@prisma/client");
const chat_controller_1 = require("./chat.controller");
const handleZodValidation_1 = __importDefault(require("../../middlewares/handleZodValidation"));
const chat_validation_1 = require("./chat.validation");
const router = (0, express_1.Router)();
router.post("/", (0, authorize_1.default)(client_1.UserRole.PERSON, client_1.UserRole.BUSINESS), (0, handleZodValidation_1.default)(chat_validation_1.createChatZod), chat_controller_1.chatController.createChat);
router.get("/my", (0, authorize_1.default)(client_1.UserRole.PERSON, client_1.UserRole.BUSINESS), chat_controller_1.chatController.getMyChats);
router.get("/links/:id", (0, authorize_1.default)(client_1.UserRole.PERSON, client_1.UserRole.BUSINESS), chat_controller_1.chatController.getChatLinks);
router.get("/files/:id", (0, authorize_1.default)(client_1.UserRole.PERSON, client_1.UserRole.BUSINESS), chat_controller_1.chatController.getChatFiles);
router.get("/mute-info/:chatId", (0, authorize_1.default)(client_1.UserRole.PERSON, client_1.UserRole.BUSINESS), chat_controller_1.chatController.getChatMuteInfo);
router.patch("/mute", (0, authorize_1.default)(client_1.UserRole.PERSON, client_1.UserRole.BUSINESS), (0, handleZodValidation_1.default)(chat_validation_1.muteChatZod), chat_controller_1.chatController.muteChat);
router.patch("/unmute/:chatId", (0, authorize_1.default)(client_1.UserRole.PERSON, client_1.UserRole.BUSINESS), chat_controller_1.chatController.unmuteChat);
router.patch("/remove-participant", (0, authorize_1.default)(client_1.UserRole.PERSON, client_1.UserRole.BUSINESS), (0, handleZodValidation_1.default)(chat_validation_1.removeParticipantZod), chat_controller_1.chatController.removeParticipant);
router.patch("/update-participant-role", (0, authorize_1.default)(client_1.UserRole.PERSON, client_1.UserRole.BUSINESS), chat_controller_1.chatController.updateParticipantRole);
router.patch("/block-participant", (0, authorize_1.default)(client_1.UserRole.PERSON, client_1.UserRole.BUSINESS), (0, handleZodValidation_1.default)(chat_validation_1.blockParticipantZod), chat_controller_1.chatController.blockChatParticipant);
router.patch("/unblock-participant", (0, authorize_1.default)(client_1.UserRole.PERSON, client_1.UserRole.BUSINESS), (0, handleZodValidation_1.default)(chat_validation_1.blockParticipantZod), chat_controller_1.chatController.unBlockChatParticipant);
router.delete("/:chatId", (0, authorize_1.default)(client_1.UserRole.PERSON, client_1.UserRole.BUSINESS), chat_controller_1.chatController.deleteChat);
exports.chatRoutes = router;
//# sourceMappingURL=chat.routes.js.map