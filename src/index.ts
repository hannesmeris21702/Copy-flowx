import { BPS, Percent } from "@flowx-finance/sdk";
import { Worker } from "./Worker";
import { removeTrailingZeros } from "./utils/stringUtils";
import { ClmmProtocol } from "./constants";

require("dotenv").config({});

const workerOptions = {
  protocol: process.env.PROTOCOL as ClmmProtocol,
  poolId: process.env.TARGET_POOL,
  bPricePercent: new Percent(Number(process.env.BPRICE_PERCENT), BPS),
  tPricePercent: new Percent(Number(process.env.TPRICE_PERCENT), BPS),
  slippageTolerance: new Percent(Number(process.env.SLIPPAGE_TOLERANCE), BPS),
  priceImpactPercentThreshold: new Percent(
    Number(process.env.PRICE_IMPACT_PERCENT_THRESHOLD),
    BPS
  ),
  minZapAmount: {
    amountX: Number(process.env.MIN_ZAP_AMOUNT_X),
    amountY: Number(process.env.MIN_ZAP_AMOUNT_Y),
  },
  multiplier: Number(process.env.MULTIPLIER ?? 1),
  rewardThresholdUsd: process.env.REWARD_THRESHOLD_USD
    ? Number(process.env.REWARD_THRESHOLD_USD)
    : undefined,
  compoundRewardsScheduleMs: Number(process.env.COMPOUND_REWARDS_SCHEDULE_MS),
  trackingVolumeAddress: process.env.TRACKING_VOLUME_ADDRESS,
};
const worker = new Worker(workerOptions, process.env.PRIVATE_KEY);

console.log(
  `Start rebalancing worker with config ${JSON.stringify({
    ...workerOptions,
    bPricePercent:
      removeTrailingZeros(
        workerOptions.bPricePercent.toFixed(4, {
          decimalSeparator: ".",
          groupSeparator: "",
        })
      ) + "%",
    tPricePercent:
      removeTrailingZeros(
        workerOptions.tPricePercent.toFixed(4, {
          decimalSeparator: ".",
          groupSeparator: "",
        })
      ) + "%",
    slippageTolerance:
      removeTrailingZeros(
        workerOptions.slippageTolerance.toFixed(2, {
          decimalSeparator: ".",
          groupSeparator: "",
        })
      ) + "%",
    priceImpactPercentThreshold:
      removeTrailingZeros(
        workerOptions.priceImpactPercentThreshold.toFixed(2, {
          decimalSeparator: ".",
          groupSeparator: "",
        })
      ) + "%",
  })} ...`
);
worker.start();
