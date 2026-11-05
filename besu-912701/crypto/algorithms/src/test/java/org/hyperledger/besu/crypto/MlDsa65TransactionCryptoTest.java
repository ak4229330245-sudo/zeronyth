package org.hyperledger.besu.crypto;

import static org.assertj.core.api.Assertions.assertThat;

import java.security.SecureRandom;
import org.hyperledger.besu.crypto.SecureRandomProvider;

import org.apache.tuweni.bytes.Bytes;
import org.bouncycastle.crypto.AsymmetricCipherKeyPair;
import org.bouncycastle.pqc.crypto.mldsa.MLDSAPrivateKeyParameters;
import org.bouncycastle.pqc.crypto.mldsa.MLDSAPublicKeyParameters;
import org.junit.jupiter.api.Test;

public class MlDsa65TransactionCryptoTest {

  @Test
  void keyGenSignVerifyAddress() {
    final SecureRandom random = SecureRandomProvider.publicSecureRandom();
    final AsymmetricCipherKeyPair kp = MlDsa65TransactionCrypto.generateKeyPair(random);
    final byte[] pub = MlDsa65TransactionCrypto.getPublicKeyBytes(kp);
    final MLDSAPublicKeyParameters pubParams = (MLDSAPublicKeyParameters) kp.getPublic();
    final MLDSAPrivateKeyParameters privParams = (MLDSAPrivateKeyParameters) kp.getPrivate();

    final Bytes message = Bytes.fromHexString("0x01020304");
    final byte[] sig = MlDsa65TransactionCrypto.sign(message.toArrayUnsafe(), privParams, random);

    assertThat(MlDsa65TransactionCrypto.verify(message.toArrayUnsafe(), sig, pubParams)).isTrue();

    // tamper
    final byte[] bad = sig.clone();
    bad[0] ^= 1;
    assertThat(MlDsa65TransactionCrypto.verify(message.toArrayUnsafe(), bad, pubParams)).isFalse();

    final Bytes address = MlDsa65TransactionCrypto.addressFromPublicKey(pub);
    assertThat(address.size()).isEqualTo(20);
  }

}
