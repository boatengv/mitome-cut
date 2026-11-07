import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { credentialsBody, type UserDTO } from '@mitome/shared';
import { config } from '../config.js';
import { db, schema } from '../db/client.js';
import { createSession, destroySession, hashPassword, requireUser, verifyPassword } from '../auth.js';
import { HttpError, parse } from '../http.js';

export async function authRoutes(app: FastifyInstance) {
  const strict = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  app.get('/api/auth/config', async () => ({ allowSignup: config.ALLOW_SIGNUP }));

  app.post('/api/auth/signup', strict, async (req, reply) => {
    if (!config.ALLOW_SIGNUP) throw new HttpError(403, 'signup_disabled', 'Sign-up is turned off on this server.');
    const body = parse(credentialsBody, req.body);
    const existing = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(sql`lower(${schema.users.email}) = ${body.email}`)
      .limit(1);
    if (existing[0]) throw new HttpError(409, 'email_taken', 'An account with this email already exists.');
    const [user] = await db
      .insert(schema.users)
      .values({ email: body.email, passwordHash: await hashPassword(body.password) })
      .returning({ id: schema.users.id, email: schema.users.email });
    if (!user) throw new HttpError(500, 'internal_error', 'Could not create the account.');
    await createSession(reply, user.id);
    return reply.code(201).send({ user: user satisfies UserDTO });
  });

  app.post('/api/auth/login', strict, async (req, reply) => {
    const body = parse(credentialsBody.pick({ email: true }).extend({ password: credentialsBody.shape.password.min(1) }), req.body);
    const [user] = await db
      .select()
      .from(schema.users)
      .where(sql`lower(${schema.users.email}) = ${body.email}`)
      .limit(1);
    // Same error for unknown email and wrong password.
    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      throw new HttpError(401, 'invalid_credentials', 'Email or password is incorrect.');
    }
    await createSession(reply, user.id);
    return { user: { id: user.id, email: user.email } satisfies UserDTO };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    await destroySession(req, reply);
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => {
    const user = requireUser(req);
    return { user: user satisfies UserDTO };
  });
}
