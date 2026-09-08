/**
 * The password rule, in a file with no Node imports so the sign-in form can
 * state it in the browser without pulling `node:crypto` into the client bundle.
 */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * Returns a human-readable problem with a proposed password, or null when it is
 * acceptable. Length is the only rule: composition rules push people toward
 * `Password1!` and away from length, which is what actually matters.
 */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters. A short phrase you can remember beats a short password you cannot.`;
  }
  if (password.length > 200) return 'That password is too long.';
  return null;
}
