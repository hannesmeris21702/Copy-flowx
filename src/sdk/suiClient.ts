/**
 * Sui Client SDK Wrapper
 * Provides configured SuiClient instance for blockchain interactions
 */

import { SuiClient } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";

/**
 * Get configured SuiClient instance
 * Uses RPC URL from environment with fallback
 */
export function getSuiClient(): SuiClient {
  const rpcUrl =
    process.env.JSON_RPC_ENDPOINT ||
    process.env.RPC_URL ||
    "https://fullnode.mainnet.sui.io:443";

  return new SuiClient({ url: rpcUrl });
}

/**
 * Create Ed25519 keypair from private key string
 * @param privateKey - Private key (with or without 0x prefix)
 */
export function createKeypair(privateKey: string): Ed25519Keypair {
  return Ed25519Keypair.fromSecretKey(
    decodeSuiPrivateKey(privateKey).secretKey
  );
}
