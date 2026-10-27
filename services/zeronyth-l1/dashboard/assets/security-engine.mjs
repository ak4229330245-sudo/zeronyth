// ZERONYTH Security Lab: local, read-only, structured transaction previews.
// This is deliberately NOT a validator, wallet firewall, or blockchain simulator.
const EVM_ADDRESS = /^0x[\da-fA-F]{40}$/;
const HEX = /^0x(?:[\da-fA-F]{2})*$/;
const SOL_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_UINT256 = (1n << 256n) - 1n;

const severityRank = { info: 0, caution: 1, high: 2, critical: 3 };

function add(out, severity, code, message) {
  out.findings.push({ severity, code, message });
}

function hexWord(data, index) {
  return data.slice(10 + index * 64, 74 + index * 64);
}

function addressWord(word) {
  if (!word || word.length !== 64 || !/^0{24}[\da-fA-F]{40}$/.test(word)) return null;
  return `0x${word.slice(24)}`;
}

function validAddress(network, address) {
  if (network === 'SOL') return SOL_ADDRESS.test(address);
  if (network === 'BTC') return typeof address === 'string' && /^(?:bc1|tb1|bcrt1|[13mn2])[a-zA-Z0-9]{14,87}$/.test(address);
  return EVM_ADDRESS.test(address);
}

function sameAddress(network, a, b) {
  return network === 'EVM' || network === 'BNB' || network === 'ZNYT'
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
}

function intendedRecipient(out, network, address, expected) {
  if (!expected) return;
  if (!address) {
    add(out, 'caution', 'DESTINATION_UNVERIFIED', 'Could not determine the real asset recipient.');
  } else if (!sameAddress(network, address, expected)) {
    add(out, 'critical', 'DESTINATION_MISMATCH', `Recipient differs from your independently verified address: ${address}`);
  }
}

function requireField(out, condition, message) {
  if (!condition) {
    out.complete = false;
    add(out, 'caution', 'INCOMPLETE_PREVIEW', message);
  }
  return condition;
}

// Safe EIP-712 messages are *not* ordinary EVM transactions. Their operation
// (CALL vs DELEGATECALL) must be inspected before any human approves a signature.
function safeTx(out, payload, expected, expectedSafe) {
  const envelope = payload.typedData;
  const tx = payload.safeTx ?? envelope?.message;
  if (!tx || typeof tx !== 'object' || Array.isArray(tx)) throw Error('SafeTx message object is required.');
  if (!EVM_ADDRESS.test(tx.to)) throw Error('Invalid SafeTx target address.');
  const operation = parseUnsigned(tx.operation, 'SafeTx operation');
  const value = parseUnsigned(tx.value, 'SafeTx native value');
  const data = tx.data ?? '0x';
  if (typeof data !== 'string' || !HEX.test(data)) throw Error('Invalid SafeTx calldata.');
  if (tx.nonce === undefined) requireField(out, false, 'SafeTx nonce is missing from preview.');
  else parseUnsigned(tx.nonce, 'SafeTx nonce');

  const domain = envelope?.domain;
  if (domain?.chainId === undefined || !EVM_ADDRESS.test(domain?.verifyingContract)) {
    requireField(out, false, 'Verified EIP-712 domain (chainId and verifyingContract) is missing.');
  } else {
    const chainId = parseUnsigned(domain.chainId, 'SafeTx domain chainId');
    if ((out.network === 'BNB' && chainId !== 56n) || (out.network === 'ZNYT' && chainId !== 9127n)) {
      add(out, 'high', 'SAFE_CHAIN_MISMATCH', `SafeTx signs for unexpected chain ${chainId}.`);
    }
    if (expectedSafe) {
      if (!EVM_ADDRESS.test(expectedSafe)) throw Error('Invalid expected Safe address.');
      if (!sameAddress(out.network, domain.verifyingContract, expectedSafe)) {
        add(out, 'critical', 'SAFE_DOMAIN_MISMATCH', 'EIP-712 verifyingContract differs from independently confirmed Safe wallet.');
      }
    } else requireField(out, false, 'Expected Safe wallet address is absent; domain is not independently confirmed.');
  }

  intendedRecipient(out, out.network, tx.to, expected);
  if (operation === 1n) {
    add(out, 'critical', 'SAFE_DELEGATECALL', `SafeTx uses DELEGATECALL to ${tx.to}. This can execute target code with Safe wallet storage permissions.`);
  } else if (operation !== 0n) {
    add(out, 'critical', 'SAFE_UNKNOWN_OPERATION', `Unknown Safe operation: ${operation}.`);
    out.complete = false;
  } else add(out, 'info', 'SAFE_CALL', `SafeTx CALL target: ${tx.to}.`);

  if (data !== '0x') {
    add(out, 'high', 'SAFE_NESTED_CALL_UNVERIFIED', `SafeTx carries contract calldata (${data.slice(0, 10)}); target behaviour must be simulated and contract code independently verified.`);
    out.complete = false;
  }
  if (value > 0n) add(out, 'info', 'SAFE_VALUE', `SafeTx native value: ${value} base units.`);
  if (envelope && (envelope.primaryType !== 'SafeTx' || !envelope.types?.SafeTx)) {
    requireField(out, false, 'SafeTx EIP-712 primary type or field schema was not provided.');
  }
  // The preview cannot establish that these exact bytes will be presented to the wallet.
  add(out, 'caution', 'SIGNATURE_BYTES_UNVERIFIED', 'Compare the canonical EIP-712 hash on an independently trusted signing device; website JSON can be deceptive.');
}

function evm(out, data, expected) {
  if (data.safeTx || data.typedData?.primaryType === 'SafeTx') {
    safeTx(out, data, expected, data.expectedSafe);
    return;
  }
  if (data.typedData) {
    add(out, 'high', 'TYPED_SIGNATURE_UNCHECKED', 'Typed signature payload is not decoded or validated. Check EIP-712 domain, spender, deadline and permissions with your wallet.');
    out.complete = false;
    if (!data.transaction) return;
  }
  const tx = data.transaction ?? data;
  if (!tx || typeof tx !== 'object' || Array.isArray(tx)) throw Error('A transaction object is required.');
  const to = tx.to;
  if (to != null && !EVM_ADDRESS.test(to)) throw Error('Invalid EVM destination address.');
  const input = tx.data ?? tx.input ?? '0x';
  if (typeof input !== 'string' || !HEX.test(input)) throw Error('EVM data must be even-length 0x hex.');
  if (input.length > 2 && input.length < 10) throw Error('EVM data has an incomplete function selector.');
  if (tx.chainId !== undefined) {
    const chain = Number(tx.chainId);
    if (!Number.isSafeInteger(chain) || chain <= 0) throw Error('Invalid EVM chain ID.');
    if ((out.network === 'BNB' && chain !== 56) || (out.network === 'ZNYT' && chain !== 9127)) {
      add(out, 'high', 'CHAIN_MISMATCH', `Unexpected chain ID ${chain} for ${out.network}.`);
    }
  } else requireField(out, false, 'Chain ID is missing; replay/network context was not checked.');

  if (tx.value == null) requireField(out, false, 'Native asset value was not provided.');
  else {
    const value = parseUnsigned(tx.value, 'native value');
    if (value > 0n) add(out, 'info', 'NATIVE_VALUE', `Native value attached (base units): ${value}`);
  }

  if (!to) {
    add(out, 'high', 'CONTRACT_DEPLOYMENT', 'Transaction has no destination: contract creation or malformed request.');
    out.complete = false;
    return;
  }

  if (input === '0x') {
    add(out, 'info', 'NATIVE_TRANSFER', 'Simple native-asset transfer with empty calldata.');
    intendedRecipient(out, out.network, to, expected);
    return;
  }

  const selector = input.slice(0, 10).toLowerCase();
  const words = (input.length - 10) / 64;
  const argumentCount = { '0x095ea7b3': 2, '0xa22cb465': 2, '0xa9059cbb': 2, '0x23b872dd': 3 };
  const need = argumentCount[selector];
  if (!need || !Number.isInteger(words) || words < need || input.length !== 10 + need * 64) {
    add(out, 'caution', 'UNKNOWN_CALL', `Calldata ${selector} is not fully decoded. An ABI and simulation are required.`);
    out.complete = false;
    intendedRecipient(out, out.network, null, expected);
    return;
  }
  const args = Array.from({ length: need }, (_, i) => hexWord(input, i));
  if (selector === '0x095ea7b3') {
    const spender = addressWord(args[0]);
    if (!spender) throw Error('Malformed ERC20/BEP20 approve spender.');
    const amount = BigInt(`0x${args[1]}`);
    add(out, amount === MAX_UINT256 || amount >= (1n << 255n) ? 'critical' : 'high',
      'TOKEN_APPROVAL', `Token approval grants spender ${spender} up to ${amount} units; token identity and spender reputation are not verified.`);
    intendedRecipient(out, out.network, null, expected);
  } else if (selector === '0xa22cb465') {
    const operator = addressWord(args[0]);
    if (!operator) throw Error('Malformed NFT operator.');
    const approved = BigInt(`0x${args[1]}`);
    if (approved !== 0n && approved !== 1n) throw Error('Invalid boolean operator approval.');
    add(out, approved === 1n ? 'critical' : 'info', 'NFT_OPERATOR',
      approved === 1n ? `Operator ${operator} can manage all NFTs in this collection.` : 'NFT operator approval is being removed.');
  } else {
    const recipient = addressWord(args[selector === '0xa9059cbb' ? 0 : 1]);
    if (!recipient) throw Error('Malformed token recipient.');
    add(out, 'info', 'TOKEN_TRANSFER', `Token transfer recipient decoded: ${recipient}. Token contract and balance effects are not verified.`);
    intendedRecipient(out, out.network, recipient, expected);
  }

}

function sol(out, data, expected) {
  const instructions = data.instructions ?? data.transaction?.instructions;
  if (!Array.isArray(instructions) || !instructions.length) throw Error('Parsed Solana instructions[] are required.');
  if (typeof data.recentBlockhash !== 'string' && typeof data.transaction?.recentBlockhash !== 'string') {
    requireField(out, false, 'Recent blockhash is missing from preview.');
  }
  for (const [index, instruction] of instructions.entries()) {
    if (!instruction || typeof instruction !== 'object') throw Error(`Invalid instruction ${index}.`);
    const program = instruction.program;
    const parsed = instruction.parsed;
    const type = typeof parsed?.type === 'string' ? parsed.type.toLowerCase() : '';
    const info = parsed?.info ?? {};
    const isToken = program === 'spl-token' || program === 'spl-token-2022';
    const isSystem = program === 'system';
    if ((!isToken && !isSystem) || !type) {
      add(out, 'caution', 'UNDECODED_SOL_INSTRUCTION', `Instruction ${index} (${program || 'unknown program'}) is not trusted or decoded.`);
      out.complete = false;
      continue;
    }
    if (type === 'setauthority' && isToken) {
      add(out, 'critical', 'SOL_AUTHORITY_CHANGE', `Instruction ${index} changes token/account authority.`);
    } else if (type === 'approve' || type === 'approvechecked') {
      if (!isToken) { out.complete = false; add(out, 'caution', 'UNDECODED_SOL_INSTRUCTION', `Unexpected approval in instruction ${index}.`); continue; }
      add(out, 'high', 'SOL_DELEGATE', `Instruction ${index} grants a token delegate: ${String(info.delegate || 'unknown')}.`);
    } else if (type === 'transfer' || type === 'transferchecked' || type === 'transferwithseed') {
      const destination = info.destination;
      requireField(out, typeof destination === 'string' && validAddress('SOL', destination), `Instruction ${index} has no valid decoded destination.`);
      intendedRecipient(out, 'SOL', validAddress('SOL', destination) ? destination : null, expected);
      add(out, 'info', 'SOL_TRANSFER', `Instruction ${index} transfers assets to ${destination || 'unknown'}.`);
    } else if (type === 'revoke' && isToken) {
      add(out, 'info', 'SOL_REVOKE', `Instruction ${index} revokes a token delegate.`);
    } else {
      add(out, 'caution', 'UNDECODED_SOL_INSTRUCTION', `Instruction ${index} (${type}) needs full semantic analysis.`);
      out.complete = false;
    }
  }
}

function parseUnsigned(value, field) {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') throw Error(`${field} must be a non-negative integer.`);
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw Error(`${field} exceeds safe JavaScript number precision; use a string.`);
  let n;
  try { n = BigInt(value); } catch { throw Error(`${field} must be an integer.`); }
  if (n < 0n) throw Error(`${field} must not be negative.`);
  return n;
}

function btc(out, data, expected) {
  const psbt = data.psbt ?? data;
  if (!Array.isArray(psbt.outputs) || !psbt.outputs.length) throw Error('Decoded PSBT outputs[] are required.');
  if (!Array.isArray(psbt.inputs) || !psbt.inputs.length) {
    requireField(out, false, 'Decoded PSBT inputs[] missing; fees cannot be verified.');
  }
  let outputTotal = 0n;
  let knownRecipient = false;
  for (const [index, output] of psbt.outputs.entries()) {
    const amount = parseUnsigned(output.amountSat, `output ${index} amountSat`);
    outputTotal += amount;
    if (!validAddress('BTC', output.address)) {
      requireField(out, false, `Output ${index} address is missing or unrecognized. Script output requires decoding.`);
    }
    if (expected && output.address === expected) knownRecipient = true;
    if (expected && output.address && output.address !== expected) {
      if (psbt.changeAddress && output.address === psbt.changeAddress) {
        add(out, 'info', 'BTC_CHANGE', `Output ${index} is labelled change; wallet ownership has not been verified.`);
      } else {
        add(out, 'high', 'BTC_EXTRA_OUTPUT', `Output ${index} sends ${amount} sat to another address: ${output.address}.`);
      }
    }
  }
  if (expected && !knownRecipient) add(out, 'critical', 'DESTINATION_MISMATCH', 'Expected BTC recipient was not found in transaction outputs.');
  if (psbt.inputs?.length) {
    let inputTotal = 0n;
    let hasMissing = false;
    for (const [index, input] of psbt.inputs.entries()) {
      if (input.amountSat === undefined) { hasMissing = true; requireField(out, false, `Input ${index} amount missing; total fee unknown.`); }
      else inputTotal += parseUnsigned(input.amountSat, `input ${index} amountSat`);
    }
    if (!hasMissing) {
      if (inputTotal < outputTotal) throw Error('Outputs exceed inputs; invalid decoded PSBT totals.');
      if (inputTotal === 0n) throw Error('PSBT input total cannot be zero.');
      const fee = inputTotal - outputTotal;
      add(out, fee * 100n > inputTotal * 10n ? 'high' : fee * 100n > inputTotal * 2n ? 'caution' : 'info',
        'BTC_FEE', `Calculated miner fee: ${fee} sat (${(fee * 10000n / inputTotal).toString()} basis points of inputs).`);
    }
  }
  requireField(out, Boolean(psbt.changeAddress), 'Change-output wallet ownership cannot be verified without wallet context.');
}

export function analyzeSecurityRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw Error('Request must be a JSON object.');
  const network = String(request.network ?? '').toUpperCase();
  if (!['EVM', 'BNB', 'ZNYT', 'SOL', 'BTC'].includes(network)) throw Error('Supported networks: EVM, BNB, ZNYT, SOL, BTC.');
  const expected = request.expectedRecipient;
  if (expected != null && (!validAddress(network, expected) || typeof expected !== 'string')) throw Error('Expected recipient address format is invalid.');
  const out = { network, complete: true, findings: [] };
  if (network === 'SOL') sol(out, request, expected);
  else if (network === 'BTC') btc(out, request, expected);
  else evm(out, request, expected);
  if (!expected) requireField(out, false, 'No independently verified expected recipient was supplied.');
  if (!out.findings.length) add(out, 'info', 'NO_KNOWN_FINDINGS', 'No known risk detected in supplied decoded fields.');
  const highest = out.findings.reduce((max, finding) => Math.max(max, severityRank[finding.severity]), 0);
  out.risk = highest >= 3 ? 'CRITICAL' : highest === 2 ? 'HIGH' : 'REVIEW';
  out.decision = 'MANUAL_REVIEW_REQUIRED';
  out.disclaimer = 'Read-only preview. No RPC simulation, ownership/reputation checks, wallet signing interception, or post-quantum protection. Never treat this as approval to sign.';
  return out;
}
