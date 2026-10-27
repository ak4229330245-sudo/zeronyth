// Dependency-free i18n core. Only the language preference is ever persisted.
import en from './i18n-en.mjs';
import ja from './i18n-ja.mjs';
import zhCN from './i18n-zh-CN.mjs';
import ko from './i18n-ko.mjs';
import { ECOSYSTEM_LABELS } from './ecosystem-labels.mjs';

export const LOCALES = Object.freeze(['ja', 'en', 'zh-CN', 'ko']);
export const DEFAULT_LOCALE = 'en';
export const STORAGE_KEY = 'zeronyth.language.v1';
export const NATIVE_NAMES = Object.freeze({ ja: '日本語', en: 'English', 'zh-CN': '简体中文', ko: '한국어' });
export const CATALOGS = Object.freeze({
  en: Object.freeze({ ...en, ...ECOSYSTEM_LABELS.en }),
  ja: Object.freeze({ ...ja, ...ECOSYSTEM_LABELS.ja }),
  'zh-CN': Object.freeze({ ...zhCN, ...ECOSYSTEM_LABELS['zh-CN'] }),
  ko: Object.freeze({ ...ko, ...ECOSYSTEM_LABELS.ko }),
});

export function normalizeLocale(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase().replace(/_/g, '-');
  if (v === 'ja' || v.startsWith('ja-')) return 'ja';
  if (v === 'en' || v.startsWith('en-')) return 'en';
  if (v === 'ko' || v.startsWith('ko-')) return 'ko';
  if (v === 'zh' || v.startsWith('zh-')) return 'zh-CN';
  return null;
}

export function detectLocale(languages) {
  const list = Array.isArray(languages) ? languages : [languages];
  for (const item of list) { const found = normalizeLocale(item); if (found) return found; }
  return null;
}

export function readPreference(getStorage) {
  try { return normalizeLocale(getStorage()?.getItem(STORAGE_KEY)); } catch { return null; }
}

export function writePreference(getStorage, locale) {
  try { getStorage().setItem(STORAGE_KEY, locale); return true; } catch { return false; }
}

export function interpolate(template, params = {}, resolve = (v) => v) {
  return String(template).replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(resolve(params[name])) : match);
}

export function createI18n({ catalogs = CATALOGS, getStorage = () => globalThis.localStorage, languages = globalThis.navigator?.languages } = {}) {
  let locale = readPreference(getStorage) ?? detectLocale(languages) ?? DEFAULT_LOCALE;
  const listeners = new Set();
  const bound = new Map(); // element -> { key, params }
  const lookup = (key, loc) => catalogs[loc]?.[key] ?? catalogs[DEFAULT_LOCALE]?.[key] ?? key;
  const resolveParam = (value) =>
    value && typeof value === 'object' && typeof value.key === 'string' ? api.t(value.key, value.params) : value;
  const api = {
    get locale() { return locale; },
    t(key, params) { return interpolate(lookup(key, locale), params, resolveParam); },
    setLocale(next) {
      const normalized = normalizeLocale(next);
      if (!normalized) return { ok: false, locale, persisted: false };
      locale = normalized;
      const persisted = writePreference(getStorage, normalized);
      api.refresh();
      for (const listener of [...listeners]) listener(locale);
      return { ok: true, locale, persisted };
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    // Bind plain text to a key so it follows language changes. Text nodes only, no markup parsing.
    setText(el, key, params) {
      if (!el) return;
      bound.set(el, { key, params });
      el.textContent = api.t(key, params);
    },
    setPlain(el, text) {
      if (!el) return;
      bound.delete(el);
      el.textContent = text;
    },
    clear(el) { if (el) { bound.delete(el); el.replaceChildren(); } },
    refresh() {
      for (const [el, d] of [...bound]) {
        if (el.isConnected === false) { bound.delete(el); continue; }
        el.textContent = api.t(d.key, d.params);
      }
    },
  };
  return api;
}

// The public site is Japanese-first: without a saved choice the UI starts in Japanese (browser language is not used).
// Visitors can switch with the language selector; the choice is stored. English stays the fallback for missing keys.
export const i18n = createI18n({ languages: ['ja'] });
export const t = (key, params) => i18n.t(key, params);
export const setText = (el, key, params) => i18n.setText(el, key, params);
export const setPlain = (el, text) => i18n.setPlain(el, text);
export const clearText = (el) => i18n.clear(el);
export const setLocale = (locale) => i18n.setLocale(locale);
export const subscribe = (fn) => i18n.subscribe(fn);
export const getLocale = () => i18n.locale;
