import { useState } from 'react';

const suggestions = [
  'Que faire si l’API est indisponible ?',
  'Que signifie l’alerte PaymentInvalidRequestBurst ?',
  'Comment vérifier que la reprise a réussi ?',
];

const errorMessages = {
  400: 'Question invalide : entre 3 et 500 caractères.',
  429: 'L’assistant traite déjà une question, réessayez dans un instant.',
  503: 'L’assistant prépare ses modèles locaux ou est indisponible. Réessayez dans quelques minutes.',
};

export default function AssistantPanel({ apiUrl, token, onUnauthorized }) {
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function ask(text) {
    const trimmed = text.trim();
    if (trimmed.length < 3 || loading) return;

    setLoading(true);
    setError('');
    setResult(null);
    try {
      const response = await fetch(`${apiUrl}/assistant/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ question: trimmed }),
        signal: AbortSignal.timeout(185000),
      });
      if (response.status === 401) {
        onUnauthorized();
        return;
      }
      if (!response.ok) throw new Error(String(response.status));
      setResult(await response.json());
    } catch (failure) {
      setError(errorMessages[failure.message] ?? 'L’assistant ne répond pas pour le moment.');
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    ask(question);
  }

  return (
    <section className="rounded-3xl border border-line bg-surface p-6 shadow-card sm:p-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-ink">Assistant opérateur</h2>
          <p className="mt-1 text-sm text-muted">Répond à partir du runbook et de la documentation. Il n’exécute aucune action.</p>
        </div>
        <span className="rounded-lg border border-line px-2.5 py-1 text-[11px] font-medium text-muted">Modèle local</span>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {suggestions.map((text) => (
          <button
            className="rounded-full border border-line bg-surface-2 px-3.5 py-1.5 text-left text-xs font-medium text-muted transition hover:border-brand hover:text-brand disabled:opacity-50"
            disabled={loading}
            key={text}
            onClick={() => { setQuestion(text); ask(text); }}
            type="button"
          >
            {text}
          </button>
        ))}
      </div>

      <form className="mt-4 flex gap-2" onSubmit={handleSubmit}>
        <input
          aria-label="Question pour l’assistant"
          className="w-full rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm text-ink outline-none transition placeholder:text-subtle focus:border-brand focus:bg-surface"
          maxLength={500}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Posez une question sur un incident ou une procédure"
          type="text"
          value={question}
        />
        <button
          className="shrink-0 rounded-xl bg-brand px-5 text-sm font-semibold text-brand-ink transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-subtle"
          disabled={loading || question.trim().length < 3}
          type="submit"
        >
          {loading ? 'Analyse…' : 'Demander'}
        </button>
      </form>

      <div aria-live="polite" className="mt-4">
        {loading && <p className="text-sm text-muted">Recherche dans la documentation, puis rédaction de la réponse. Cela peut prendre une minute.</p>}
        {error && <p className="rounded-xl bg-bad-soft px-4 py-3 text-sm text-bad">{error}</p>}
        {result && (
          <div className="space-y-3">
            <p className="whitespace-pre-wrap rounded-2xl bg-surface-2 px-4 py-3.5 text-sm leading-relaxed text-ink">{result.answer}</p>
            {result.sources.length > 0 && (
              <p className="text-xs text-subtle">
                Sources : {result.sources.map((source) => source.source).join(' · ')}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
