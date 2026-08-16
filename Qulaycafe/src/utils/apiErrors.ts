// Turns the server's zod validation error shape into a readable message,
// e.g. "price: Number must be greater than 0" instead of a generic
// "invalid request" that gives no clue what to fix.
export function describeApiError(body: any): string | null {
  if (!body) return null;
  if (body.details?.fieldErrors) {
    const fields = Object.entries(body.details.fieldErrors)
      .filter(([, msgs]) => Array.isArray(msgs) && (msgs as string[]).length > 0)
      .map(([field, msgs]) => `${field}: ${(msgs as string[])[0]}`);
    if (fields.length > 0) return `Invalid: ${fields.join('; ')}`;
  }
  return body.error || null;
}
