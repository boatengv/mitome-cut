import type { FastifyInstance } from 'fastify';
import type { UserDTO } from '@mitome/shared';
import { requireUser } from '../auth.js';

/** Sign-in, sign-up, passwords and sessions are handled by Clerk; the API only reports who you are. */
export async function authRoutes(app: FastifyInstance) {
  app.get('/api/auth/me', async (req) => {
    const user = requireUser(req);
    return { user: user satisfies UserDTO };
  });
}
