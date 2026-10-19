import express from 'express';
import pg from 'pg';

const app = express();
const port = Number(process.env.PORT || 3000);
const apiToken = process.env.PAYMENT_API_TOKEN;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let paymentCount = 0;
let requestCount = 0;
let rejectedRequestCount = 0;
let databaseReady = false;

app.use(express.json());
app.use((request, response, next) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (request.method === 'OPTIONS') return response.sendStatus(204);
  next();
});

app.use((request, _response, next) => {
  requestCount += 1;
  console.log(JSON.stringify({
    event: 'http_request',
    method: request.method,
    path: request.path,
    timestamp: new Date().toISOString(),
  }));
  next();
});

app.use((request, response, next) => {
  if (request.path === '/health' || request.path === '/metrics' || request.method === 'OPTIONS') return next();
  if (!apiToken || request.get('Authorization') !== `Bearer ${apiToken}`) {
    rejectedRequestCount += 1;
    console.warn(JSON.stringify({ event: 'auth_rejected', path: request.path, timestamp: new Date().toISOString() }));
    return response.status(401).json({ error: 'authentication required' });
  }
  next();
});

app.get('/health', async (_request, response) => {
  try {
    await pool.query('SELECT 1');
    databaseReady = true;
    response.json({ status: 'ok', service: 'payment-api', database: 'ok' });
  } catch (error) {
    databaseReady = false;
    response.status(503).json({ status: 'degraded', service: 'payment-api', database: 'unavailable' });
  }
});

app.get('/metrics', (_request, response) => {
  response.type('text/plain').send([
    '# HELP payment_api_up Payment API availability.',
    '# TYPE payment_api_up gauge',
    'payment_api_up 1',
    '# HELP payment_transactions_total Number of accepted payment transactions.',
    '# TYPE payment_transactions_total counter',
    `payment_transactions_total ${paymentCount}`,
    '# HELP payment_api_requests_total Total number of HTTP requests.',
    '# TYPE payment_api_requests_total counter',
    `payment_api_requests_total ${requestCount}`,
    '# HELP payment_api_rejected_requests_total Total number of rejected payment requests.',
    '# TYPE payment_api_rejected_requests_total counter',
    `payment_api_rejected_requests_total ${rejectedRequestCount}`,
  ].join('\n') + '\n');
});

app.post('/payments', (request, response) => {
  const { recipient, amount } = request.body ?? {};
  const numericAmount = Number(amount);

  if (!recipient || !Number.isFinite(numericAmount) || numericAmount <= 0) {
    rejectedRequestCount += 1;
    console.warn(JSON.stringify({
      event: 'payment_request_rejected',
      reason: 'invalid_payload',
      path: request.path,
      timestamp: new Date().toISOString(),
    }));
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
  const { rows } = await pool.query(
    'SELECT id, recipient, amount, currency, status, created_at FROM payments ORDER BY created_at DESC LIMIT 50',
  );
  response.json(rows);
});

async function start() {
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
  databaseReady = true;
  app.listen(port, '0.0.0.0', () => console.log(`payment-api listening on port ${port}`));
}

start().catch((error) => {
  console.error('payment-api startup failed', error);
  process.exit(1);
});
