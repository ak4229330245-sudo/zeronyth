package org.hyperledger.besu.ethereum.core;

import java.nio.file.Files;
import java.nio.file.Path;

import org.apache.tuweni.bytes.Bytes;
import org.hyperledger.besu.crypto.Falcon1024TransactionCrypto;
import org.hyperledger.besu.crypto.MlDsa65TransactionCrypto;
import org.hyperledger.besu.datatypes.Address;
import org.hyperledger.besu.ethereum.core.encoding.FalconTransactionDecoder;
import org.hyperledger.besu.ethereum.core.encoding.MlDsaTransactionDecoder;

/**
 * Phase 2 harness: decode a raw PQ transaction (0x7E Falcon / 0x7F ML-DSA)
 * with the chain's own decoder, rebuild the signing digest with the chain's
 * own message builder, and verify the signature with the chain's own crypto
 * class. Generalized from the Phase 0 harness (Phase0Verify).
 *
 * <p>Usage: PqTxVerify &lt;file-containing-raw-tx-hex&gt;
 *
 * <p>Prints key=value lines; exits 2 when the signature does not verify.
 */
public class PqTxVerify {

  public static void main(final String[] args) throws Exception {
    if (args.length != 1) {
      throw new IllegalArgumentException("usage: PqTxVerify <rawtx-hex-file>");
    }
    final Bytes raw = Bytes.fromHexString(Files.readString(Path.of(args[0])).trim());
    final int type = raw.get(0) & 0xff;
    System.out.println("typeByte=0x" + String.format("%02x", type));

    final Transaction tx;
    final Bytes pub;
    final Bytes sig;
    final Bytes message;
    final boolean ok;
    final Address derived;
    if (type == 0x7e) {
      tx = FalconTransactionDecoder.decode(raw);
      pub = tx.getFalconPublicKey().orElseThrow();
      sig = tx.getFalconSignature().orElseThrow();
      message =
          Transaction.buildFalconSignableMessage(
              tx.getNonce(),
              tx.getGasPrice().orElseThrow(),
              tx.getGasLimit(),
              tx.getTo().map(a -> a.getBytes()).orElse(Bytes.EMPTY),
              tx.getValue(),
              tx.getPayload(),
              tx.getChainId().orElseThrow());
      final Bytes digest = org.hyperledger.besu.crypto.Hash.keccak256(message);
      System.out.println("digest=" + digest.toHexString());
      ok =
          Falcon1024TransactionCrypto.verify(
              digest.toArrayUnsafe(),
              sig.toArrayUnsafe(),
              Falcon1024TransactionCrypto.publicKeyFromBytes(pub.toArrayUnsafe()));
      derived = Address.wrap(Falcon1024TransactionCrypto.addressFromPublicKey(pub.toArrayUnsafe()));
    } else if (type == 0x7f) {
      tx = MlDsaTransactionDecoder.decode(raw);
      pub = tx.getMlDsaPublicKey().orElseThrow();
      sig = tx.getMlDsaSignature().orElseThrow();
      message =
          Transaction.buildMlDsaSignableMessage(
              tx.getNonce(),
              tx.getGasPrice().orElseThrow(),
              tx.getGasLimit(),
              tx.getTo().map(a -> a.getBytes()).orElse(Bytes.EMPTY),
              tx.getValue(),
              tx.getPayload(),
              tx.getChainId().orElseThrow());
      final Bytes digest = org.hyperledger.besu.crypto.Hash.keccak256(message);
      System.out.println("digest=" + digest.toHexString());
      ok =
          MlDsa65TransactionCrypto.verify(
              digest.toArrayUnsafe(),
              sig.toArrayUnsafe(),
              MlDsa65TransactionCrypto.publicKeyFromBytes(pub.toArrayUnsafe()));
      derived = Address.wrap(MlDsa65TransactionCrypto.addressFromPublicKey(pub.toArrayUnsafe()));
    } else {
      throw new IllegalArgumentException("not a PQ tx type byte: " + type);
    }

    System.out.println("scheme=" + (type == 0x7e ? "falcon" : "mldsa"));
    System.out.println("nonce=" + tx.getNonce());
    System.out.println("gasPrice=" + tx.getGasPrice().orElseThrow());
    System.out.println("gasLimit=" + tx.getGasLimit());
    System.out.println("to=" + tx.getTo().orElse(null));
    System.out.println("value=" + tx.getValue());
    System.out.println("chainId=" + tx.getChainId().orElseThrow());
    System.out.println("dataLength=" + tx.getPayload().size());
    System.out.println("pubLength=" + pub.size());
    System.out.println("sigLength=" + sig.size());
    System.out.println("javaVerify=" + ok);
    System.out.println("derivedAddress=" + derived);
    System.out.println("txSender=" + tx.getSender());
    System.out.println("senderMatchesDerived=" + tx.getSender().equals(derived));
    System.out.println("txHash=" + tx.getHash());
    if (!ok) {
      System.exit(2);
    }
  }
}
