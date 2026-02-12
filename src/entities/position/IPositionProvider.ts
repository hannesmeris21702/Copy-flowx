import { Position } from "./Position";

export interface IPositionProvider {
  getPositionById(positionId: string): Promise<Position>;

  getLargestPosition(positionId: string, poolId: string): Promise<Position | null>;
}
