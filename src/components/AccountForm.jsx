import { useEffect, useId, useRef, useState } from "react";
import { login, signup } from "../lib/accountSession";
import { useAnnouncer } from "../hooks/useAnnouncer";

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
  }, [errors]);

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

  const field = (name, label, value, setValue, props, hint) => (
    <div className="mb-5">
      <label htmlFor={`${id}-${name}`} className="block mb-2 text-[14px] font-medium text-text-primary">{label}</label>
      {hint && <p id={`${id}-${name}-hint`} className="mb-2 text-[14px] text-text-secondary">{hint}</p>}
      <div className="ds-field">
        <input {...props} id={`${id}-${name}`} name={name} value={value}
          onChange={(event) => setValue(event.target.value)} disabled={busy}
          aria-invalid={errors?.[name] ? true : undefined}
          aria-describedby={[hint && `${id}-${name}-hint`, errors?.[name] && `${id}-${name}-error`].filter(Boolean).join(" ") || undefined}
          className="w-full min-h-[44px] bg-transparent text-text-primary focus-ring" />
      </div>
      {errors?.[name] && <p id={`${id}-${name}-error`} className="mt-2 text-[14px] text-error">{errors[name]}</p>}
    </div>
  );

  return (
    <main id="main-content" tabIndex={-1} aria-labelledby="page-title" className="h-full overflow-y-auto bg-background font-sans outline-none">
      <div className="w-full max-w-[640px] mx-auto px-6 sm:px-10 py-10 sm:py-14">
        <h1 id="page-title" tabIndex={-1} className="text-[32px] font-semibold text-text-primary mb-4 rounded-radius-sm focus-ring">{title}</h1>
        <p className="text-[15px] text-text-secondary mb-6">Your account and saved learning data stay on this computer. Use a username, not an email address. Password recovery is not available.</p>
        <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">{message}</div>
        <form ref={form} onSubmit={submit} noValidate aria-label={creating ? "Create account" : "Sign in"} aria-busy={busy}>
          {creating && field("displayName", "Display name (optional)", displayName, setDisplayName, { autoComplete: "nickname" })}
          {field("username", "Username", username, setUsername, { required: true, autoComplete: "username", autoCapitalize: "none", spellCheck: false },
            creating ? "3–64 letters A–Z, numbers, dots, dashes or underscores; start with a letter or number." : null)}
          {field("password", "Password", password, setPassword, { required: true, type: visible ? "text" : "password", autoComplete: creating ? "new-password" : "current-password" }, "8–128 characters. Spaces are kept exactly as entered.")}
          <button type="button" disabled={busy} aria-pressed={visible} aria-controls={`${id}-password`}
            className="ds-btn-secondary mb-5" onClick={() => setVisible((value) => !value)}>Show password</button>
          {errors?.form && <p ref={errorSummary} tabIndex={-1} className="mb-5 p-4 border border-error rounded-radius-md text-text-primary focus-ring">{errors.form}</p>}
          <div className="flex flex-wrap gap-3 items-center">
            <button type="submit" disabled={busy} className="ds-btn-primary disabled:opacity-60">{busy ? creating ? "Creating account…" : "Signing in…" : creating ? "Create account" : "Sign in"}</button>
            <button type="button" disabled={busy} className="ds-btn-secondary" onClick={() => onNavigate(creating ? "login" : "signup")}>
              {creating ? "Already have an account? Sign in" : "Create an account"}
            </button>
          </div>
          {onBack && <button type="button" disabled={busy} onClick={onBack} className="ds-btn-text mt-6">Back to development app</button>}
        </form>
      </div>
    </main>
  );
}

export function Login(props) { return <AccountForm {...props} creating={false} />; }
export function Signup(props) { return <AccountForm {...props} creating />; }
