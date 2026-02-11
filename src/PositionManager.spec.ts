import { BN } from "bn.js";
import { Transaction } from "@mysten/sui/transactions";
import { BPS, Percent } from "./utils/sdkTypes";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

import { PositionManager } from "./PositionManager";
import { jsonRpcProvider } from "./utils/jsonRpcProvider";
import {
  AggregatorPriceProvider,
  FlowXV3PoolProvider,
  FlowXV3PositionProvider,
} from "./entities";
import { closestActiveRange } from "./utils/poolHelper";
import { getToken } from "./utils/tokenHelper";
import BigNumber from "bignumber.js";

const WHITE_LIST_POOLS = [
  "0x88cec280ed5406af7951ef768b305de5323b843cc127bcab988d08770d00a5f7",
];

const MIN_TVL_THRESHOLD = 100;

describe("#PositionManager", () => {
  const poolProvider = new FlowXV3PoolProvider();
  const priceProvider = new AggregatorPriceProvider();

  const manager = new PositionManager({
    slippageTolerance: new Percent(5000, BPS),
    priceImpactPercentThreshold: new Percent(-5000, BPS),
    minZapAmounts: {
      amountX: new BN(100),
      amountY: new BN(100),
    },
    trackingVolumeAddress: Ed25519Keypair.generate()
      .getPublicKey()
      .toSuiAddress(),
  });

  const getNewestPosition = async () => {
    let hasNextPage, cursor, validPosition;
    do {
      const res = await jsonRpcProvider.queryEvents({
        query: {
          MoveEventType:
            "0x25929e7f29e0a30eb4e692952ba1b5b65a3a4d65ab5f2a32e1ba3edcb587f26d::pool::ModifyLiquidity",
        },
        cursor,
        order: "descending",
      });
      cursor = res.nextCursor;
      hasNextPage = res.hasNextPage;

      const validEvent = res.data.find(
        (event) =>
          WHITE_LIST_POOLS.includes(event.parsedJson["pool_id"]) &&
          BigInt.asIntN(128, event.parsedJson["liquidity_delta"].bits) > 0n
      );

      if (!!validEvent) {
        const poolInfo = await poolProvider.getPoolById(
          validEvent.parsedJson["pool_id"]
        );

        const [tokenX, tokenY] = await Promise.all([
          getToken(poolInfo.coinX.coinType),
          getToken(poolInfo.coinY.coinType),
        ]);

        const [priceX, priceY] = await Promise.all([
          priceProvider.getPrice(tokenX.coinType),
          priceProvider.getPrice(tokenY.coinType),
        ]);

        const amountXInUSd = new BigNumber(
          validEvent.parsedJson["amount_x"].amountX
        )
          .div(10 ** tokenX.decimals)
          .multipliedBy(priceX);
        const amountYInUSd = new BigNumber(
          validEvent.parsedJson["amount_y"].amountY
        )
          .div(10 ** tokenY.decimals)
          .multipliedBy(priceY);
        const tvl = amountXInUSd.plus(amountYInUSd).toNumber();
        if (tvl >= MIN_TVL_THRESHOLD) {
          validPosition = validEvent.parsedJson["position_id"];
        }
      }
    } while (!validPosition && hasNextPage);

    // Fact: valid position is always exist
    return validPosition;
  };

  it("migrate work correctly", async () => {
    const newestPositionId = await getNewestPosition();
    const position = await new FlowXV3PositionProvider().getPositionById(
      newestPositionId
    );

    const tx = new Transaction();
    const [tickLower, tickUpper] = closestActiveRange(position.pool);

    await manager.migrate(
      position,
      tickLower - position.pool.tickSpacing,
      tickUpper + position.pool.tickSpacing
    )(tx);
    const res = await jsonRpcProvider.devInspectTransactionBlock({
      transactionBlock: tx,
      sender: position.owner,
    });
    expect(res.effects.status.status).toBe("success");
  }, 30000);

  it("compound work correctly", async () => {
    const newestPositionId = await getNewestPosition();
    const position = await new FlowXV3PositionProvider().getPositionById(
      newestPositionId
    );

    const tx = new Transaction();
    await manager.compound(position)(tx);
    const res = await jsonRpcProvider.devInspectTransactionBlock({
      transactionBlock: tx,
      sender: position.owner,
    });
    expect(res.effects.status.status).toBe("success");
  }, 10000);
});
