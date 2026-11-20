// AI features (/api/ai/*, admin setup at /api/admin/ai). Everything is
// optional: with no provider, nothing here does anything.

import { useEffect, useState } from 'react';

import { api } from './api';

export type AiKind = 'anthropic' | 'openai' | 'local';
export type AiFeature = 'digest' | 'summaries' | 'ask';

export interface AiProvider {
  model: string;
  base_url: string;
  key_hint: string | null;
  configured: boolean;
}

export interface AiFeatureCfg {
  on: boolean;
  provider: AiKind;
  model: string;
  label: string;
}

export interface AiSettings {
  providers: Record<AiKind, AiProvider>;
  features: Record<AiFeature, AiFeatureCfg>;
  monthly_tokens: number;
  usage?: Record<string, { input: number; output: number; calls: number; features?: Record<string, number> }>;
}

export const getAiSettings = () => api<AiSettings>('/api/admin/ai');
export const putAiSettings = (body: {
  providers: Partial<Record<AiKind, { key?: string | null; model: string; base_url: string }>>;
  features: Partial<Record<AiFeature, { on: boolean; provider: AiKind; model: string }>>;
  monthly_tokens: number;
}) => api<AiSettings>('/api/admin/ai', { method: 'PUT', body });
export const testAi = (provider: AiKind) =>
  api<{ ok: boolean; error?: string; model?: string; reply?: string; seconds?: number }>('/api/admin/ai/test', {
    method: 'POST',
    body: { provider },
  });

export const getAiStatus = () => api<{ features: Record<AiFeature, boolean>; can_use: boolean }>('/api/ai/status');

export interface Digest {
  status: 'ok' | 'off' | 'none' | 'empty';
  sentences?: { text: string; cites: string[] }[];
  dropped?: number;
  model?: string;
  generated?: string;
  stale?: boolean;
}
export const getDigest = (refresh = false) => api<Digest>('/api/ai/digest' + (refresh ? '?refresh=1' : ''));

export const summarizeEvent = (id: string) =>
  api<{ summary: string; model: string }>('/api/ai/events/' + encodeURIComponent(id) + '/summary', {
    method: 'POST',
  });

export interface AskAnswer {
  answer: string;
  events: string[];
  view: { lat: number; lon: number; height_m: number; label: string } | null;
  tools: string[];
  model: string;
}
export const askArgus = (question: string, view: number[] | null) =>
  api<AskAnswer>('/api/ai/ask', { method: 'POST', body: { question, view } });

// Split text on [E:<id>] citations into text and event references.
export function withCitations(text: string): ({ text: string } | { event: string })[] {
  const out: ({ text: string } | { event: string })[] = [];
  let last = 0;
  for (const m of text.matchAll(/\[E:([A-Za-z0-9]{1,16})\]/g)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    out.push({ event: m[1] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

export const PROVIDER_LABEL: Record<AiKind, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI',
  local: 'Local / OpenAI-compatible',
};

// The AI status, shared by the pages that use it and re-read when it's a
// minute old or the AI settings were saved (else turning a feature on
// showed nothing until a reload).
let statusPromise: Promise<{ features: Record<AiFeature, boolean>; can_use: boolean }> | null = null;
let statusAt = 0;
const STATUS_MAX_AGE_MS = 60_000;
export function forgetAiStatus() {
  statusPromise = null;
}
export function useAiStatus() {
  const [s, setS] = useState<{ features: Record<AiFeature, boolean>; can_use: boolean } | null>(null);
  useEffect(() => {
    if (!statusPromise || Date.now() - statusAt > STATUS_MAX_AGE_MS) {
      statusAt = Date.now();
      statusPromise = getAiStatus().catch(() => ({
        features: { digest: false, summaries: false, ask: false },
        can_use: false,
      }));
    }
    let alive = true;
    void statusPromise.then((v) => alive && setS(v));
    return () => {
      alive = false;
    };
  }, []);
  return s;
}
