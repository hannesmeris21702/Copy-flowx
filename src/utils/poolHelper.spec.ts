import BN from "bn.js";

import { ClmmTickMath } from "@flowx-finance/sdk";
import { closestActiveRange } from "./poolHelper";

describe("#poolHelper", () => {
  describe("#closestActiveRange", () => {
    const setupPool = (tickCurrent: number, sqrtPriceX64: BN) => ({
      tickSpacing: 60,
      tickCurrent,
      sqrtPriceX64: new BN(sqrtPriceX64),
    });

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("should return a range centered around tickCurrent when sqrtPrice equals converted price", () => {
      const pool: any = setupPool(
        3000,
        ClmmTickMath.tickIndexToSqrtPriceX64(3000)
      );

      const range = closestActiveRange(pool);
      expect(range).toEqual([3000, 3060]); // multiplier=1, spacing=60
    });

    it("should adjust lowerTick down if sqrtPrice < converted price and lowerTick === tickCurrent", () => {
      const pool: any = setupPool(
        3000,
        ClmmTickMath.tickIndexToSqrtPriceX64(3000).sub(new BN(1))
      );

      const range = closestActiveRange(pool);
      expect(range).toEqual([2940, 3000]); // adjusted lowerTick down
    });

    it("should not adjust lowerTick down if sqrtPrice < converted price but lowerTick !== tickCurrent", () => {
      const pool: any = setupPool(
        3010,
        ClmmTickMath.tickIndexToSqrtPriceX64(3010).sub(new BN(1))
      );

      const range = closestActiveRange(pool);
      expect(range).toEqual([3000, 3060]);
    });

    it("should work with multiplier = 2", () => {
      const pool: any = setupPool(
        3000,
        ClmmTickMath.tickIndexToSqrtPriceX64(3000)
      );

      const range = closestActiveRange(pool, 2);
      expect(range).toEqual([2940, 3060]);
    });

    it("should round candidateTickLower to nearest multiple of tickSpacing", () => {
      const pool: any = setupPool(
        3025,
        ClmmTickMath.tickIndexToSqrtPriceX64(3025)
      ); // halfRange = 30, candidate = 2995 → rounds to 3000

      const range = closestActiveRange(pool);
      expect(range).toEqual([3000, 3060]);
    });

    it("should return correct range when tickCurrent is negative and divisible by tickSpacing", () => {
      const pool: any = setupPool(
        -360,
        ClmmTickMath.tickIndexToSqrtPriceX64(-360)
      );

      // halfRange = 30, candidateTickLower = round((-390 / 60)) * 60 = -360
      const range = closestActiveRange(pool);
      expect(range).toEqual([-360, -300]);
    });

    it("should return correct range when tickCurrent is negative and NOT divisible by tickSpacing", () => {
      const pool: any = setupPool(
        -345,
        ClmmTickMath.tickIndexToSqrtPriceX64(-345)
      );

      // halfRange = 30, candidateTickLower = round(-375 / 60) * 60 = -360
      const range = closestActiveRange(pool);
      expect(range).toEqual([-360, -300]);
    });

    it("should adjust lowerTick down when tickCurrent is negative and equals lowerTick and sqrtPrice < converted", () => {
      const pool: any = setupPool(
        -360,
        ClmmTickMath.tickIndexToSqrtPriceX64(-360)
      );

      // candidateTickLower = -360, matches tickCurrent → adjust down by tickSpacing
      const range = closestActiveRange(pool);
      expect(range).toEqual([-360, -300]);
    });

    it("should return correct range when tickCurrent is small negative (e.g. -1)", () => {
      const pool: any = setupPool(-1, ClmmTickMath.tickIndexToSqrtPriceX64(-1));

      // halfRange = 30, candidate = round(-31 / 60) = -1 → * 60 = -60
      const range = closestActiveRange(pool);
      expect(range).toEqual([-60, 0]);
    });

    it("should return wider range with multiplier = 2 and negative tickCurrent", () => {
      const pool: any = setupPool(
        -300,
        ClmmTickMath.tickIndexToSqrtPriceX64(-300)
      );

      // multiplier = 2 → halfRange = 60, candidate = round(-360 / 60) = -6 → * 60 = -360
      const range = closestActiveRange(pool, 2);
      expect(range).toEqual([-360, -240]);
    });

    describe("#multipliers", () => {
      const testWithMultiplier = (
        tickCurrent: number,
        multiplier: number,
        expectedLower: number,
        description: string
      ) => {
        it(description, () => {
          const pool: any = setupPool(
            tickCurrent,
            ClmmTickMath.tickIndexToSqrtPriceX64(tickCurrent)
          ); // tickSpacing = 60

          const range = closestActiveRange(pool, multiplier);
          expect(range).toEqual([
            expectedLower,
            expectedLower + multiplier * pool.tickSpacing,
          ]);
        });
      };
      // For tickCurrent = 300, multiplier = 1:
      // halfRange = 30, so: 300 - 30 = 270, round(270 / 60) = round(4.5) = 5,
      // candidateTickLower = 5 * 60 = 300.
      testWithMultiplier(300, 1, 300, "multiplier = 1, tickCurrent = 300");

      // For tickCurrent = 305, multiplier = 1:
      // halfRange = 30, so: 305 - 30 = 275, round(275 / 60) ≈ round(4.5833) = 5,
      // candidateTickLower = 5 * 60 = 300.
      testWithMultiplier(
        305,
        1,
        300,
        "multiplier = 1, tickCurrent = 305 (rounded to 300)"
      );

      // For tickCurrent = 300, multiplier = 2:
      // halfRange = 60, so: 300 - 60 = 240, round(240 / 60) = 4,
      // candidateTickLower = 4 * 60 = 240.
      testWithMultiplier(300, 2, 240, "multiplier = 2, tickCurrent = 300");

      // For tickCurrent = 350, multiplier = 3:
      // halfRange = 90, so: 350 - 90 = 260, round(260 / 60) ≈ round(4.3333) = 4,
      // candidateTickLower = 4 * 60 = 240.
      testWithMultiplier(350, 3, 240, "multiplier = 3, tickCurrent = 350");

      // For tickCurrent = 350, multiplier = 4:
      // halfRange = 120, so: 350 - 120 = 230, round(230 / 60) ≈ round(3.8333) = 4,
      // candidateTickLower = 4 * 60 = 240.
      testWithMultiplier(350, 4, 240, "multiplier = 4, tickCurrent = 350");

      // For tickCurrent = 350, multiplier = 5:
      // halfRange = 150, so: 350 - 150 = 200, round(200 / 60) ≈ round(3.3333) = 3,
      // candidateTickLower = 3 * 60 = 180.
      testWithMultiplier(350, 5, 180, "multiplier = 5, tickCurrent = 350");

      // For tickCurrent = -60, multiplier = 1:
      // halfRange = 30, so: (-60 - 30) = -90, Math.round(-90 / 60) = Math.round(-1.5) = -1,
      // candidateTickLower = -1 * 60 = -60.
      testWithMultiplier(-60, 1, -60, "multiplier = 1, tickCurrent = -60");

      // For tickCurrent = -90, multiplier = 2:
      // halfRange = 60, so: (-90 - 60) = -150, Math.round(-150 / 60) = Math.round(-2.5) = -2,
      // candidateTickLower = -2 * 60 = -120.
      testWithMultiplier(-90, 2, -120, "multiplier = 2, tickCurrent = -90");

      // For tickCurrent = -275, multiplier = 3:
      // halfRange = 90, so: (-275 - 90) = -365, Math.round(-365 / 60) ≈ -6.083 rounds to -6,
      // candidateTickLower = -6 * 60 = -360.
      testWithMultiplier(-275, 3, -360, "multiplier = 3, tickCurrent = -275");

      // For tickCurrent = -1, multiplier = 1:
      // halfRange = 30, so: (-1 - 30) = -31, Math.round(-31 / 60) ≈ -0.5167 rounds to -1,
      // candidateTickLower = -1 * 60 = -60.
      testWithMultiplier(-1, 1, -60, "multiplier = 1, tickCurrent = -1");

      // For tickCurrent = -100, multiplier = 4:
      // halfRange = (4 * 60) / 2 = 120, so: (-100 - 120) = -220, Math.round(-220 / 60) ≈ -3.667 rounds to -4,
      // candidateTickLower = -4 * 60 = -240.
      testWithMultiplier(-100, 4, -240, "multiplier = 4, tickCurrent = -100");
    });
  });
});
