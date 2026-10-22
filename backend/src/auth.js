import crypto from 'node:crypto';
import express from 'express';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';

const rpName = 'Resilience Pay';
const rpID = process.env.WEBAUTHN_RP_ID || 'localhost';
const expectedOrigins = (process.env.WEBAUTHN_ORIGIN || 'http://localhost:8080')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const challengeTtlMs = 5 * 60 * 1000;
const sessionTtlMs = 15 * 60 * 1000;
const challenges = new Map();

function base64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function safeEqual(a, b) {
  const left = crypto.createHash('sha256').update(String(a)).digest();
  const right = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(left, right);
}

function storeChallenge(payload) {
  const now = Date.now();
  for (const [id, entry] of challenges) {
    if (entry.expiresAt <= now) challenges.delete(id);
  }
  const id = crypto.randomUUID();
  challenges.set(id, { ...payload, expiresAt: now + challengeTtlMs });
  return id;
}

function takeChallenge(id) {
  const entry = challenges.get(id);
  challenges.delete(id);
  return entry && entry.expiresAt > Date.now() ? entry : null;
}

export function createAuth({ pool, apiToken, sessionSecret: providedSecret, onRejected = () => {}, onEvent = () => {} }) {
  const sessionSecret = providedSecret || process.env.SESSION_SECRET
    || crypto.createHmac('sha256', apiToken || 'unset').update('session-secret').digest('hex');

  function sign(value) {
    return crypto.createHmac('sha256', sessionSecret).update(value).digest('base64url');
  }

  function issueSession(username) {
    const expiresAt = Date.now() + sessionTtlMs;
    const body = Buffer.from(JSON.stringify({ sub: username, exp: expiresAt })).toString('base64url');
    return { token: `${body}.${sign(body)}`, expiresAt, username };
  }

  function readSession(token) {
    const [body, signature] = String(token).split('.');
    if (!body || !signature || !safeEqual(signature, sign(body))) return null;
    try {
      const session = JSON.parse(Buffer.from(body, 'base64url').toString());
      return session.exp > Date.now() ? session : null;
    } catch {
      return null;
    }
  }

  function bearerToken(request) {
    const header = request.get('Authorization') || '';
    return header.startsWith('Bearer ') ? header.slice(7) : '';
  }

  // Les routes /auth/login/* sont publiques ; tout le reste exige le token de laboratoire ou une session Face ID.
  function isAuthorized(request) {
    const token = bearerToken(request);
    if (!token) return false;
    if (apiToken && safeEqual(token, apiToken)) return true;
    return readSession(token) !== null;
  }

  function isPublic(request) {
    return request.path.startsWith('/auth/login/');
  }

  async function init() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS auth_users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS auth_credentials (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
        public_key BYTEA NOT NULL,
        counter BIGINT NOT NULL DEFAULT 0,
        transports TEXT[],
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }

  const router = express.Router();

  router.post('/auth/register/options', async (request, response) => {
    const username = String(request.body?.username ?? '').trim();
    if (username.length < 3 || username.length > 64) {
      return response.status(400).json({ error: 'username must contain 3 to 64 characters' });
    }

    const { rows } = await pool.query('SELECT id FROM auth_users WHERE username = $1', [username]);
    const userID = rows[0]?.id ?? base64url(crypto.randomBytes(32));
    const existing = rows[0]
      ? (await pool.query('SELECT id, transports FROM auth_credentials WHERE user_id = $1', [userID])).rows
      : [];

    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userName: username,
      userID: Buffer.from(userID, 'base64url'),
      attestationType: 'none',
      excludeCredentials: existing.map((credential) => ({
        id: credential.id,
        transports: credential.transports ?? undefined,
      })),
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        residentKey: 'required',
        userVerification: 'required',
      },
    });

    const challengeId = storeChallenge({ type: 'register', challenge: options.challenge, userID, username });
    return response.json({ options, challengeId });
  });

  router.post('/auth/register/verify', async (request, response) => {
    const { challengeId, response: attestation } = request.body ?? {};
    const entry = takeChallenge(challengeId);
    if (!entry || entry.type !== 'register' || !attestation) {
      return response.status(400).json({ error: 'registration challenge expired or invalid' });
    }

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: attestation,
        expectedChallenge: entry.challenge,
        expectedOrigin: expectedOrigins,
        expectedRPID: rpID,
        requireUserVerification: true,
      });
    } catch (error) {
      onRejected('webauthn_register_failed');
      return response.status(400).json({ error: 'registration could not be verified' });
    }
    if (!verification.verified) {
      onRejected('webauthn_register_failed');
      return response.status(400).json({ error: 'registration could not be verified' });
    }

    const { credential } = verification.registrationInfo;
    await pool.query(
      'INSERT INTO auth_users (id, username) VALUES ($1, $2) ON CONFLICT (username) DO NOTHING',
      [entry.userID, entry.username],
    );
    const { rows } = await pool.query('SELECT id FROM auth_users WHERE username = $1', [entry.username]);
    await pool.query(
      'INSERT INTO auth_credentials (id, user_id, public_key, counter, transports) VALUES ($1, $2, $3, $4, $5)',
      [credential.id, rows[0].id, Buffer.from(credential.publicKey), credential.counter, credential.transports ?? null],
    );

    onEvent('register_success');
    console.log(JSON.stringify({ event: 'webauthn_registered', username: entry.username, timestamp: new Date().toISOString() }));
    return response.status(201).json(issueSession(entry.username));
  });

  router.post('/auth/login/options', async (_request, response) => {
    const options = await generateAuthenticationOptions({ rpID, userVerification: 'required' });
    const challengeId = storeChallenge({ type: 'login', challenge: options.challenge });
    return response.json({ options, challengeId });
  });

  router.post('/auth/login/verify', async (request, response) => {
    const { challengeId, response: assertion } = request.body ?? {};
    const entry = takeChallenge(challengeId);
    const fail = (reason) => {
      onRejected(reason);
      return response.status(401).json({ error: 'authentication failed' });
    };
    if (!entry || entry.type !== 'login' || !assertion?.id) return fail('webauthn_challenge_invalid');

    const { rows } = await pool.query(
      `SELECT c.id, c.public_key, c.counter, c.transports, u.username
         FROM auth_credentials c JOIN auth_users u ON u.id = c.user_id
        WHERE c.id = $1`,
      [assertion.id],
    );
    const stored = rows[0];
    if (!stored) return fail('webauthn_unknown_credential');

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: assertion,
        expectedChallenge: entry.challenge,
        expectedOrigin: expectedOrigins,
        expectedRPID: rpID,
        requireUserVerification: true,
        credential: {
          id: stored.id,
          publicKey: new Uint8Array(stored.public_key),
          counter: Number(stored.counter),
          transports: stored.transports ?? undefined,
        },
      });
    } catch {
      return fail('webauthn_assertion_failed');
    }
    if (!verification.verified) return fail('webauthn_assertion_failed');

    await pool.query('UPDATE auth_credentials SET counter = $1 WHERE id = $2', [
      verification.authenticationInfo.newCounter,
      stored.id,
    ]);
    onEvent('login_success');
    console.log(JSON.stringify({ event: 'webauthn_login', username: stored.username, timestamp: new Date().toISOString() }));
    return response.json(issueSession(stored.username));
  });

  router.get('/auth/session', (request, response) => {
    const session = readSession(bearerToken(request));
    if (!session) return response.status(401).json({ error: 'authentication required' });
    return response.json({ username: session.sub, expiresAt: session.exp });
  });

  return { init, router, isAuthorized, isPublic };
}
