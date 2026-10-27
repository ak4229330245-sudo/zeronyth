# ZERONYTH frontend languages

The explorer and Web Node Lab support Japanese (`ja`), English (`en`),
Simplified Chinese (`zh-CN`) and Korean (`ko`). Their header selector saves
only the language preference in browser storage. The initial language follows
the browser when supported, otherwise English. If storage is unavailable,
selection still works for the current page.

## Updating copy

- Edit the matching keys in all four `dashboard/assets/i18n-*.mjs` catalogs.
- Keep interpolation names identical across languages.
- Static text and accessible attributes use the `data-i18n` and
  `data-i18n-attr` bindings. Page titles use the title key on the body.
- Dynamic UI messages use the shared i18n core. Technical error mappings live
  in `i18n-errors.mjs`; unknown backend or browser errors retain their original
  text rather than receiving an invented diagnosis.
- Security findings retain the engine's original detail alongside a localized
  explanation. Machine codes, addresses, chain IDs, transaction input and
  protocol messages are not translated.
- Render translations as text, never untrusted HTML. Keep scripts, fonts,
  images and styles local to respect the existing Content Security Policy.

## Safety boundaries

Changing language is presentation-only: preserve entered forms, wallet
identity, transaction-review state and opt-in consent. It must not request
wallet permissions, switch chains, sign, send, start a worker or join a room.
Normal independent read-only polling is unchanged.

Every language must retain the devnet/unaudited warnings, the distinction
between simulated points and real ZNYT, and disclosures that PQ research and
unimplemented features are not live-chain guarantees.

## Verification

The built-in Node test suite includes catalog/key parity, interpolation,
preference detection, storage failure and referenced-key coverage:

```sh
node --test services/zeronyth-l1/tests/*.test.mjs
```

For copy that moved out of HTML, assert both the markup binding and its catalog
content rather than removing the original safety assertion.

Browser verification should cycle all four languages on both pages and check
persisted selection, accessible labels, mobile overflow and state preservation.
Catalog parity does not establish professional linguistic or security review.

Static dashboard files are served without a rebuild or restart. Do not restart
the coupled web launcher to apply a translation: it owns the live validators.
