import { i18n, LOCALES, NATIVE_NAMES } from './i18n.mjs';

export const ecoI18n = i18n;

export function setupEcosystemLanguage(root = document) {
  const select = root.getElementById?.('ecoLanguage') || root.querySelector?.('#ecoLanguage');
  if (!select) return;
  select.replaceChildren();
  for (const locale of LOCALES) {
    const option = document.createElement('option');
    option.value = locale;
    option.lang = locale;
    option.textContent = NATIVE_NAMES[locale];
    select.appendChild(option);
  }
  const apply = () => {
    document.documentElement.lang = ecoI18n.locale;
    select.value = ecoI18n.locale;
    for (const element of root.querySelectorAll('[data-eco-i18n]')) {
      element.textContent = ecoI18n.t(element.dataset.ecoI18n);
    }
    for (const element of root.querySelectorAll('[data-eco-i18n-attr]')) {
      for (const pair of element.dataset.ecoI18nAttr.split(';')) {
        const [attribute, key] = pair.split(':').map((part) => part.trim());
        if (attribute && key) element.setAttribute(attribute, ecoI18n.t(key));
      }
    }
  };
  select.addEventListener('change', () => ecoI18n.setLocale(select.value));
  ecoI18n.subscribe(apply);
  apply();
}
