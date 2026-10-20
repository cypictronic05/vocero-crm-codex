import type { MessageDto, MessageMediaDto } from "@/lib/types";

export type MediaUpdate = {
  conversationId: string;
  messageId: string;
  media: MessageMediaDto;
};

export function pendingMediaIds(messages: MessageDto[]): string[] {
  return messages
    .filter((message) => message.media?.fetchStatus === "pending")
    .map((message) => message.media!.assetId);
}

/** Sustituye solo el adjunto afectado; conserva hilo, selección y compositor. */
export function mergeMediaUpdates(
  messages: MessageDto[],
  updates: MediaUpdate[]
): MessageDto[] {
  if (!updates.length) return messages;
  const byMessage = new Map(updates.map((update) => [update.messageId, update]));
  let changed = false;
  const next = messages.map((message) => {
    const update = byMessage.get(message.id);
    if (!update || update.conversationId !== message.conversationId) return message;
    if (
      message.media?.fetchStatus === update.media.fetchStatus &&
      message.media?.fileSize === update.media.fileSize &&
      message.media?.mimeType === update.media.mimeType &&
      message.media?.fetchError === update.media.fetchError
    ) {
      return message;
    }
    changed = true;
    return { ...message, media: update.media };
  });
  return changed ? next : messages;
}
