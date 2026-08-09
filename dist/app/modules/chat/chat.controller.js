"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.chatController = void 0;
const handleAsyncRequest_1 = __importDefault(require("../../utils/handleAsyncRequest"));
const pick_1 = __importDefault(require("../../utils/pick"));
const sendResponse_1 = require("../../utils/sendResponse");
const chat_service_1 = require("./chat.service");
const createChat = (0, handleAsyncRequest_1.default)(async (req, res) => {
    const result = await chat_service_1.chatService.createChat(req.user.id, req.body);
    (0, sendResponse_1.sendResponse)(res, {
        message: "Chat created successfully!",
        data: result,
        status: 201,
    });
});
const getMyChats = (0, handleAsyncRequest_1.default)(async (req, res) => {
    const options = (0, pick_1.default)(req.query, ["page", "limit", "sortBy", "orderBy"]);
    const result = await chat_service_1.chatService.getMyChats(req.user.id, options, req.query);
    (0, sendResponse_1.sendResponse)(res, {
        message: "Chats retrieved successfully!",
        data: result,
    });
});
const getChatLinks = (0, handleAsyncRequest_1.default)(async (req, res) => {
    const result = await chat_service_1.chatService.getChatLinks(req.user.id, req.params.id);
    (0, sendResponse_1.sendResponse)(res, {
        message: "Chat links retrieved successfully!",
        data: result,
    });
});
const getChatFiles = (0, handleAsyncRequest_1.default)(async (req, res) => {
    const result = await chat_service_1.chatService.getChatFiles(req.user.id, req.params.id, req.query);
    (0, sendResponse_1.sendResponse)(res, {
        message: "Chat files retrieved successfully!",
        data: result,
    });
});
const getChatMuteInfo = (0, handleAsyncRequest_1.default)(async (req, res) => {
    const result = await chat_service_1.chatService.getChatMuteInfo(req.params.chatId);
    (0, sendResponse_1.sendResponse)(res, {
        message: "Chat mute info retrieved successfully!",
        data: result,
    });
});
const muteChat = (0, handleAsyncRequest_1.default)(async (req, res) => {
    const result = await chat_service_1.chatService.muteChat(req.user.id, req.body);
    (0, sendResponse_1.sendResponse)(res, {
        message: "Chat muted successfully!",
        data: result,
    });
});
const unmuteChat = (0, handleAsyncRequest_1.default)(async (req, res) => {
    const result = await chat_service_1.chatService.unmuteChat(req.user.id, req.params.chatId);
    (0, sendResponse_1.sendResponse)(res, {
        message: "Chat unmuted successfully!",
        data: result,
    });
});
const removeParticipant = (0, handleAsyncRequest_1.default)(async (req, res) => {
    const result = await chat_service_1.chatService.removeParticipant(req.user.id, req.body);
    (0, sendResponse_1.sendResponse)(res, {
        message: "Chat participant removed successfully!",
        data: result,
    });
});
const updateParticipantRole = (0, handleAsyncRequest_1.default)(async (req, res) => {
    const result = await chat_service_1.chatService.updateParticipantRole(req.user.id, req.body);
    (0, sendResponse_1.sendResponse)(res, {
        message: "Participant role updated successfully!",
        data: result,
    });
});
const blockChatParticipant = (0, handleAsyncRequest_1.default)(async (req, res) => {
    const result = await chat_service_1.chatService.blockChatParticipant(req.user.id, req.body);
    (0, sendResponse_1.sendResponse)(res, {
        message: "Chat participant blocked successfully!",
        data: result,
    });
});
const unBlockChatParticipant = (0, handleAsyncRequest_1.default)(async (req, res) => {
    const result = await chat_service_1.chatService.unBlockChatParticipant(req.user.id, req.body);
    (0, sendResponse_1.sendResponse)(res, {
        message: "Chat participant unblocked successfully!",
        data: result,
    });
});
const deleteChat = (0, handleAsyncRequest_1.default)(async (req, res) => {
    const result = await chat_service_1.chatService.deleteChat(req.user.id, req.params.chatId);
    (0, sendResponse_1.sendResponse)(res, {
        message: "Chat deleted successfully!",
        data: result,
    });
});
exports.chatController = {
    createChat,
    getMyChats,
    getChatLinks,
    getChatFiles,
    getChatMuteInfo,
    muteChat,
    unmuteChat,
    removeParticipant,
    updateParticipantRole,
    blockChatParticipant,
    unBlockChatParticipant,
    deleteChat,
};
//# sourceMappingURL=chat.controller.js.map