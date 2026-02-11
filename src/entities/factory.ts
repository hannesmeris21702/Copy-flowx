import { ClmmProtocol } from "../constants";
import { Protocol } from "../utils/sdkTypes";

import {
  FlowXV3PositionProvider,
  IPositionProvider,
  PositionManager,
  FlowXV3PositionManager,
} from "./position";

export const createPositionProvider = (
  protocol: ClmmProtocol
): IPositionProvider => {
  switch (protocol) {
    case Protocol.FLOWX_V3:
      return new FlowXV3PositionProvider();
  }
};

export const createPositionManager = (
  protocol: ClmmProtocol
): PositionManager => {
  switch (protocol) {
    case Protocol.FLOWX_V3:
      return new FlowXV3PositionManager();
  }
};

