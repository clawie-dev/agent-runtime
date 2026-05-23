import { echoHandler } from './echo.ts'

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

/**
 * Built-in handlers shipped with the base image. Phase 2 ships only `echo`.
 * Later phases add `chat` (LLM, Phase 3) and skill-loaded handlers (Phase 7).
 */
export const handlers: Record<string, Handler> = {
  echo: echoHandler,
}
