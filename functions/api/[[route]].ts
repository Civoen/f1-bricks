/**
 * Cloudflare Pages Function: every request to /api/* lands here.
 * Cloudflare builds this automatically from the repo; there is nothing to configure
 * except the D1 binding named DB (and, optionally, DISCORD_WEBHOOK_URL).
 */
import { handleApi, type Env } from '../../server/api';

interface PagesContext {
  request: Request;
  env: Env;
  waitUntil(promise: Promise<unknown>): void;
}

export const onRequest = (context: PagesContext): Promise<Response> =>
  handleApi(context.request, context.env, (p) => context.waitUntil(p));
