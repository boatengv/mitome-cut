// TEST ONLY. A stand-in for @clerk/clerk-react used by `CLERK_STUB=1 vite build` (output in
// apps/web/dist-stub/, never dist/). Pairs with scripts/clerk-stub/fastify.mjs on the API.
import { createContext, useContext, useState, type ReactNode } from 'react';

const KEY = 'clerk-stub-email';
const read = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

const Ctx = createContext<{ email: string | null; setEmail: (e: string | null) => void }>({ email: null, setEmail: () => {} });

export function ClerkProvider({ children }: { children: ReactNode; [k: string]: unknown }) {
  const [email, setEmailState] = useState(read());
  const setEmail = (e: string | null) => {
    if (e) localStorage.setItem(KEY, e);
    else localStorage.removeItem(KEY);
    setEmailState(e);
  };
  return <Ctx.Provider value={{ email, setEmail }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const { email, setEmail } = useContext(Ctx);
  return {
    isLoaded: true,
    isSignedIn: !!email,
    getToken: async () => (email ? 'stub:' + email : null),
    signOut: async () => {
      setEmail(null);
      location.assign('/sign-in');
    },
  };
}

export function useUser() {
  const { email } = useContext(Ctx);
  return { user: email ? { primaryEmailAddress: { emailAddress: email } } : null };
}

function StubForm({ title }: { title: string }) {
  const { setEmail } = useContext(Ctx);
  return (
    <form
      className="clerk-stub"
      style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 24, border: '1px dashed #F26B1D', borderRadius: 8, width: '100%', maxWidth: 420 }}
      onSubmit={(e) => {
        e.preventDefault();
        const v = (new FormData(e.currentTarget).get('email') as string).trim();
        if (v) setEmail(v);
      }}
    >
      <b>{title}</b>
      <small>Test sign-in (Clerk stand-in). Not for production.</small>
      <input name="email" type="email" required placeholder="you@example.com" aria-label="Email" style={{ height: 40 }} />
      <button type="submit" style={{ height: 40 }}>Continue</button>
    </form>
  );
}
export const SignIn = (_p: unknown) => <StubForm title="Sign in to Mitome Cut" />;
export const SignUp = (_p: unknown) => <StubForm title="Create your Mitome Cut account" />;
