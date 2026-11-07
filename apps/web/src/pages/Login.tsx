import { useEffect, useState, type ComponentProps } from "react";
import { SignIn, SignUp } from "@clerk/clerk-react";
import { dark } from "@clerk/themes";
import { navigate, usePath } from "../router";
import "./signin.css";

// One place to swap the photo: used sharp on the left and blurred behind the panel.
// object-position keeps the crew and camera in frame in the 60% pane.
export const SIGNIN_PHOTO = { src: "/bg-crew.jpg", position: "40% 40%" };

type Appearance = ComponentProps<typeof SignIn>["appearance"];
type Theme = "light" | "dark";
const THEME_KEY = "mitome-theme";

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* storage blocked: fall through to the OS preference */
  }
  return window.matchMedia?.("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

function Seal({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 160 160" aria-hidden="true">
      <circle cx="80" cy="80" r="80" fill="#F26B1D" />
      <text
        x="80"
        y="84"
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="Shippori Mincho, serif"
        fontWeight={800}
        fontSize={100}
        fill="#FFFFFF"
      >
        認
      </text>
    </svg>
  );
}

const icon = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

function SunIcon() {
  return (
    <svg {...icon}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg {...icon}>
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  );
}

/** Sign-in and sign-up are Clerk components on /sign-in and /sign-up, sharing this split layout. */
export function Login() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const isDark = theme === "dark";
  const path = usePath();
  const isSignUp = path.startsWith("/sign-up");

  // Sign-in and sign-up both live on this page; anything else signed-out lands on /sign-in.
  useEffect(() => {
    if (!path.startsWith("/sign-in") && !path.startsWith("/sign-up"))
      navigate("/sign-in", true);
  }, [path]);

  const appearance: Appearance = {
    baseTheme: isDark ? dark : undefined,
    layout: { logoImageUrl: "/seal.svg", socialButtonsVariant: "blockButton" },
    variables: {
      colorPrimary: "#F26B1D",
      colorTextOnPrimaryBackground: isDark ? "#0B0B0D" : "#2B1A10",
      colorBackground: isDark ? "#131316" : "#FFFFFF",
      colorInputBackground: isDark ? "#1A1A1F" : "#FFFFFF",
      colorInputText: isDark ? "#EDEDF0" : "#2B1A10",
      colorText: isDark ? "#EDEDF0" : "#2B1A10",
      colorTextSecondary: isDark ? "#9C9CA6" : "#6B5A4E",
      colorNeutral: isDark ? "#EDEDF0" : "#2B1A10",
      borderRadius: "0.5rem",
      fontFamily: "Inter, system-ui, sans-serif",
      fontSize: "13px",
    },
    elements: {
      rootBox: { width: "100%", maxWidth: "480px" },
      cardBox: { width: "100%", maxWidth: "480px" },
      card: {
        boxShadow: "none",
        border: `1px solid ${isDark ? "#2A2A31" : "#E7DED6"}`,
      },
      logoBox: { height: "44px", justifyContent: "center" },
      headerTitle: { fontSize: "20px", fontWeight: 600 },
      formButtonPrimary: { height: "44px", fontWeight: 600, boxShadow: "none" },
      socialButtonsBlockButton: { height: "44px" },
      formFieldInput: { height: "44px" },
      footerActionLink: {
        color: isDark ? "#FF8F52" : "#C2410C",
        fontWeight: 600,
      },
    },
  };

  useEffect(() => {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* the choice just won't persist */
    }
  }, [theme]);

  return (
    <div className="signin" data-theme={theme}>
      <section className="signin-photo">
        <img
          className="signin-photo-img"
          src={SIGNIN_PHOTO.src}
          alt=""
          style={{ objectPosition: SIGNIN_PHOTO.position }}
        />
        <div className="signin-photo-tint" />
        <div className="signin-photo-content">
          <a className="signin-logo" href="/">
            <Seal size={36} />
            <span className="signin-logo-words">
              <b>MITOME</b>
              <span>CUT</span>
            </span>
          </a>
          <div className="signin-tagline">
            <div className="signin-rule" />
            <h2>Anyone, anywhere can bring a story to life.</h2>
            <p>
              Write it, generate the scenes, cut the episode and share it. A
              whole studio in your browser.
            </p>
          </div>
        </div>
      </section>

      <section className="signin-panel">
        <div className="signin-bg" aria-hidden="true">
          <img className="signin-bg-img" src={SIGNIN_PHOTO.src} alt="" />
          <div className="signin-bg-tint" />
          <div className="signin-disc signin-disc-big" />
          <div className="signin-disc signin-disc-sun" />
        </div>

        <div className="signin-scroll">
          <header className="signin-header">
            <div
              className="signin-toggle"
              role="group"
              aria-label="Colour theme"
            >
              <button
                type="button"
                aria-pressed={!isDark}
                onClick={() => setTheme("light")}
              >
                <SunIcon /> Light
              </button>
              <button
                type="button"
                aria-pressed={isDark}
                onClick={() => setTheme("dark")}
              >
                <MoonIcon /> Dark
              </button>
            </div>
          </header>

          <main className="signin-main">
            <div
              key={isSignUp ? "up" : "in"}
              className={`signin-card-wrap ${isSignUp ? "from-right" : "from-left"}`}
            >
              {isSignUp ? (
                <SignUp
                  routing="path"
                  path="/sign-up"
                  signInUrl="/sign-in"
                  appearance={appearance}
                />
              ) : (
                <SignIn
                  routing="path"
                  path="/sign-in"
                  signUpUrl="/sign-up"
                  appearance={appearance}
                />
              )}
            </div>
          </main>

          <footer className="signin-footer">
            <span>© 2026 Mitome Studios</span>
            <nav>
              <a href="#terms">Terms</a>
              <a href="#privacy">Privacy</a>
              <a href="#help">Help</a>
            </nav>
          </footer>
        </div>
      </section>
    </div>
  );
}
