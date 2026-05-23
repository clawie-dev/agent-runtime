export interface HandlerContext {
  payload: unknown
  taskId: string
}

export interface HandlerSuccess {
  ok: true
  output: unknown
}

export interface HandlerFailure {
  ok: false
  cause: string
  detail?: string
}

export type HandlerResult = HandlerSuccess | HandlerFailure
export type Handler = (ctx: HandlerContext) => Promise<HandlerResult>

import { echoHandler } from './echo.ts'
import { chatHandler } from './chat.ts'

/**
 * Built-in handlers shipped with the base image. Phase 3 adds `chat`
 * (LLM via Anthropic / OpenAI). Skill-loaded handlers land in Phase 7.
 */
export const handlers: Record<string, Handler> = {
  echo: echoHandler,
  chat: chatHandler,
}
