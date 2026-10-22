import crypto from 'node:crypto';
import express from 'express';
import { encodeCBOR } from '@levischuck/tiny-cbor';
import { createAuth } from '../src/auth.js';

export const origin = 'http://localhost:8080';
export const rpId = 'localhost';
export const labToken = 'lab-token';

// Base PostgreSQL minimale en mémoire, limitée aux requêtes du module d'authentification.
export function createFakePool() {
  const users = [];
  const credentials = [];
  return {
    async query(sql, params = []) {
      if (sql.includes('CREATE TABLE')) return { rows: [] };
      if (sql.includes('SELECT id FROM auth_users')) return { rows: users.filter((u) => u.username === params[0]).map((u) => ({ id: u.id })) };
      if (sql.includes('FROM auth_credentials WHERE user_id')) return { rows: credentials.filter((c) => c.user_id === params[0]) };
      if (sql.includes('INSERT INTO auth_users')) {
        if (!users.find((u) => u.username === params[1])) users.push({ id: params[0], username: params[1] });
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO auth_credentials')) {
        credentials.push({ id: params[0], user_id: params[1], public_key: params[2], counter: params[3], transports: params[4] });
        return { rows: [] };
      }
      if (sql.includes('JOIN auth_users')) {
        const credential = credentials.find((c) => c.id === params[0]);
        return { rows: credential ? [{ ...credential, username: users.find((u) => u.id === credential.user_id).username }] : [] };
      }
      if (sql.includes('UPDATE auth_credentials')) {
        credentials.find((c) => c.id === params[1]).counter = params[0];
        return { rows: [] };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
}

export async function startAuthServer() {
  const events = { rejected: [], accepted: [] };
  const auth = createAuth({
    pool: createFakePool(),
    apiToken: labToken,
    onRejected: (reason) => events.rejected.push(reason),
    onEvent: (event) => events.accepted.push(event),
  });
  await auth.init();

  const app = express();
  app.use(express.json());
  app.use((request, response, next) => (auth.isPublic(request) || auth.isAuthorized(request)
    ? next()
    : response.status(401).json({ error: 'authentication required' })));
  app.use(auth.router);
  app.get('/payments', (_request, response) => response.json([]));

  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://localhost:${server.address().port}`;

  async function call(path, body, token, method = 'POST') {
    const response = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: method === 'GET' ? undefined : JSON.stringify(body),
    });
    return { status: response.status, json: await response.json().catch(() => ({})) };
  }

  return { call, events, close: () => new Promise((resolve) => server.close(resolve)) };
}

// Authentificateur de plateforme simulé : clé ES256, vérification utilisateur, compteur contrôlable.
export function createVirtualAuthenticator() {
  const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest();
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const cose = new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]);
  const credentialId = crypto.randomBytes(32);
  const id = credentialId.toString('base64url');
  const clientData = (type, challenge) => Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));

  return {
    id,
    register(challenge) {
      const authData = Buffer.concat([
        sha(rpId), Buffer.from([0x45]), Buffer.from([0, 0, 0, 0]), Buffer.alloc(16),
        Buffer.from([0, credentialId.length]), credentialId, Buffer.from(encodeCBOR(cose)),
      ]);
      const attestation = Buffer.from(encodeCBOR(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]])));
      return {
        id,
        rawId: id,
        type: 'public-key',
        clientExtensionResults: {},
        response: {
          clientDataJSON: clientData('webauthn.create', challenge).toString('base64url'),
          attestationObject: attestation.toString('base64url'),
          transports: ['internal'],
        },
      };
    },
    assert(challenge, counter, flags = 0x05) {
      const authData = Buffer.concat([sha(rpId), Buffer.from([flags]), Buffer.from([0, 0, 0, counter])]);
      const data = clientData('webauthn.get', challenge);
      const signature = crypto.sign('sha256', Buffer.concat([authData, sha(data)]), privateKey);
      return {
        id,
        rawId: id,
        type: 'public-key',
        clientExtensionResults: {},
        response: {
          clientDataJSON: data.toString('base64url'),
          authenticatorData: authData.toString('base64url'),
          signature: signature.toString('base64url'),
        },
      };
    },
  };
}
