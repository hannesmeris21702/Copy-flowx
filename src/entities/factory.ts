import { Protocol } from "@flowx-finance/sdk";
import { ClmmProtocol } from "../constants";

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

