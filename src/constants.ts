import { Protocol } from "@flowx-finance/sdk";
import BN from "bn.js";

export type BigintIsh = BN | string | number;

export type ClmmProtocol =
  | Protocol.FLOWX_V3
  | Protocol.CETUS
  | Protocol.TURBOS_FIANCE
  | Protocol.BLUEFIN
  | Protocol.MAGMA_FINANCE;

export enum Rounding {
  ROUND_DOWN,
  ROUND_HALF_UP,
  ROUND_UP,
}

export const TICK_INDEX_BITS = 32;
export const LIQUIDITY_BITS = 128;
export const Q128 = new BN(2).pow(new BN(128));

export const REBALANCE_RETRIES = Number(process.env.REBALANCE_RETRIES ?? 1);

export const FLOWX_V3_CONFIG = {
  packageId:
    "0xde2c47eb0da8c74e4d0f6a220c41619681221b9c2590518095f0f0c2d3f3c772",
  poolRegistryObject:
    "0x27565d24a4cd51127ac90e4074a841bbe356cca7bf5759ddc14a975be1632abc",
  positionRegistryObject:
    "0x7dffe3229d675645564273aa68c67406b6a80aa29e245ac78283acd7ed5e4912",
  versionObject:
    "0x67624a1533b5aff5d0dfcf5e598684350efd38134d2d245f475524c03a64e656",
};

export const MAPPING_POSITION_OBJECT_TYPE: Record<
  ClmmProtocol,
  string | undefined
> = {
  [Protocol.FLOWX_V3]:
    "0x25929e7f29e0a30eb4e692952ba1b5b65a3a4d65ab5f2a32e1ba3edcb587f26d::position::Position",
  [Protocol.CETUS]: undefined,
  [Protocol.TURBOS_FIANCE]: undefined,
  [Protocol.BLUEFIN]: undefined,
  [Protocol.MAGMA_FINANCE]: undefined,
};

export const MAPPING_POOL_OBJECT_TYPE: Record<
  ClmmProtocol,
  string | undefined
> = {
  [Protocol.FLOWX_V3]:
    "0x25929e7f29e0a30eb4e692952ba1b5b65a3a4d65ab5f2a32e1ba3edcb587f26d::pool::Pool",
  [Protocol.CETUS]: undefined,
  [Protocol.TURBOS_FIANCE]: undefined,
  [Protocol.BLUEFIN]: undefined,
  [Protocol.MAGMA_FINANCE]: undefined,
};

export const FLOWX_AG_UNIVERSAL_ROUTER_PACKAGE_ID = "0xc263060d3cbb4155057f0010f92f63ca56d5121c298d01f7a33607342ec299b0";