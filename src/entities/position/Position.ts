import { ClmmPosition } from "@flowx-finance/sdk";

// We define a new Positional class that inherits the ClmmPosition class
// instead of using the ClmmPosition class directly.
// This allows us to add custom methods or properties in the future if needed.
export class Position extends ClmmPosition {}
