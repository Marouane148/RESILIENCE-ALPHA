import { useCallback, useEffect, useMemo, useState } from 'react';
import { useServiceStatus } from '../useServiceStatus';
import AssistantPanel from './AssistantPanel';
import { ActivityIcon, ArrowUpRightIcon, ClockIcon, DatabaseIcon, LogOutIcon, SendIcon, ShieldIcon } from './Icons';
import ThemeToggle from './ThemeToggle';

const startingBalance = 1245800;
const quickAmounts = [10, 50, 100, 500];
const grafanaPort = 3001;

const currency = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const timeFormat = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const dateTimeFormat = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

const card = 'rounded-3xl border border-line bg-surface shadow-card';
const fieldClass =
  'w-full rounded-xl border border-line bg-surface-2 px-4 py-3.5 text-sm text-ink outline-none transition placeholder:text-subtle focus:border-brand focus:bg-surface';

function StatusPill({ state }) {
  const tones = {
    up: { label: 'API disponible', dot: 'bg-ok', wrap: 'bg-ok-soft text-ok' },
    down: { label: 'API indisponible', dot: 'bg-bad', wrap: 'bg-bad-soft text-bad' },
    checking: { label: 'Vérification…', dot: 'bg-subtle', wrap: 'bg-surface-2 text-muted' },
  };
  const tone = tones[state];
  return (
    <span className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold ${tone.wrap}`} role="status">
      <span className="relative flex h-2 w-2">
        {state !== 'checking' && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${tone.dot}`} />}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${tone.dot}`} />
      </span>
      {tone.label}
    </span>
  );
}

function Kpi({ label, value, hint }) {
  return (
    <div className={`${card} p-5`}>
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="tabular mt-2 text-2xl font-semibold tracking-tight text-ink">{value}</p>
      <p className="mt-1 text-xs text-subtle">{hint}</p>
    </div>
  );
}

function HealthRow({ icon: Icon, label, value, tone }) {
  const color = { ok: 'text-ok', bad: 'text-bad', neutral: 'text-ink' }[tone];
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <span className="flex items-center gap-2.5 text-sm text-muted">
        <Icon className="h-4 w-4 text-subtle" />
        {label}
      </span>
      <span className={`tabular text-sm font-semibold ${color}`}>{value}</span>
    </div>
  );
}

function TimelineEvent({ event }) {
  const recovered = event.type === 'recovered';
  return (
    <li className="flex gap-3 py-3">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${recovered ? 'bg-ok' : 'bg-bad'}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-ink">{recovered ? 'Service rétabli' : 'Panne détectée'}</p>
          <span className="tabular shrink-0 text-xs text-subtle">{timeFormat.format(event.at)}</span>
        </div>
        <p className="mt-0.5 text-xs text-muted">
          {recovered ? `Reprise automatique en ${event.seconds} s` : 'L’API paiement ne répond plus'}
        </p>
      </div>
    </li>
  );
}

export default function PaymentDashboard({ session, onLogout }) {
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
  const { status, events } = useServiceStatus(apiUrl);
  const [payments, setPayments] = useState([]);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [notice, setNotice] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);

  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${session.token}` }), [session.token]);

  const loadPayments = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/payments`, { headers: authHeaders });
      if (response.status === 401) {
        onLogout();
        return;
      }
      if (response.ok) setPayments(await response.json());
    } catch {
      // L'état du service est déjà signalé par la sonde /health.
    }
  }, [apiUrl, authHeaders, onLogout]);

  useEffect(() => {
    if (status.state !== 'up') return undefined;
    loadPayments();
    const interval = window.setInterval(loadPayments, 5000);
    return () => window.clearInterval(interval);
  }, [status.state, loadPayments]);

  const lastEventId = events[0]?.type === 'recovered' ? events[0].id : null;
  useEffect(() => {
    if (!lastEventId) return undefined;
    setShowRecovery(true);
    const timeout = window.setTimeout(() => setShowRecovery(false), 20000);
    return () => window.clearTimeout(timeout);
  }, [lastEventId]);

  const totalSent = useMemo(() => payments.reduce((sum, payment) => sum + Number(payment.amount), 0), [payments]);
  const balance = startingBalance - totalSent;
  const amountValue = Number.parseFloat(amount.replace(',', '.')) || 0;
  const serviceUp = status.state === 'up';
  const canSubmit = serviceUp && recipient.trim().length > 2 && amountValue > 0 && amountValue <= balance;

  async function handleSubmit(event) {
    event.preventDefault();
    if (!canSubmit) return;

    setIsSubmitting(true);
    setNotice(null);
    try {
      const response = await fetch(`${apiUrl}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ recipient: recipient.trim(), amount: amountValue }),
      });
      if (response.status === 401) {
        onLogout();
        return;
      }
      if (!response.ok) throw new Error('payment_failed');

      setNotice({ tone: 'ok', text: `${currency.format(amountValue)} envoyé à ${recipient.trim()} · transaction enregistrée` });
      setRecipient('');
      setAmount('');
      await loadPayments();
    } catch {
      setNotice({ tone: 'bad', text: 'Paiement impossible : l’API ou la base de données est indisponible.' });
    } finally {
      setIsSubmitting(false);
    }
  }

  const grafanaUrl = `${window.location.protocol}//${window.location.hostname}:${grafanaPort}`;
  const initial = session.username.slice(0, 1).toUpperCase();

  return (
    <div className="min-h-screen bg-bg text-ink">
      <header className="sticky top-0 z-10 border-b border-line bg-bg/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand font-black text-brand-ink">r</div>
            <span className="hidden text-sm font-semibold tracking-[0.18em] text-ink sm:inline">
              RESILIENCE<span className="text-brand">/</span>PAY
            </span>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <StatusPill state={status.state} />
            <ThemeToggle />
            <button
              className="flex items-center gap-2 rounded-full border border-line bg-surface py-1 pl-1 pr-3 text-sm text-muted transition hover:text-ink"
              onClick={onLogout}
              title="Se déconnecter"
              type="button"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-soft text-xs font-bold text-brand">{initial}</span>
              <span className="hidden sm:inline">{session.username}</span>
              <LogOutIcon />
              <span className="sr-only">Se déconnecter</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
        {status.state === 'down' && (
          <div className="mb-6 flex items-start gap-3 rounded-2xl border border-bad/30 bg-bad-soft px-5 py-4 text-bad" role="alert">
            <span className="mt-1 h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-bad" />
            <div>
              <p className="text-sm font-semibold">Service de paiement indisponible</p>
              <p className="mt-0.5 text-sm opacity-90">La détection a démarré, la remédiation automatique est en cours. Aucune action n’est requise.</p>
            </div>
          </div>
        )}
        {showRecovery && status.state === 'up' && events[0]?.type === 'recovered' && (
          <div className="mb-6 flex items-start gap-3 rounded-2xl border border-ok/30 bg-ok-soft px-5 py-4 text-ok" role="status">
            <ShieldIcon className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="text-sm font-semibold">Service rétabli</p>
              <p className="mt-0.5 text-sm opacity-90">Reprise autonome en {events[0].seconds} s. Vous pouvez effectuer un nouveau paiement.</p>
            </div>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-6">
            <section
              className="relative overflow-hidden rounded-3xl p-7 text-white shadow-card sm:p-9"
              style={{
                background:
                  'radial-gradient(120% 120% at 100% 0%, rgb(45 212 191 / 0.35) 0%, transparent 55%), linear-gradient(135deg, #064e3b 0%, #047857 55%, #0f766e 100%)',
              }}
            >
              <div className="flex items-start justify-between gap-4">
                <p className="text-sm font-medium text-white/80">Solde disponible</p>
                <span className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-medium text-white/90">Données fictives</span>
              </div>
              <p className="tabular mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">{currency.format(balance)}</p>
              <p className="mt-6 text-xs text-white/70">Compte professionnel · •••• 4821</p>
            </section>

            <div className="grid gap-4 sm:grid-cols-3">
              <Kpi hint="enregistrées en base" label="Transactions" value={payments.length} />
              <Kpi hint="sur les 50 dernières" label="Volume envoyé" value={currency.format(totalSent)} />
              <Kpi hint="mesurée depuis ce navigateur" label="Latence API" value={status.latencyMs === null ? '—' : `${status.latencyMs} ms`} />
            </div>

            <section className={`${card} p-6 sm:p-8`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold tracking-tight text-ink">Envoyer un paiement</h2>
                  <p className="mt-1 text-sm text-muted">Un transfert simple, validé puis écrit dans PostgreSQL.</p>
                </div>
                <span className="rounded-lg border border-line px-2.5 py-1 text-[11px] font-medium text-muted">EUR · SEPA</span>
              </div>

              <form className="mt-7 space-y-5" onSubmit={handleSubmit}>
                <label className="block">
                  <span className="mb-2 block text-xs font-medium text-muted">Destinataire</span>
                  <input
                    autoComplete="off"
                    className={fieldClass}
                    onChange={(event) => setRecipient(event.target.value)}
                    placeholder="Nom, email ou IBAN"
                    type="text"
                    value={recipient}
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-xs font-medium text-muted">Montant</span>
                  <div className="relative">
                    <input
                      className={`${fieldClass} tabular pr-16 text-lg font-medium`}
                      inputMode="decimal"
                      onChange={(event) => setAmount(event.target.value)}
                      placeholder="0,00"
                      type="text"
                      value={amount}
                    />
                    <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm text-subtle">EUR</span>
                  </div>
                </label>
                <div className="flex flex-wrap gap-2">
                  {quickAmounts.map((value) => (
                    <button
                      className="rounded-full border border-line bg-surface-2 px-3.5 py-1.5 text-xs font-medium text-muted transition hover:border-brand hover:text-brand"
                      key={value}
                      onClick={() => setAmount(String(value))}
                      type="button"
                    >
                      {currency.format(value)}
                    </button>
                  ))}
                </div>
                <button
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-3.5 text-sm font-semibold text-brand-ink transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-subtle"
                  disabled={!canSubmit || isSubmitting}
                  type="submit"
                >
                  <SendIcon />
                  {isSubmitting ? 'Enregistrement…' : serviceUp ? 'Valider le paiement' : 'Service indisponible'}
                </button>
                <div aria-live="polite">
                  {notice && (
                    <p className={`rounded-xl px-4 py-3 text-sm ${notice.tone === 'ok' ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad'}`}>{notice.text}</p>
                  )}
                </div>
              </form>
            </section>

            <section className={`${card} p-6 sm:p-8`}>
              <h2 className="text-xl font-semibold tracking-tight text-ink">Dernières transactions</h2>
              {payments.length === 0 ? (
                <p className="mt-4 text-sm text-muted">Aucune transaction enregistrée pour le moment.</p>
              ) : (
                <ul className="mt-4 divide-y divide-line">
                  {payments.slice(0, 6).map((payment) => (
                    <li className="flex items-center justify-between gap-4 py-3.5" key={payment.id}>
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand">
                          <ArrowUpRightIcon />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-ink">{payment.recipient}</p>
                          <p className="text-xs text-subtle">{dateTimeFormat.format(new Date(payment.created_at))}</p>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="tabular text-sm font-semibold text-ink">−{currency.format(Number(payment.amount))}</p>
                        <p className="text-xs text-ok">Accepté</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <AssistantPanel apiUrl={apiUrl} onUnauthorized={onLogout} token={session.token} />
          </div>

          <aside className="space-y-6">
            <section className={`${card} p-6`}>
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold tracking-tight text-ink">Santé du service</h2>
                <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand">LIVE</span>
              </div>
              <div className="mt-2 divide-y divide-line">
                <HealthRow
                  icon={ActivityIcon}
                  label="API paiement"
                  tone={status.state === 'up' ? 'ok' : status.state === 'down' ? 'bad' : 'neutral'}
                  value={status.state === 'up' ? 'Opérationnelle' : status.state === 'down' ? 'Indisponible' : '…'}
                />
                <HealthRow
                  icon={DatabaseIcon}
                  label="Base de données"
                  tone={status.database === 'ok' ? 'ok' : status.database ? 'bad' : 'neutral'}
                  value={status.database === 'ok' ? 'Connectée' : status.database ? 'Injoignable' : '…'}
                />
                <HealthRow
                  icon={ClockIcon}
                  label="Dernière vérification"
                  tone="neutral"
                  value={status.checkedAt ? timeFormat.format(status.checkedAt) : '—'}
                />
              </div>
            </section>

            <section className={`${card} p-6`}>
              <h2 className="text-base font-semibold tracking-tight text-ink">Journal de reprise</h2>
              {events.length === 0 ? (
                <p className="mt-3 text-sm text-muted">Aucun incident depuis l’ouverture de la session. Le journal se remplit en cas de panne.</p>
              ) : (
                <ul className="mt-2 divide-y divide-line">
                  {events.map((event) => (
                    <TimelineEvent event={event} key={event.id} />
                  ))}
                </ul>
              )}
            </section>

            <a
              className={`${card} flex items-center justify-between gap-3 p-5 text-sm transition hover:border-brand`}
              href={grafanaUrl}
              rel="noreferrer"
              target="_blank"
            >
              <span>
                <span className="block font-semibold text-ink">Supervision Grafana</span>
                <span className="mt-0.5 block text-xs text-muted">Prometheus · Loki · alertes</span>
              </span>
              <ArrowUpRightIcon className="h-5 w-5 text-brand" />
            </a>
          </aside>
        </div>
      </main>
    </div>
  );
}
