export async function hashPin(pin: string): Promise<string> {
  const bytes = new TextEncoder().encode(`home-training-pin:${pin}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const validPin = (pin: string) => /^\d{4}$/.test(pin);
