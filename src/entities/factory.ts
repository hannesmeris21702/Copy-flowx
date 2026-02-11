import { ClmmProtocol } from "../constants";
import { Protocol } from "../utils/sdkTypes";

import {
  IPositionProvider,
  PositionManager,
} from "./position";

export const createPositionProvider = (
  protocol: ClmmProtocol
): IPositionProvider => {
  switch (protocol) {
    case Protocol.CETUS:
      throw new Error("Cetus position provider not yet implemented");
    default:
      throw new Error(`Unsupported protocol: ${protocol}`);
  }
};

export const createPositionManager = (
  protocol: ClmmProtocol
): PositionManager => {
  switch (protocol) {
    case Protocol.CETUS:
      throw new Error("Cetus position manager not yet implemented");
    default:
      throw new Error(`Unsupported protocol: ${protocol}`);
  }
};

