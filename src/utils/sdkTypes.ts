/**
 * Utility types and classes to replace @flowx-finance/sdk dependencies
 * This file provides equivalents for commonly used SDK types
 */

import BN from "bn.js";

// Constants
export const BPS = new BN(10000); // Basis points (10,000 = 100%)
export const ONE = new BN(1);
export const ZERO = new BN(0);
export const MaxUint64 = "18446744073709551615";

// Protocol enum - now only supporting Cetus
export enum Protocol {
  CETUS = "CETUS",
}

/**
 * Percent class for handling percentage calculations
 * Replaces @flowx-finance/sdk Percent
 */
export class Percent {
  public readonly numerator: BN;
  public readonly denominator: BN;

  constructor(numerator: BN | number | string, denominator: BN | number | string = BPS) {
    this.numerator = new BN(numerator.toString());
    this.denominator = new BN(denominator.toString());
  }

  /**
   * Add another percent
   */
  add(other: Percent): Percent {
    const numerator = this.numerator
      .mul(other.denominator)
      .add(other.numerator.mul(this.denominator));
    const denominator = this.denominator.mul(other.denominator);
    return new Percent(numerator, denominator);
  }

  /**
   * Subtract another percent
   */
  subtract(other: Percent): Percent {
    const numerator = this.numerator
      .mul(other.denominator)
      .sub(other.numerator.mul(this.denominator));
    const denominator = this.denominator.mul(other.denominator);
    return new Percent(numerator, denominator);
  }

  /**
   * Multiply with a BN value
   */
  multiply(value: BN): Fraction {
    return new Fraction(this.numerator.mul(value), this.denominator);
  }

  /**
   * Greater than comparison
   */
  gt(other: Percent): boolean {
    const left = this.numerator.mul(other.denominator);
    const right = other.numerator.mul(this.denominator);
    return left.gt(right);
  }

  /**
   * Less than comparison
   */
  lt(other: Percent): boolean {
    const left = this.numerator.mul(other.denominator);
    const right = other.numerator.mul(this.denominator);
    return left.lt(right);
  }

  /**
   * Convert to fixed decimal string
   */
  toFixed(
    decimalPlaces: number,
    format?: {
      decimalSeparator?: string;
      groupSeparator?: string;
    }
  ): string {
    const value = this.numerator
      .mul(new BN(10).pow(new BN(decimalPlaces + 2)))
      .div(this.denominator);
    const str = value.toString();
    const intPart = str.slice(0, -decimalPlaces) || "0";
    const decPart = str.slice(-decimalPlaces).padStart(decimalPlaces, "0");
    return `${intPart}.${decPart}`;
  }

  /**
   * Get as fraction
   */
  get asFraction(): Fraction {
    return new Fraction(this.numerator, this.denominator);
  }
}

/**
 * Fraction class for rational number calculations
 */
export class Fraction {
  public readonly numerator: BN;
  public readonly denominator: BN;

  constructor(numerator: BN | number | string, denominator: BN | number | string = ONE) {
    this.numerator = new BN(numerator.toString());
    this.denominator = new BN(denominator.toString());
  }

  /**
   * Convert to fixed decimal string
   */
  toFixed(decimalPlaces: number = 18): string {
    const value = this.numerator
      .mul(new BN(10).pow(new BN(decimalPlaces)))
      .div(this.denominator);
    const str = value.toString();
    if (str.length <= decimalPlaces) {
      return "0." + str.padStart(decimalPlaces, "0");
    }
    const intPart = str.slice(0, -decimalPlaces);
    const decPart = str.slice(-decimalPlaces);
    return `${intPart}.${decPart}`;
  }

  /**
   * Multiply with another fraction
   */
  multiply(other: Fraction): Fraction {
    return new Fraction(
      this.numerator.mul(other.numerator),
      this.denominator.mul(other.denominator)
    );
  }

  /**
   * Add another fraction
   */
  add(other: Fraction): Fraction {
    const numerator = this.numerator
      .mul(other.denominator)
      .add(other.numerator.mul(this.denominator));
    const denominator = this.denominator.mul(other.denominator);
    return new Fraction(numerator, denominator);
  }

  /**
   * Subtract another fraction
   */
  subtract(other: Fraction): Fraction {
    const numerator = this.numerator
      .mul(other.denominator)
      .sub(other.numerator.mul(this.denominator));
    const denominator = this.denominator.mul(other.denominator);
    return new Fraction(numerator, denominator);
  }
}

/**
 * Coin class to represent a token
 */
export class Coin {
  public readonly coinType: string;
  public readonly decimals?: number;
  public readonly symbol?: string;

  constructor(coinType: string, decimals?: number, symbol?: string) {
    this.coinType = coinType;
    this.decimals = decimals;
    this.symbol = symbol;
  }

  equals(other: Coin): boolean {
    return this.coinType === other.coinType;
  }
}

/**
 * Utility function to get current time in milliseconds
 */
export function nowInMilliseconds(): number {
  return Date.now();
}

/**
 * Normalize coin type by removing leading zeros in address
 */
export function standardShortCoinType(coinType: string): string {
  // Simple normalization: ensure it starts with 0x
  if (!coinType.startsWith("0x")) {
    return `0x${coinType}`;
  }
  return coinType;
}
