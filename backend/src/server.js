import express from 'express';
import pg from 'pg';
import { createAuth } from './auth.js';
import { loadSecrets } from './secrets.js';

const app = express();
const port = Number(process.env.PORT || 3000);
const assistantUrl = process.env.ASSISTANT_URL;
const maxAmount = 9999999999.99;

let pool;
let auth;
let paymentCount = 0;
let requestCount = 0;
let rejectedRequestCount = 0;
let assistantRequestCount = 0;
let assistantBusy = false;
let databaseReady = false;
const authEvents = new Map();

function countAuthEvent(event) {
  authEvents.set(event, (authEvents.get(event) ?? 0) + 1);
}

function logEvent(level, payload) {
  console[level](JSON.stringify({ ...payload, timestamp: new Date().toISOString() }));
}

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use((request, response, next) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (request.method === 'OPTIONS') return response.sendStatus(204);
  next();
});

app.use((request, _response, next) => {
  requestCount += 1;
  logEvent('log', { event: 'http_request', method: request.method, path: request.path });
  next();
});

app.use((request, response, next) => {
  if (request.path === '/health' || request.path === '/metrics' || request.method === 'OPTIONS' || auth.isPublic(request)) return next();
  if (!auth.isAuthorized(request)) {
    rejectedRequestCount += 1;
    countAuthEvent('token_rejected');
    logEvent('warn', { event: 'auth_rejected', path: request.path });
    return response.status(401).json({ error: 'authentication required' });
  }
  next();
});

// Le routeur d'authentification est monté au démarrage, une fois les secrets chargés.
app.use((request, response, next) => auth.router(request, response, next));

app.get('/health', async (_request, response) => {
  try {
    await pool.query('SELECT 1');
    databaseReady = true;
    response.json({ status: 'ok', service: 'payment-api', database: 'ok' });
  } catch {
    databaseReady = false;
    response.status(503).json({ status: 'degraded', service: 'payment-api', database: 'unavailable' });
  }
});

app.get('/metrics', (_request, response) => {
  const authLines = [...authEvents].map(([event, value]) => `payment_api_auth_events_total{event="${event}"} ${value}`);
  response.type('text/plain').send([
    '# HELP payment_api_up Payment API availability.',
    '# TYPE payment_api_up gauge',
    'payment_api_up 1',
    '# HELP payment_api_database_up PostgreSQL reachability seen by the API.',
    '# TYPE payment_api_database_up gauge',
    `payment_api_database_up ${databaseReady ? 1 : 0}`,
    '# HELP payment_transactions_total Number of accepted payment transactions.',
    '# TYPE payment_transactions_total counter',
    `payment_transactions_total ${paymentCount}`,
    '# HELP payment_api_requests_total Total number of HTTP requests.',
    '# TYPE payment_api_requests_total counter',
    `payment_api_requests_total ${requestCount}`,
    '# HELP payment_api_rejected_requests_total Total number of rejected payment requests.',
    '# TYPE payment_api_rejected_requests_total counter',
    `payment_api_rejected_requests_total ${rejectedRequestCount}`,
    '# HELP payment_api_assistant_requests_total Questions sent to the operator assistant.',
    '# TYPE payment_api_assistant_requests_total counter',
    `payment_api_assistant_requests_total ${assistantRequestCount}`,
    '# HELP payment_api_auth_events_total Authentication events by outcome.',
    '# TYPE payment_api_auth_events_total counter',
    ...authLines,
  ].join('\n') + '\n');
});

app.post('/payments', (request, response) => {
  const { recipient, amount } = request.body ?? {};
  const numericAmount = Number(amount);
  const validRecipient = typeof recipient === 'string' && recipient.trim().length > 0 && recipient.length <= 120;

  if (!validRecipient || !Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > maxAmount) {
    rejectedRequestCount += 1;
    logEvent('warn', { event: 'payment_request_rejected', reason: 'invalid_payload', path: request.path });
    return response.status(400).json({ error: 'recipient and a positive amount are required' });
  }

  return pool.query(
    'INSERT INTO payments (recipient, amount, currency, status) VALUES ($1, $2, $3, $4) RETURNING id, recipient, amount, currency, status, created_at',
    [recipient.trim(), numericAmount, 'EUR', 'accepted'],
  ).then(({ rows }) => {
    paymentCount += 1;
    return response.status(201).json(rows[0]);
  }).catch(() => response.status(503).json({ error: 'payment storage unavailable' }));
});

app.get('/payments', async (_request, response) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, recipient, amount, currency, status, created_at FROM payments ORDER BY created_at DESC LIMIT 50',
    );
    response.json(rows);
  } catch {
    response.status(503).json({ error: 'payment storage unavailable' });
  }
});

// Relais vers l'assistant opérateur (Ollama + LangChain + RAG) : il reste sur le réseau interne, sans accès privilégié.
app.post('/assistant/ask', async (request, response) => {
  const question = request.body?.question;
  if (!assistantUrl) return response.status(503).json({ error: 'assistant not configured' });
  if (typeof question !== 'string' || question.trim().length < 3 || question.length > 500) {
    return response.status(400).json({ error: 'question must contain 3 to 500 characters' });
  }
  if (assistantBusy) return response.status(429).json({ error: 'assistant is busy, retry shortly' });

  assistantBusy = true;
  assistantRequestCount += 1;
  try {
    const upstream = await fetch(`${assistantUrl}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: question.trim() }),
      signal: AbortSignal.timeout(180000),
    });
    if (!upstream.ok) throw new Error(`assistant responded ${upstream.status}`);
    return response.json(await upstream.json());
  } catch (error) {
    logEvent('warn', { event: 'assistant_unavailable', reason: error.message });
    return response.status(503).json({ error: 'assistant unavailable' });
  } finally {
    assistantBusy = false;
  }
});

async function start() {
  const secrets = await loadSecrets();
  if (!secrets.PAYMENT_API_TOKEN || !secrets.POSTGRES_PASSWORD) throw new Error('required secrets are missing');
  logEvent('log', { event: 'secrets_loaded', source: secrets.source });

  const databaseUrl = process.env.DATABASE_URL
    || `postgresql://${encodeURIComponent(process.env.POSTGRES_USER || 'resilience')}:${encodeURIComponent(secrets.POSTGRES_PASSWORD)}`
      + `@${process.env.POSTGRES_HOST || 'postgres'}:5432/${process.env.POSTGRES_DB || 'resilience'}`;
  // Délais courts : une base injoignable doit produire une erreur rapide (503 sur /health), jamais un blocage.
  pool = new pg.Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 2000,
    query_timeout: 3000,
    idleTimeoutMillis: 10000,
    keepAlive: true,
  });
  pool.on('error', (error) => logEvent('warn', { event: 'database_pool_error', reason: error.message }));

  auth = createAuth({
    pool,
    apiToken: secrets.PAYMENT_API_TOKEN,
    sessionSecret: secrets.SESSION_SECRET,
    onRejected: (reason) => {
      rejectedRequestCount += 1;
      countAuthEvent(reason);
      logEvent('warn', { event: 'auth_rejected', reason });
    },
    onEvent: countAuthEvent,
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id BIGSERIAL PRIMARY KEY,
      recipient TEXT NOT NULL,
      amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
      currency CHAR(3) NOT NULL DEFAULT 'EUR',
      status TEXT NOT NULL CHECK (status IN ('accepted', 'rejected')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await auth.init();
  databaseReady = true;

  // Maintient la jauge payment_api_database_up à jour même sans appel à /health.
  setInterval(() => {
    pool.query('SELECT 1').then(() => { databaseReady = true; }).catch(() => { databaseReady = false; });
  }, 3000).unref();

  const server = app.listen(port, '0.0.0.0', () => console.log(`payment-api listening on port ${port}`));

  // Arrêt propre : sans gestionnaire, Docker attend 10 s avant de tuer le processus à chaque redémarrage.
  const shutdown = () => {
    logEvent('log', { event: 'shutdown' });
    server.close(() => pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch((error) => {
  console.error('payment-api startup failed', error);
  process.exit(1);
});
