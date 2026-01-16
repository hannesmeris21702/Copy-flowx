import { PriceRange } from './PriceRange';
import { Percent } from '@flowx-finance/sdk';
import BN from 'bn.js';

describe('PriceRange', () => {
  describe('constructor', () => {
    it('should create a valid PriceRange with correct price bounds', () => {
      const tickLower = -100;
      const tickUpper = 100;
      const bPricePercent = new Percent(1000, 10000); // 10%
      const tPricePercent = new Percent(3000, 10000); // 30%

      const priceRange = new PriceRange(tickLower, tickUpper, bPricePercent, tPricePercent);

      // Verify that all prices are BN instances
      expect(priceRange.priceLower).toBeInstanceOf(BN);
      expect(priceRange.priceUpper).toBeInstanceOf(BN);
      expect(priceRange.bPriceLower).toBeInstanceOf(BN);
      expect(priceRange.bPriceUpper).toBeInstanceOf(BN);
      expect(priceRange.tPriceLower).toBeInstanceOf(BN);
      expect(priceRange.tPriceUpper).toBeInstanceOf(BN);

      // Verify price ordering
      expect(priceRange.priceLower.lt(priceRange.priceUpper)).toBe(true);
      expect(priceRange.bPriceLower.lt(priceRange.bPriceUpper)).toBe(true);
      expect(priceRange.tPriceLower.lt(priceRange.tPriceUpper)).toBe(true);

      // Verify price bounds
      expect(priceRange.priceLower.lt(priceRange.bPriceLower)).toBe(true);
      expect(priceRange.bPriceLower.lt(priceRange.tPriceLower)).toBe(true);
      expect(priceRange.tPriceLower.lt(priceRange.tPriceUpper)).toBe(true);
      expect(priceRange.tPriceUpper.lt(priceRange.bPriceUpper)).toBe(true);
      expect(priceRange.bPriceUpper.lt(priceRange.priceUpper)).toBe(true);
    });

    it('should verify price differences match input percentages', () => {
      const tickLower = -100;
      const tickUpper = 100;
      const bPricePercent = new Percent(1000, 10000); // 10%
      const tPricePercent = new Percent(3000, 10000); // 30%

      const priceRange = new PriceRange(tickLower, tickUpper, bPricePercent, tPricePercent);
      
      // Calculate total price range
      const totalPriceDiff = priceRange.priceUpper.sub(priceRange.priceLower);
      
      // Calculate actual bPrice percentage (multiply by 10000 for bps)
      const bPriceDiff = priceRange.bPriceLower.sub(priceRange.priceLower);
      const actualBPricePercent = bPriceDiff.mul(new BN(10000)).div(totalPriceDiff);
      
      // Calculate actual tPrice percentage (multiply by 10000 for bps)
      const tPriceDiff = priceRange.tPriceLower.sub(priceRange.priceLower);
      const actualTPricePercent = tPriceDiff.mul(new BN(10000)).div(totalPriceDiff);
      
      // Compare with expected bps values, allowing for 0.1% relative error
      const relativeErrorB = Math.abs((actualBPricePercent.toNumber() - 1000) / 1000);
      const relativeErrorT = Math.abs((actualTPricePercent.toNumber() - 3000) / 3000);
      expect(relativeErrorB).toBeLessThanOrEqual(0.001); // 0.1% relative error
      expect(relativeErrorT).toBeLessThanOrEqual(0.001); // 0.1% relative error
    });

    it('should throw error when bPriceLower is not less than priceUpper', () => {
      const tickLower = -100;
      const tickUpper = 100;
      const bPricePercent = new Percent(10000, 10000); // 100%
      const tPricePercent = new Percent(1000, 10000); // 10%

      expect(() => {
        new PriceRange(tickLower, tickUpper, bPricePercent, tPricePercent);
      }).toThrow('invalid bPriceLower');
    });

    it('should throw error when bPriceUpper is not greater than bPriceLower', () => {
      const tickLower = -100;
      const tickUpper = 100;
      const bPricePercent = new Percent(6000, 10000); // 60%
      const tPricePercent = new Percent(7000, 10000); // 70%

      expect(() => {
        new PriceRange(tickLower, tickUpper, bPricePercent, tPricePercent);
      }).toThrow('invalid bPriceUpper');
    });

    it('should throw error when tPriceLower is not less than bPriceUpper', () => {
      const tickLower = -100;
      const tickUpper = 100;
      const bPricePercent = new Percent(2000, 10000); // 20%
      const tPricePercent = new Percent(8500, 10000); // 85%

      expect(() => {
        new PriceRange(tickLower, tickUpper, bPricePercent, tPricePercent);
      }).toThrow('invalid tPriceLower');
    });

    it('should throw error when tPriceUpper is not valid', () => {
      const tickLower = -100;
      const tickUpper = 100;
      const bPricePercent = new Percent(4000, 10000); // 40%
      const tPricePercent = new Percent(2000, 10000); // 20%

      expect(() => {
        new PriceRange(tickLower, tickUpper, bPricePercent, tPricePercent);
      }).toThrow('invalid tPriceUpper');
    });

    it('should handle edge case with very small price range', () => {
      const tickLower = 0;
      const tickUpper = 10;
      const bPricePercent = new Percent(100, 10000); // 1%
      const tPricePercent = new Percent(200, 10000); // 2%

      const priceRange = new PriceRange(tickLower, tickUpper, bPricePercent, tPricePercent);

      expect(priceRange.priceLower.lt(priceRange.priceUpper)).toBe(true);
      expect(priceRange.bPriceLower.lt(priceRange.bPriceUpper)).toBe(true);
      expect(priceRange.tPriceLower.lt(priceRange.tPriceUpper)).toBe(true);
    });
  });
}); 