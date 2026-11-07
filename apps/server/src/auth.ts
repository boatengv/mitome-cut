import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { clerkClient, getAuth } from '@clerk/fastify';
import { db, schema } from './db/client.js';
import { HttpError } from './http.js';

export interface AuthedUser {
  id: string;
  email: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthedUser;
  }
}

const userCols = { id: schema.users.id, email: schema.users.email };

/**
 * Maps the Clerk session (verified by the clerk plugin) to our own users row and puts it on
 * req.user. Projects, assets and quotas all hang off users.id, so that stays the identity the
 * rest of the app uses; Clerk only proves who is calling.
 */
export async function loadUser(req: FastifyRequest) {
  const { userId: clerkId } = getAuth(req);
  if (!clerkId) return;

  const known = await db.select(userCols).from(schema.users).where(eq(schema.users.clerkId, clerkId)).limit(1);
  if (known[0]) {
    req.user = known[0];
    return;
  }

  // First request from this Clerk user: fetch their email once and create or link a row.
  const cu = await clerkClient.users.getUser(clerkId);
  const primary = cu.emailAddresses.find((e) => e.id === cu.primaryEmailAddressId) ?? cu.emailAddresses[0];
  if (!primary) throw new HttpError(403, 'no_email', 'Your account has no email address.');
  const email = primary.emailAddress.toLowerCase();

  // Adopt a pre-Clerk account with the same email, but only if Clerk has verified the address.
  if (primary.verification?.status === 'verified') {
    const [linked] = await db
      .update(schema.users)
      .set({ clerkId })
      .where(and(sql`lower(${schema.users.email}) = ${email}`, isNull(schema.users.clerkId)))
      .returning(userCols);
    if (linked) {
      req.user = linked;
      return;
    }
  }

  await db.insert(schema.users).values({ email, clerkId }).onConflictDoNothing();
  const [created] = await db.select(userCols).from(schema.users).where(eq(schema.users.clerkId, clerkId)).limit(1);
  if (!created) throw new HttpError(409, 'email_taken', 'An account with this email already exists.');
  req.user = created;
}

export function requireUser(req: FastifyRequest): AuthedUser {
  if (!req.user) throw new HttpError(401, 'unauthorized', 'Sign in to continue.');
  return req.user;
}

/** Leftover from password sessions; the table is empty for new installs. */
export async function purgeExpiredSessions() {
  await db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, new Date()));
}
