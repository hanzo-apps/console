/**
 * SSE parsing for the playground compare board — re-exported from the canonical
 * home in the API layer (`~/lib/api/stream`), so there is ONE definition shared by
 * the compare-board runner and the chat page's streaming send. Import from here
 * (playground-local) or from `~/lib/api/stream` — same functions, no duplication.
 */
export { splitSSE, dataOf, parseChatData, type ChatDelta } from '~/lib/api/stream'
