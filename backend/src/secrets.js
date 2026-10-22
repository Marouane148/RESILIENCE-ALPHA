// Chargement des secrets depuis HashiCorp Vault (moteur KV v2) avec un token applicatif en lecture seule.
// Sans VAULT_ADDR, les variables d'environnement sont utilisées telles quelles (développement local).

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function loadSecrets(env = process.env, { retries = 30, delayMs = 2000 } = {}) {
  const addr = env.VAULT_ADDR;
  if (!addr) {
    return {
      PAYMENT_API_TOKEN: env.PAYMENT_API_TOKEN,
      SESSION_SECRET: env.SESSION_SECRET,
      POSTGRES_PASSWORD: env.POSTGRES_PASSWORD,
      source: 'environment',
    };
  }

  const path = env.VAULT_SECRET_PATH || 'secret/data/resilience';
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(`${addr}/v1/${path}`, {
        headers: { 'X-Vault-Token': env.VAULT_TOKEN },
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) throw new Error(`vault responded ${response.status}`);
      const { data } = await response.json();
      return { ...data.data, source: 'vault' };
    } catch (error) {
      lastError = error;
      await sleep(delayMs);
    }
  }
  throw new Error(`vault unavailable: ${lastError?.message}`);
}
