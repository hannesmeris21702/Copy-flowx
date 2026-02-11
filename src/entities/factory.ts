import { ClmmProtocol } from "../constants";
import { Protocol } from "../utils/sdkTypes";

import {
  IPositionProvider,
  PositionManager,
  CetusPositionProvider,
  CetusPositionManager,
} from "./position";

export const createPositionProvider = (
  protocol: ClmmProtocol
): IPositionProvider => {
  switch (protocol) {
    case Protocol.CETUS:
      return new CetusPositionProvider();
    default:
      throw new Error(`Unsupported protocol: ${protocol}`);
  }
};

export const createPositionManager = (
  protocol: ClmmProtocol
): PositionManager => {
  switch (protocol) {
    case Protocol.CETUS:
      return new CetusPositionManager();
    default:
      throw new Error(`Unsupported protocol: ${protocol}`);
  }
};

