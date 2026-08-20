/**
 * Address validation, shared by the client and the server.
 *
 * Re-exported from `lib/server/mime.ts` so there is exactly ONE definition of
 * what counts as a valid address. Two implementations would drift, and the
 * visible symptom is a composer that accepts an address the send endpoint then
 * rejects — after the user has written the message.
 *
 * Safe to import from a client component: it is pure string work with no
 * database, no secrets and no request.
 */
export { isValidAddress, isHeaderSafe } from "./server/mime";
