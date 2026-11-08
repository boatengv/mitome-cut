// TEST ONLY. A stand-in for @clerk/fastify so the API can be exercised without a Clerk instance.
// Built into apps/server/dist-stub/ by `npm run build:stub -w @mitome/server`; never into dist/.
// A request authenticates with `Authorization: Bearer stub:<email>`.

const userIdFor = (email) => 'user_stub_' + Buffer.from(email).toString('hex').slice(0, 40);
const emails = new Map();

export async function clerkPlugin() {
  console.warn('[clerk-stub] TEST AUTH STUB IN USE. Never run this build in production.');
}
clerkPlugin[Symbol.for('skip-override')] = true;

export function getAuth(req) {
  const h = req.headers.authorization || '';
  const m = /^Bearer stub:([^\s@]+@[^\s@]+)$/.exec(h);
  if (!m) return { userId: null };
  const email = m[1].toLowerCase();
  const id = userIdFor(email);
  emails.set(id, email);
  return { userId: id };
}

export const clerkClient = {
  users: {
    async getUser(id) {
      const email = emails.get(id);
      return {
        primaryEmailAddressId: 'e1',
        emailAddresses: email ? [{ id: 'e1', emailAddress: email, verification: { status: 'verified' } }] : [],
      };
    },
  },
};
