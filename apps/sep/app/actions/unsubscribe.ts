'use server';

import { optOutByToken } from '@/lib/unsubscribe';
import { ok, fail, type ActionResult } from '@/lib/errors';

export async function confirmUnsubscribe(token: string): Promise<ActionResult<{ email: string }>> {
  try {
    const result = await optOutByToken(token);

    if (result.status === 'not_found') {
      throw new Error('That unsubscribe link is not valid. It may already have been used.');
    }

    return ok({ email: result.email });
  } catch (error) {
    return fail(error, 'Could not complete the unsubscribe.');
  }
}
