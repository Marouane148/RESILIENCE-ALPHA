import { useEffect, useMemo, useState } from 'react';

const initialEvents = [
  {
    id: 1,
    service: 'Prometheus',
    message: 'API paiement · latence nominale',
    time: 'à l’instant',
    tone: 'success',
  },
  {
    id: 2,
    service: 'Loki',
    message: 'Journal agrégé · 0 erreur critique',
    time: 'il y a 12 s',
    tone: 'info',
  },
  {
    id: 3,
    service: 'Résilience SI',
    message: 'Réplication PostgreSQL confirmée',
    time: 'il y a 28 s',
    tone: 'success',
  },
];

const simulatedEvents = [
  {
    service: 'Prometheus',
    message: 'Nouveau point de métrique reçu',
    tone: 'info',
  },
  {
    service: 'Loki',
    message: 'Flux de logs synchronisé',
    tone: 'success',
  },
  {
    service: 'Résilience SI',
    message: 'Sonde de disponibilité validée',
    tone: 'success',
  },
];

const eventTone = {
  success: 'bg-emerald-400',
  info: 'bg-sky-400',
  warning: 'bg-amber-400',
};

function formatCurrency(value) {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
  }).format(value);
}

function StatusBadge() {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-xs font-medium text-emerald-300">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
      </span>
      SI résilient · opérationnel
    </div>
  );
}

function MetricCard({ label, value, detail, accent }) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4">
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className={`mt-3 text-xl font-semibold tracking-tight ${accent}`}>{value}</p>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
    </div>
  );
}

function EventRow({ event }) {
  return (
    <div className="flex gap-3 border-b border-white/[0.06] py-3 last:border-0">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${eventTone[event.tone]}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <p className="truncate text-sm font-medium text-slate-200">{event.service}</p>
          <span className="shrink-0 text-[11px] text-slate-600">{event.time}</span>
        </div>
        <p className="mt-1 truncate text-xs text-slate-500">{event.message}</p>
      </div>
    </div>
  );
}

function IntegrityGauge({ score }) {
  const circumference = 2 * Math.PI * 52;
  const dashOffset = circumference - (score / 100) * circumference;

  return (
    <div className="relative flex h-44 w-44 items-center justify-center">
      <svg className="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r="52" fill="none" stroke="currentColor" strokeWidth="8" className="text-white/[0.07]" />
        <circle
          cx="60"
          cy="60"
          r="52"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="8"
          className="text-emerald-400 transition-all duration-700"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
        />
      </svg>
      <div className="text-center">
        <p className="text-4xl font-semibold tracking-tight text-white">{score}%</p>
        <p className="mt-1 text-xs uppercase tracking-[0.18em] text-emerald-300">intégrité</p>
      </div>
    </div>
  );
}

export default function PaymentDashboard() {
  const [balance, setBalance] = useState(1245800);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [events, setEvents] = useState(initialEvents);
  const [notice, setNotice] = useState('');
  const [eventIndex, setEventIndex] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
  const apiToken = import.meta.env.VITE_API_TOKEN || '';

  useEffect(() => {
    const interval = window.setInterval(() => {
      const nextEvent = simulatedEvents[eventIndex % simulatedEvents.length];
      setEvents((currentEvents) => [
        {
          ...nextEvent,
          id: Date.now(),
          time: 'à l’instant',
        },
        ...currentEvents.map((event, index) => (index === 0 ? { ...event, time: 'il y a 8 s' } : event)).slice(0, 3),
      ]);
      setEventIndex((currentIndex) => currentIndex + 1);
    }, 7000);

    return () => window.clearInterval(interval);
  }, [eventIndex]);

  const amountValue = Number.parseFloat(amount.replace(',', '.')) || 0;
  const canSubmit = recipient.trim().length > 2 && amountValue > 0 && amountValue <= balance;
  const balanceLabel = useMemo(() => formatCurrency(balance), [balance]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!canSubmit) return;

    setIsSubmitting(true);
    setNotice('');
    try {
      const response = await fetch(`${apiUrl}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiToken}` },
        body: JSON.stringify({ recipient: recipient.trim(), amount: amountValue }),
      });
      if (!response.ok) throw new Error('payment_failed');

      setBalance((currentBalance) => currentBalance - amountValue);
      setNotice(`${formatCurrency(amountValue)} envoyé à ${recipient.trim()} · transaction enregistrée`);
      setRecipient('');
      setAmount('');
    } catch {
      setNotice('Paiement impossible : l’API ou la base de données est indisponible.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#080b12] px-4 py-6 font-sans text-slate-100 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-col justify-between gap-6 border-b border-white/[0.08] pb-7 sm:flex-row sm:items-start">
          <div>
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-400 font-black text-[#08110e]">r</div>
              <span className="text-sm font-semibold tracking-[0.2em] text-slate-300">RESILIENCE<span className="text-emerald-400">/</span>PAY</span>
            </div>
            <p className="text-sm text-slate-500">Vue d’ensemble financière</p>
            <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-2">
              <h1 className="text-4xl font-semibold tracking-[-0.04em] text-white sm:text-5xl">{balanceLabel}</h1>
              <span className="mb-1 text-sm text-emerald-400">+2,8% ce mois</span>
            </div>
          </div>
          <div className="flex flex-col items-start gap-3 sm:items-end">
            <StatusBadge />
            <p className="text-xs text-slate-600">Dernière synchronisation · il y a 3 s</p>
          </div>
        </header>

        <div className="grid gap-6 py-7 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="space-y-6">
            <div className="grid gap-3 sm:grid-cols-3">
              <MetricCard label="Flux du jour" value="18 420,00 €" detail="+14,6% vs hier" accent="text-white" />
              <MetricCard label="Taux de succès" value="99,98%" detail="sur 2 841 transactions" accent="text-emerald-300" />
              <MetricCard label="Latence API" value="84 ms" detail="p95 · dans la cible" accent="text-sky-300" />
            </div>

            <section className="rounded-3xl border border-white/[0.08] bg-[#0d121c] p-5 shadow-2xl shadow-black/10 sm:p-7">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-emerald-400">Opération rapide</p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">Envoyer un paiement</h2>
                  <p className="mt-1 text-sm text-slate-500">Un transfert simple, suivi en temps réel.</p>
                </div>
                <span className="rounded-lg border border-white/[0.08] px-2.5 py-1 text-[11px] text-slate-500">EUR · SEPA</span>
              </div>

              <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
                <label className="block">
                  <span className="mb-2 block text-xs font-medium text-slate-400">Destinataire</span>
                  <input
                    className="w-full rounded-xl border border-white/[0.1] bg-[#080b12] px-4 py-3.5 text-sm text-white outline-none transition placeholder:text-slate-700 focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/10"
                    onChange={(event) => setRecipient(event.target.value)}
                    placeholder="Nom, email ou IBAN"
                    type="text"
                    value={recipient}
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-xs font-medium text-slate-400">Montant</span>
                  <div className="relative">
                    <input
                      className="w-full rounded-xl border border-white/[0.1] bg-[#080b12] px-4 py-3.5 pr-16 text-lg font-medium text-white outline-none transition placeholder:text-slate-700 focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/10"
                      inputMode="decimal"
                      onChange={(event) => setAmount(event.target.value)}
                      placeholder="0,00"
                      type="text"
                      value={amount}
                    />
                    <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm text-slate-500">EUR</span>
                  </div>
                </label>
                <button
                  className="w-full rounded-xl bg-emerald-400 px-4 py-3.5 text-sm font-semibold text-[#07110e] transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-600"
                  disabled={!canSubmit || isSubmitting}
                  type="submit"
                >
                  {isSubmitting ? 'Enregistrement…' : 'Valider le paiement'} <span className="ml-1">→</span>
                </button>
                {notice && <p className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-300">{notice}</p>}
              </form>
            </section>
          </section>

          <aside className="rounded-3xl border border-white/[0.08] bg-[#0d121c] p-5 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-sky-400">Observabilité</p>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-white">Santé du SI</h2>
              </div>
              <span className="rounded-lg bg-emerald-400/10 px-2 py-1 text-[11px] font-medium text-emerald-300">LIVE</span>
            </div>

            <div className="mt-4 flex justify-center border-b border-white/[0.06] pb-5">
              <IntegrityGauge score={99} />
            </div>
            <div className="grid grid-cols-2 gap-3 border-b border-white/[0.06] py-5">
              <div>
                <p className="text-xs text-slate-600">Services actifs</p>
                <p className="mt-1 text-lg font-semibold text-white">8 / 8</p>
              </div>
              <div>
                <p className="text-xs text-slate-600">Incidents ouverts</p>
                <p className="mt-1 text-lg font-semibold text-emerald-300">0</p>
              </div>
            </div>

            <div className="pt-5">
              <div className="mb-1 flex items-center justify-between">
                <h3 className="text-sm font-medium text-slate-300">Flux d’événements</h3>
                <span className="flex items-center gap-1.5 text-[11px] text-slate-600"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> temps réel</span>
              </div>
              <div className="mt-2">
                {events.map((event) => <EventRow event={event} key={event.id} />)}
              </div>
            </div>
          </aside>
        </div>

        <footer className="flex flex-col gap-2 border-t border-white/[0.08] py-5 text-xs text-slate-600 sm:flex-row sm:items-center sm:justify-between">
          <span>Compte professionnel · **** 4821</span>
          <span>Prometheus · Grafana · Loki connectés</span>
        </footer>
      </div>
    </main>
  );
}
