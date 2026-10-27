// Safety filters shared by chat-server (redaction at write time) and the learner (what may become "learned memory").
// Everything here is deterministic regex logic: cheap, auditable, no model calls. Each check returns a short reason code.
export const redact = (s) => String(s)
  .replace(/\b(0x)?[0-9a-fA-F]{64}\b/g, '[redacted-key]')
  .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[redacted-email]')
  .replace(/(?:\+?81[-\s]?|0)\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4}\b/g, '[redacted-phone]')
  .replace(/\b(?:[a-z]{3,8}\s+){11,23}[a-z]{3,8}\b/g, '[redacted-mnemonic]');
export const looksSecret = (s) => /\b(0x)?[0-9a-fA-F]{64}\b/.test(s) || /\b(?:[a-z]{3,8}\s+){11,23}[a-z]{3,8}\b/.test(s)
  || /(?:password|パスワード|pass)\s*[:：=]\s*\S{6,}/i.test(s) || /\b(?:sk|pk|ghp|xox[bpa])[-_][A-Za-z0-9_-]{16,}\b/.test(s);
const N = (s) => String(s || '').normalize('NFKC');
const RULES = [
  // Prompt injection / attempts to re-program the assistant or smuggle chat-template tokens.
  ['prompt-injection', /(ignore|disregard|forget)\s+(all\s+|any\s+|the\s+)?(previous|prior|above|earlier)\s+(instructions|prompts?|rules)|(以前|前|上|これまで)の(指示|命令|ルール|設定)を(無視|忘れ)|システムプロンプト|system\s*prompt|jailbreak|\bDAN\b|developer\s*mode|開発者モード|あなたは今から|今からあなたは|<\|im_(start|end)\|>|\[\/?INST\]|^\s*(system|assistant)\s*:/im],
  // Abuse / toxicity (small, conservative list; Japanese + English).
  ['abuse', /死ね|氏ね|殺す|ころす|殺してやる|消えろ|ぶっ殺|クズ|ゴミ野郎|バカ野郎|きもい|キモい|ガイジ|fuck|shit|bitch|retard|kill\s+yourself|kys\b|nigg/i],
  // Financial advice / price talk (ZNYT is a valueless testnet coin).
  ['financial-advice', /(買う|買い|売る|投資す|仕込)べき|買い時|売り時|儲か|稼げ(る|ます)|値上が|値下が|爆上げ|上場(する|予定|します)|価格(予想|予測)|\d+\s*倍(に|になる)|必ず(儲|上が|増え)|元本保証|guaranteed\s+(profit|returns?)|to\s+the\s+moon|buy\s+now|price\s+(prediction|target)|financial\s+advice/i],
  // Anything that asks the user for keys / seed / password, or tells them to send funds.
  ['asks-for-secret', /(秘密鍵|シークレットキー|プライベートキー|シードフレーズ|復元フレーズ|ニーモニック|リカバリーフレーズ|パスワード|private\s*key|seed\s*phrase|mnemonic|recovery\s*phrase|password)\s*(を|は)?\s*(教えて|送って|送信して|入力して|貼って|共有して|伝えて|提出|ください|お知らせ|send|share|enter|paste|provide|give)(?!\s*(は|も)?\s*(いけ|だめ|ダメ|駄目|なら))/i],
  ['send-funds', /(この|下記|以下|次の)?アドレス(に|へ)\s*(ZNYT|ETH|USDT|BTC|お金|資金|トークン)?\s*を?\s*(送って|送金して|振り込)|send\s+(your\s+)?(funds|tokens|eth|znyt)\s+to/i],
  // Links: only our own domain may be learned.
  ['foreign-link', /https?:\/\/(?!zeronyth\.dpdns\.org)[^\s)）]+/i],
];
export function unsafeReasons(text) {
  const t = N(text); const out = [];
  if (looksSecret(t)) out.push('secret');
  // A clear refusal (「投資すべきではありません」「儲かりません」) is not advice; speculation (「かもしれません」) still is.
  const neg = t.replace(/(べき|儲か|値上が|値下が|稼げ|買い時|売り時)[^。\n！？!?]{0,10}?(ではありません|ではない|じゃない|りません|ません|ない|できません)/g, (m) => (/しれ|かも/.test(m) ? m : ''));
  for (const [code, re] of RULES) if (re.test(code === 'financial-advice' ? neg : t)) out.push(code);
  return out;
}
// Canonical ZERONYTH facts. A learned item that states a DIFFERENT value is rejected (contradiction = likely poisoning).
const FACTS = [
  ['chain-id', /(チェーン\s*ID|chain\s*id|chainid)\D{0,12}(\d{1,7})/gi, (m) => m[2] === '9127' || m[2] === '0'],
  ['ai-plan-price', /AI\s*プラン\D{0,10}?(\d+(?:\.\d+)?)\s*ZNYT/gi, (m) => m[1] === '5'],
  ['vps-plan-price', /VPS\s*プラン\D{0,10}?(\d+(?:\.\d+)?)\s*ZNYT/gi, (m) => m[1] === '100'],
  ['plan-days', /プラン\D{0,20}?(\d+)\s*日間/g, (m) => m[1] === '10'],
  ['burn', /(\d+)\s*[%％]\s*(は|が|を)?\s*(燃や|バーン|burn)/gi, (m) => m[1] === '20'],
  ['supply', /総発行量\D{0,8}?([\d,]+)\s*(万|億)?/g, (m) => (m[2] === '億' && m[1] === '1') || m[1].replace(/,/g, '') === '100000000' || (m[2] === '万' && m[1].replace(/,/g, '') === '10000')],
  ['validators', /バリデーター[^。\n]{0,8}?(\d+)\s*台/g, (m) => m[1] === '4'],
  // Gas is 1 gwei (baseFee 0); "gas is 0 / free" is wrong.
  ['gas-zero', /ガス(代|価格|料金)?\s*(は|が)?\s*(0|０|ゼロ|無料)(?![.\d])/g, () => false],
  ['rpc-url', /RPC[^。\n]{0,20}?(https?:\/\/[^\s）)」]+)/gi, (m) => /^https:\/\/zeronyth\.dpdns\.org\/rpc\/?$/.test(m[1])],
  // Points: only how to earn them and the rules. Nothing about what they will turn into.
  ['no-airdrop', /エアドロップ|エアドロ|airdrop/gi, () => false],
];
const VALUE_CLAIM = /ZNYT[^。\n]{0,20}(価値が(ある|あります)|換金(できる|できます|可能)|売買(できる|できます)|円(になる|に換え))/;
const PLAN_DIRECT = /(プラン|代金)[^。\n]{0,30}(すぐ|そのまま|直接)[^。\n]{0,10}(プロバイダー|提供者)[^。\n]{0,6}(に)?(渡|支払われ|届)(る|ります|きます)/;
const PLAN_DIRECT_NEG = /(すぐ|そのまま|直接)[^。\n]{0,20}(渡|支払われ|届)(らない|りません|きません|されません)/;
export function factViolations(text) {
  const t = N(text); const out = [];
  for (const [code, re, ok] of FACTS) for (const m of t.matchAll(re)) if (!ok(m)) { out.push(code); break; }
  if (VALUE_CLAIM.test(t) && !/(ありません|ない|できません)/.test(t.match(VALUE_CLAIM)[0])) out.push('znyt-value');
  if (PLAN_DIRECT.test(t) && !PLAN_DIRECT_NEG.test(t)) out.push('plan-escrow');
  return out;
}
const DONT_KNOW = /わかりません|分かりません|わからない|資料に(は)?(ない|ありません|見当たりません)|情報がありません|答えられません|お答えできません|I\s+don'?t\s+know/i;
export const saysDontKnow = (s) => DONT_KNOW.test(N(s));
// Minimum quality for a Q/A pair to be considered at all.
export function qualityReasons(q, a) {
  const out = []; const qq = N(q).trim(), aa = N(a).trim();
  if (qq.length < 4) out.push('question-too-short'); if (qq.length > 300) out.push('question-too-long');
  if (aa.length < 20) out.push('answer-too-short'); if (aa.length > 1500) out.push('answer-too-long');
  if (saysDontKnow(aa)) out.push('answer-is-dont-know');
  if (/\[redacted-/.test(qq + aa)) out.push('contained-personal-data');
  if (/(.{6,}?)\1{3,}/s.test(aa)) out.push('repetitive');
  return out;
}
