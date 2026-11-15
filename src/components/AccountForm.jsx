import { useEffect, useId, useRef, useState } from "react";
import { login, signup } from "../lib/accountSession";
import { useAnnouncer } from "../hooks/useAnnouncer";
import { useVoiceActions } from "../voice/voiceActions";
import BrandMark from "./BrandMark";

function AccountForm({ creating, onNavigate, onBack = null }) {
  const id = useId();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState(null);
  const submitting = useRef(false);
  const form = useRef(null);
  const errorSummary = useRef(null);
  const { message, announce } = useAnnouncer();
  const title = creating ? "Create your Synapse account" : "Sign in to Synapse";

  useEffect(() => {
    if (!errors) return;
    const first = Object.keys(errors).find((key) => key !== "form");
    if (first) form.current?.elements.namedItem(first)?.focus();
    else errorSummary.current?.focus();
    // Also announce the errors, so learners using Synapse's own voice (no screen reader) hear what to fix.
    announce(Object.values(errors).filter(Boolean).join(" "));
  }, [errors, announce]);

  // Voice: the username can be said or spelled; the password is always typed (never spoken aloud or sent to
  // speech recognition). After the username, focus moves to the password field, ready for typing.
  useVoiceActions({
    ...(busy ? {} : {
      fill_username: ({ name }) => {
        setUsername(name);
        setErrors((current) => {
          if (!current?.username) return current;
          const { username: _fixed, ...rest } = current;
          return Object.keys(rest).length ? rest : null;
        });
        setTimeout(() => form.current?.elements.namedItem("password")?.focus(), 0);
      },
      ...(creating ? { open_login: () => onNavigate("login") } : { open_signup: () => onNavigate("signup") }),
    }),
  });

  const submit = async (event) => {
    event.preventDefault();
    if (submitting.current) return;
    const invalid = {};
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{2,63}$/.test(username)) {
      invalid.username = "Use 3–64 letters A–Z, numbers, dots, dashes or underscores. Start with a letter or number.";
    }
    if (Array.from(password).length < 8 || Array.from(password).length > 128) {
      invalid.password = "Use a password between 8 and 128 characters.";
    }
    if (creating && Array.from(displayName).length > 120) invalid.displayName = "Use no more than 120 characters.";
    if (Object.keys(invalid).length) { setErrors(invalid); return; }
    submitting.current = true;
    setBusy(true);
    setErrors(null);
    announce(creating ? "Creating your account." : "Signing in.");
    try {
      if (creating) await signup(username, password, displayName);
      else await login(username, password);
      setPassword("");
    } catch (error) {
      announce("");
      setErrors({ form: error instanceof TypeError
        ? "Can't reach Synapse on this computer. Check that the backend is running, then try again."
        : error.status === 429 ? "Too many attempts or the account service is busy. Wait a minute, then try again."
        : error.message || "Unable to sign in. Please try again." });
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  const field = (name, label, value, setValue, props, hint, icon) => (
    <div className="mb-5">
      <label htmlFor={`${id}-${name}`} className="block mb-2 text-[15px] font-semibold text-text-primary">{label}</label>
      {hint && <p id={`${id}-${name}-hint`} className="mb-2 text-[14px] text-text-secondary leading-relaxed">{hint}</p>}
      <div className={"ds-field flex items-center gap-3 " + (errors?.[name] ? "border-error" : "")}>
        {icon && <FieldIcon name={icon} />}
        <input {...props} id={`${id}-${name}`} name={name} value={value}
          onChange={(event) => setValue(event.target.value)} disabled={busy}
          aria-invalid={errors?.[name] ? true : undefined}
          aria-describedby={[hint && `${id}-${name}-hint`, errors?.[name] && `${id}-${name}-error`].filter(Boolean).join(" ") || undefined}
          className="w-full min-h-[44px] bg-transparent text-[16px] text-text-primary focus-ring" />
      </div>
      {errors?.[name] && <p id={`${id}-${name}-error`} className="mt-2 text-[14px] text-error">{errors[name]}</p>}
    </div>
  );

  return (
    <main id="main-content" tabIndex={-1} aria-labelledby="page-title" className="h-full overflow-y-auto bg-background font-sans outline-none">
      <div className="w-full max-w-[600px] mx-auto px-4 sm:px-8 py-8 sm:py-12">
        <div className="ds-card overflow-hidden">
          {/* Header band, the same gradient as Home and Welcome (white text >= 9:1 along it). */}
          <div className="bg-hero px-6 sm:px-10 pt-7 pb-8">
            <div className="flex items-center gap-3 mb-5">
              <BrandMark size={40} className="ring-2 ring-white/30 rounded-[11px]" />
              <span aria-hidden="true" className="text-[19px] font-bold tracking-tight text-hero-fg">Synapse</span>
            </div>
            <h1 id="page-title" tabIndex={-1} className="text-[28px] sm:text-[32px] font-bold tracking-tight leading-tight text-hero-fg rounded-radius-sm outline-none focus-ring">{title}</h1>
            <p className="mt-2 text-[16px] text-hero-sub leading-relaxed">
              {creating ? "Set up a private account to keep your lectures, bookmarks and voice notes." : "Welcome back. Pick up where you left off."}
            </p>
          </div>

          <div className="px-6 sm:px-10 py-7 sm:py-8">
            <ul className="mb-7 grid gap-2 rounded-radius-md bg-surface-muted border border-border-subtle px-4 py-3 text-[14px] text-text-secondary">
              <li className="flex items-start gap-2"><FactIcon name="device" />Your account and saved learning data stay on this computer.</li>
              <li className="flex items-start gap-2"><FactIcon name="user" />Use a username, not an email address.</li>
              <li className="flex items-start gap-2"><FactIcon name="key" />Password recovery is not available, so keep your password safe.</li>
            </ul>
            <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">{message}</div>
            <form ref={form} onSubmit={submit} noValidate aria-label={creating ? "Create account" : "Sign in"} aria-busy={busy}>
              {creating && field("displayName", "Display name (optional)", displayName, setDisplayName, { autoComplete: "nickname" }, null, "smile")}
              {field("username", "Username", username, setUsername, { required: true, autoComplete: "username", autoCapitalize: "none", spellCheck: false },
                creating ? "3–64 letters A–Z, numbers, dots, dashes or underscores; start with a letter or number." : null, "user")}
              {field("password", "Password", password, setPassword, { required: true, type: visible ? "text" : "password", autoComplete: creating ? "new-password" : "current-password" }, "8–128 characters. Spaces are kept exactly as entered.", "key")}
              <button type="button" disabled={busy} aria-pressed={visible} aria-controls={`${id}-password`}
                className="ds-btn-text -mt-2 mb-5 inline-flex items-center gap-2" onClick={() => setVisible((value) => !value)}>
                <FieldIcon name={visible ? "eye-off" : "eye"} inline />Show password
              </button>
              {errors?.form && <p ref={errorSummary} tabIndex={-1} className="mb-5 p-4 bg-error-soft border border-error rounded-radius-md text-text-primary focus-ring">{errors.form}</p>}
              <button type="submit" disabled={busy} className="ds-btn-primary w-full justify-center disabled:opacity-60">{busy ? creating ? "Creating account…" : "Signing in…" : creating ? "Create account" : "Sign in"}</button>
              <div className="mt-6 pt-6 border-t border-border-subtle flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-[14px] text-text-secondary">
                <span aria-hidden="true">{creating ? "Have an account already?" : "New to Synapse?"}</span>
                <button type="button" disabled={busy} className="ds-btn-secondary" onClick={() => onNavigate(creating ? "login" : "signup")}>
                  {creating ? "Already have an account? Sign in" : "Create an account"}
                </button>
              </div>
              {onBack && <div className="mt-4 text-center"><button type="button" disabled={busy} onClick={onBack} className="ds-btn-text">Back to development app</button></div>}
            </form>
          </div>
        </div>
      </div>
    </main>
  );
}

// Decorative icons (aria-hidden): they repeat what the label or text already says.
const ICON_PATHS = {
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="M10.8 12.2 20 3M17 6l3 3M14 9l2 2" /></>,
  smile: <><circle cx="12" cy="12" r="9" /><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01" /></>,
  device: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>,
  eye: <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  "eye-off": <><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>,
};

function Svg({ name, size }) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {ICON_PATHS[name]}
    </svg>
  );
}

function FieldIcon({ name, inline = false }) {
  return <span aria-hidden="true" className={inline ? "inline-flex" : "inline-flex shrink-0 text-text-muted"}><Svg name={name} size={inline ? 18 : 20} /></span>;
}

function FactIcon({ name }) {
  return <span aria-hidden="true" className="mt-[2px] inline-flex shrink-0 text-accent"><Svg name={name} size={17} /></span>;
}

export function Login(props) { return <AccountForm {...props} creating={false} />; }
export function Signup(props) { return <AccountForm {...props} creating />; }
