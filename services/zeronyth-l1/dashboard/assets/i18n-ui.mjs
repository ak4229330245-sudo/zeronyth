// Static DOM localization + language switcher. Makes no network or wallet requests.
import { i18n, LOCALES, NATIVE_NAMES } from './i18n.mjs';

export function applyStatic(root = document) {
  document.documentElement.lang = i18n.locale;
  const titleKey = document.body?.dataset.titleKey;
  if (titleKey) document.title = i18n.t(titleKey);
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = i18n.t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of el.dataset.i18nAttr.split(';')) {
      const [attr, key] = pair.split(':').map((s) => s.trim());
      if (attr && key) el.setAttribute(attr, i18n.t(key));
    }
  }
}

const select = document.getElementById('languageSelect');
if (select) {
  select.replaceChildren();
  for (const locale of LOCALES) {
    const option = document.createElement('option');
    option.value = locale;
    option.lang = locale;
    option.textContent = NATIVE_NAMES[locale];
    select.appendChild(option);
  }
  select.value = i18n.locale;
  select.addEventListener('change', () => { i18n.setLocale(select.value); });
}
i18n.subscribe((locale) => { if (select) select.value = locale; applyStatic(); });
applyStatic();


// Extra: re-apply on language change and mark html
i18n.subscribe(() => {
  document.documentElement.lang = i18n.locale;
  document.documentElement.dataset.locale = i18n.locale;
});
