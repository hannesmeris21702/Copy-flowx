import BigNumber from "bignumber.js";
import {
  Transaction,
  TransactionArgument,
  TransactionResult,
} from "@mysten/sui/transactions";
import { Coin as Token } from "@flowx-finance/sdk";

import { BigintIsh, FLOWX_AG_UNIVERSAL_ROUTER_PACKAGE_ID } from "../constants";
import { cache } from "./cache";
import { jsonRpcProvider } from "./jsonRpcProvider";
import { CACHE_CONFIG } from "../config/cache";

export const getToken = async (tokenId: string): Promise<Token> => {
  const cached = cache.get<Token>(tokenId);
  if (!!cached) {
    return cached;
  }

  const metadata = await jsonRpcProvider.getCoinMetadata({
    coinType: tokenId,
  });

  const token = new Token(
    tokenId,
    metadata.decimals,
    metadata.symbol,
    metadata.name
  );
  cache.set(tokenId, token, CACHE_CONFIG.TOKEN_METADATA_TTL);

  return token;
};

export const convertAmountToDecimalAmount = (
  amount: BigintIsh,
  decimals = 1
) => {
  return new BigNumber(amount.toString())
    .div(Math.pow(10, decimals))
    .toString();
};

export const refundTokensIfNecessary =
  (
    token: {
      objectCoin: TransactionArgument | TransactionResult;
      coinType: string;
    }[],
    receiver: string
  ) =>
  (tx: Transaction) => {
    token.forEach((coin) => {
      tx.moveCall({
        target: `${FLOWX_AG_UNIVERSAL_ROUTER_PACKAGE_ID}::utils::refund_if_necessary`,
        typeArguments: [coin.coinType],
        arguments: [coin.objectCoin, tx.pure.address(receiver)],
      });
    });
  };
