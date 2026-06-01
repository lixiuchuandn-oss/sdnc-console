export function maskMaasApiKey(raw: string): string {
  const apiKey = String(raw || '').trim();
  if (!apiKey) return '—';
  if (apiKey.length > 8) return `${apiKey.slice(0, 4)}***${apiKey.slice(-4)}`;
  return '***';
}

export function formatMaasDateTime(raw: unknown): string {
  if (!raw) return '—';
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) return String(raw);
  return d.toLocaleString();
}
