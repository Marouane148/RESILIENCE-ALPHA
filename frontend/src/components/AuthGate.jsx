import { useEffect, useState } from 'react';
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { ShieldIcon } from './Icons';
import PaymentDashboard from './PaymentDashboard';
import ThemeToggle from './ThemeToggle';

const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const storageKey = 'resilience-session';

function readStoredSession() {
  try {
    const session = JSON.parse(window.sessionStorage.getItem(storageKey));
    return session && session.expiresAt > Date.now() ? session : null;
  } catch {
    return null;
  }
}

async function postJson(path, body, token) {
  const response = await fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}

function describeError(error) {
  if (error?.name === 'NotAllowedError') {
    return 'Face ID annulé, refusé ou aucune clé d’accès trouvée sur cet appareil. Si le problème persiste, enrôlez de nouveau l’appareil (Windows Hello) depuis « Première connexion ».';
  }
  if (error?.name === 'InvalidStateError') return 'Cet appareil est déjà enrôlé pour ce compte.';
  if (error?.message === '401') return 'Authentification refusée.';
  if (error?.message === '400') return 'Enrôlement refusé : vérifiez le nom et le code.';
  return 'Authentification impossible : l’API est indisponible.';
}

const inputClass =
  'w-full rounded-xl border border-line bg-surface-2 px-4 py-3.5 text-sm text-ink outline-none transition placeholder:text-subtle focus:border-brand focus:bg-surface';
const primaryButton =
  'w-full rounded-xl bg-brand px-4 py-3.5 text-sm font-semibold text-brand-ink transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-subtle';
const linkButton = 'w-full text-sm text-muted transition hover:text-ink';

export default function AuthGate() {
  const [session, setSession] = useState(readStoredSession);
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [enrollmentCode, setEnrollmentCode] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const supported = browserSupportsWebAuthn() && window.isSecureContext;

  function openSession(next) {
    window.sessionStorage.setItem(storageKey, JSON.stringify(next));
    setSession(next);
    setMessage('');
  }

  function logout() {
    window.sessionStorage.removeItem(storageKey);
    setSession(null);
    setMode('login');
    setUsername('');
    setEnrollmentCode('');
  }

  useEffect(() => {
    if (!session) return undefined;
    const timeout = window.setTimeout(logout, Math.max(session.expiresAt - Date.now(), 0));
    return () => window.clearTimeout(timeout);
  }, [session]);

  async function handleLogin() {
    setBusy(true);
    setMessage('');
    try {
      const { options, challengeId } = await postJson('/auth/login/options', {});
      const assertion = await startAuthentication({ optionsJSON: options });
      openSession(await postJson('/auth/login/verify', { challengeId, response: assertion }));
    } catch (error) {
      setMessage(describeError(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleEnroll(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const { options, challengeId } = await postJson('/auth/register/options', { username: username.trim() }, enrollmentCode);
      const attestation = await startRegistration({ optionsJSON: options });
      openSession(await postJson('/auth/register/verify', { challengeId, response: attestation }, enrollmentCode));
    } catch (error) {
      setMessage(describeError(error));
    } finally {
      setBusy(false);
    }
  }

  if (session) return <PaymentDashboard onLogout={logout} session={session} />;

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-bg px-4 py-10 text-ink">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{ background: 'radial-gradient(60% 50% at 50% 0%, var(--brand-soft) 0%, transparent 70%)' }}
      />
      <div className="absolute right-4 top-4 sm:right-8 sm:top-6">
        <ThemeToggle />
      </div>

      <section className="relative w-full max-w-md rounded-3xl border border-line bg-surface p-8 shadow-card sm:p-10">
        <div className="mb-9 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand font-black text-brand-ink">r</div>
          <span className="text-sm font-semibold tracking-[0.18em] text-ink">
            RESILIENCE<span className="text-brand">/</span>PAY
          </span>
        </div>

        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-soft text-brand">
          <ShieldIcon className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          {mode === 'login' ? 'Connexion sécurisée' : 'Enrôler cet appareil'}
        </h1>
        <p className="mt-2 text-sm text-muted">
          {mode === 'login'
            ? 'Validez avec Face ID, Touch ID, Windows Hello ou le déverrouillage de votre appareil.'
            : 'Associez la biométrie de cet appareil à votre compte. Seule une clé publique est conservée.'}
        </p>

        {!supported && (
          <p className="mt-6 rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">
            Face ID nécessite un navigateur compatible WebAuthn et une connexion sécurisée (HTTPS ou localhost).
          </p>
        )}

        {mode === 'login' ? (
          <div className="mt-7 space-y-4">
            <button className={primaryButton} disabled={!supported || busy} onClick={handleLogin} type="button">
              {busy ? 'Vérification…' : 'Se connecter avec Face ID'}
            </button>
            <button className={linkButton} onClick={() => { setMode('enroll'); setMessage(''); }} type="button">
              Première connexion ? <span className="font-medium text-brand">Enrôler cet appareil</span>
            </button>
          </div>
        ) : (
          <form className="mt-7 space-y-4" onSubmit={handleEnroll}>
            <input
              aria-label="Nom d’utilisateur"
              autoComplete="username webauthn"
              className={inputClass}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="Nom d’utilisateur"
              type="text"
              value={username}
            />
            <input
              aria-label="Code d’enrôlement"
              autoComplete="off"
              className={inputClass}
              onChange={(event) => setEnrollmentCode(event.target.value)}
              placeholder="Code d’enrôlement"
              type="password"
              value={enrollmentCode}
            />
            <button className={primaryButton} disabled={!supported || busy || username.trim().length < 3 || !enrollmentCode} type="submit">
              {busy ? 'Enrôlement…' : 'Enregistrer cet appareil'}
            </button>
            <button className={linkButton} onClick={() => { setMode('login'); setMessage(''); }} type="button">
              Retour à la connexion
            </button>
          </form>
        )}

        <div aria-live="polite">
          {message && <p className="mt-5 rounded-xl bg-bad-soft px-4 py-3 text-sm text-bad">{message}</p>}
        </div>
      </section>
    </main>
  );
}
