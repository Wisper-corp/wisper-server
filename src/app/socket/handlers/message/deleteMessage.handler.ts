import prisma from "../../../utils/prisma";
import { TDeleteMessage } from "../../interface/message.interface";
import { TAckFn, TSocket } from "../../interface/socket.interface";
import ackHandler from "../../utils/ackHandler";
import eventHandler from "../../utils/eventHandler";

const deleteMessage = eventHandler<TDeleteMessage>(
  async (socket: TSocket, data, ack: TAckFn) => {
    const authId = socket.auth.id;

    const message = await prisma.message.findUniqueOrThrow({
      where: {
        id: data.messageId,
      },
    });

    // The return matters: ackHandler only sends the acknowledgement, it does
    // not stop the handler. Without it every check below ran anyway and
    // anyone could delete anyone's message.
    if (message.senderId !== authId) {
      ackHandler(ack, { success: false, message: "Unauthorized to delete!" });
      return;
    }

    await prisma.message.delete({
      where: {
        id: data.messageId,
      },
    });

    // Say what was removed. This used to send the chat's OLDEST message back
    // as "newMessage", which re-inserted the first message of the
    // conversation instead of taking the deleted one away.
    const removed = { messageId: message.id, chatId: message.chatId };
    socket.to(message.chatId).emit("messageDeleted", removed);
    socket.emit("messageDeleted", removed);
    ackHandler(ack, { success: true, message: "Message deleted" });
  }
);

export default deleteMessage;

