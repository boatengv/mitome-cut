import type { z } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Resource') => new HttpError(404, 'not_found', `${what} not found.`);

/** Parses a request body with a zod schema, throwing a 400 with field errors. */
export function parse<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const res = schema.safeParse(value ?? {});
  if (!res.success) {
    throw new HttpError(
      400,
      'invalid_request',
      res.error.issues[0]?.message ?? 'Invalid request',
      res.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return res.data;
}
