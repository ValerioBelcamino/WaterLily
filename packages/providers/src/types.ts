export type JsonPrimitive = boolean | number | string | null;
export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface TextChatContentPart {
  readonly text: string;
  readonly type: 'text';
}

export interface AttachmentChatContentPart {
  readonly attachmentId: string;
  readonly mediaType: string;
  readonly name: string | null;
  readonly type: 'attachment';
}

export type ChatContentPart = AttachmentChatContentPart | TextChatContentPart;

interface BaseChatMessage {
  readonly content: string | readonly ChatContentPart[];
  readonly name?: string;
}

export interface StandardChatMessage extends BaseChatMessage {
  readonly role: 'assistant' | 'system' | 'user';
}

export interface ToolChatMessage extends BaseChatMessage {
  readonly role: 'tool';
  readonly toolCallId: string;
}

export type ChatMessage = StandardChatMessage | ToolChatMessage;

export interface ChatRequest {
  readonly maxOutputTokens?: number;
  readonly messages: readonly ChatMessage[];
  readonly model: string;
  readonly providerOptions?: Readonly<Record<string, JsonValue>>;
  readonly stop?: string | readonly string[];
  readonly temperature?: number;
  readonly topP?: number;
}

export type FinishReason =
  'content-filter' | 'length' | 'other' | 'stop' | 'tool-calls';

export interface ResponseStartEvent {
  readonly createdAt: string | null;
  readonly model: string;
  readonly responseId: string;
  readonly type: 'response-start';
}

export interface ReasoningDeltaEvent {
  readonly delta: string;
  readonly type: 'reasoning-delta';
}

export interface TextDeltaEvent {
  readonly delta: string;
  readonly type: 'text-delta';
}

export interface UsageEvent {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly type: 'usage';
}

export interface ResponseEndEvent {
  readonly finishReason: FinishReason;
  readonly rawFinishReason: string | null;
  readonly type: 'response-end';
}

export type ChatStreamEvent =
  | ReasoningDeltaEvent
  | ResponseEndEvent
  | ResponseStartEvent
  | TextDeltaEvent
  | UsageEvent;

export interface StreamChatOptions {
  readonly signal?: AbortSignal;
}

export interface ChatProvider {
  readonly id: string;
  readonly name: string;
  streamChat(
    request: ChatRequest,
    options?: StreamChatOptions,
  ): AsyncIterable<ChatStreamEvent>;
}

export interface LoadedAttachment {
  readonly bytes: Uint8Array;
  readonly mediaType: string;
  readonly name: string;
}

export type AttachmentLoader = (
  attachmentId: string,
) => Promise<LoadedAttachment>;

export type FetchImplementation = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;
