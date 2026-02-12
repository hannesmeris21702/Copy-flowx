# Quick Start Guide

Get your SUI CLMM liquidity management bot running in 5 minutes.

## Prerequisites

- Node.js 18+ and Yarn
- A Sui wallet with SUI tokens
- An existing CLMM position on Cetus

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd Copy-flowx

# Install dependencies
yarn install

# Build
yarn build
```

## Configuration

### 1. Create Environment File

```bash
cp .env.example .env
```

### 2. Edit `.env` with Your Settings

**Minimum Required Configuration:**

```env
# Your wallet private key (without 0x prefix)
PRIVATE_KEY=your_private_key_here

# Target pool to manage (Cetus pool object ID)
TARGET_POOL=0x88cec280ed5406af7951ef768b305de5323b843cc127bcab988d08770d00a5f7

# Strategy mode: SAFE or AGGRESSIVE
STRATEGY_MODE=SAFE
```

**SAFE Mode Settings (Recommended for Beginners):**
```env
STRATEGY_MODE=SAFE
BPRICE_PERCENT=50                     # 0.5% range width
TPRICE_PERCENT=10                     # 0.1% range adjustment
SLIPPAGE_TOLERANCE=10000              # 1% max slippage
REBALANCE_COOLDOWN_MS=3600000         # 1 hour cooldown
MAX_VOLATILITY_PERCENT=1000           # 10% max volatility
REWARD_THRESHOLD_USD=10               # $10 minimum to compound
```

**AGGRESSIVE Mode Settings (For Experienced Users):**
```env
STRATEGY_MODE=AGGRESSIVE
BPRICE_PERCENT=20                     # 0.2% range width
TPRICE_PERCENT=5                      # 0.05% range adjustment
SLIPPAGE_TOLERANCE=50000              # 5% max slippage
REBALANCE_COOLDOWN_MS=600000          # 10 minutes cooldown
MAX_VOLATILITY_PERCENT=2000           # 20% max volatility
REWARD_THRESHOLD_USD=1                # $1 minimum to compound
```

## Running the Bot

### Production Mode

```bash
yarn start
```

The bot will:
1. Connect to Sui mainnet
2. Detect your LP position on the target pool
3. Monitor the position continuously
4. Automatically rebalance when price moves out of range
5. Compound rewards based on your settings

### Development Mode

```bash
yarn dev
```

Use this for testing with console output.

## Monitoring

The bot logs all activities:

```
Start rebalancing worker with config {...}
PoolWatcher: Initialized for pool 0x88ce...
PositionWatcher: Position 0xabc... is IN RANGE
```

### Key Log Messages

- **"Position is OUT OF RANGE"** - Rebalance will be triggered
- **"Position is in range"** - No action needed
- **"Cooldown active"** - Waiting for cooldown period
- **"High volatility detected"** - Skipping rebalance for safety
- **"Rebalance complete"** - Successfully rebalanced

## What the Bot Does

### Continuous Monitoring
The bot runs in a loop (default: 5 seconds) checking:
- Current pool price and tick
- Position range status (in-range or out-of-range)
- Accumulated rewards

### Automatic Rebalancing

When price moves out of range, the bot:
1. ✅ Checks cooldown period
2. ✅ Checks volatility
3. ✅ Removes liquidity from old position
4. ✅ Collects fees and rewards
5. ✅ Calculates new optimal range
6. ✅ Swaps tokens if needed (with slippage protection)
7. ✅ Opens new position with same USD value
8. ✅ Confirms new position is active

### Automatic Compounding

Based on your settings, the bot:
- Compounds rewards when USD value exceeds threshold
- Compounds rewards on schedule (e.g., every hour)
- Adds rewards back to the position

## Safety Features

The bot includes multiple safety guards:

### Slippage Protection
- Max 1% slippage in SAFE mode
- Max 5% slippage in AGGRESSIVE mode
- Aborts trades if slippage exceeds limit

### Price Impact Protection
- Checks USD value of swaps
- Aborts if price impact too high
- Prevents unfavorable trades

### Cooldown Protection
- 1 hour minimum between rebalances (SAFE)
- 10 minutes minimum (AGGRESSIVE)
- Prevents over-trading

### Volatility Protection
- Monitors price volatility over 5-minute window
- Skips rebalancing during high volatility
- Protects against market manipulation

### Value Preservation
- Tracks total USD value before/after operations
- Ensures value is maintained
- Aborts if value drift exceeds threshold

## Common Issues

### "No active position found"
- Ensure you have an active LP position on the target pool
- Check that the pool ID is correct
- Verify your wallet address has the position

### "Invalid position ticks"
- Position may have corrupted tick data
- Try closing and reopening the position manually
- Contact support if issue persists

### "Cooldown active"
- This is normal - the bot is waiting for the cooldown period
- Adjust REBALANCE_COOLDOWN_MS to change cooldown duration

### "High volatility detected"
- The bot is protecting you from volatile market conditions
- Wait for market to stabilize
- Adjust MAX_VOLATILITY_PERCENT if needed (with caution)

## Configuration Tips

### For Stable Pairs (USDC/USDT)
```env
STRATEGY_MODE=AGGRESSIVE
BPRICE_PERCENT=10                     # Very tight range (0.1%)
SLIPPAGE_TOLERANCE=5000               # 0.5% slippage
REBALANCE_COOLDOWN_MS=300000          # 5 minutes
```

### For Volatile Pairs (SUI/ETH)
```env
STRATEGY_MODE=SAFE
BPRICE_PERCENT=100                    # Wider range (1%)
SLIPPAGE_TOLERANCE=20000              # 2% slippage
REBALANCE_COOLDOWN_MS=7200000         # 2 hours
MAX_VOLATILITY_PERCENT=1500           # 15% max volatility
```

### For Maximum Yield (High Risk)
```env
STRATEGY_MODE=AGGRESSIVE
BPRICE_PERCENT=20                     # Tight range (0.2%)
REBALANCE_COOLDOWN_MS=600000          # 10 minutes
REWARD_THRESHOLD_USD=0.5              # Compound frequently
```

### For Hands-Off Operation (Low Maintenance)
```env
STRATEGY_MODE=SAFE
BPRICE_PERCENT=200                    # Wide range (2%)
REBALANCE_COOLDOWN_MS=14400000        # 4 hours
REWARD_THRESHOLD_USD=50               # Higher threshold
```

## Performance Optimization

### Reduce RPC Costs
- Increase cooldown period
- Increase reward threshold
- Use wider price ranges

### Maximize Capital Efficiency
- Use AGGRESSIVE mode
- Shorter cooldown periods
- Tighter price ranges

### Balance Risk/Reward
- Use SAFE mode as baseline
- Customize individual parameters
- Monitor bot performance

## Stopping the Bot

Press `Ctrl+C` to stop the bot gracefully.

The bot will:
- Complete any ongoing transaction
- Log final status
- Exit cleanly

Your positions remain open and can be managed manually or by restarting the bot.

## Next Steps

1. **Monitor Performance**: Watch the logs for the first few hours
2. **Adjust Settings**: Fine-tune parameters based on your pool
3. **Read Documentation**: See ARCHITECTURE.md for detailed info
4. **Enable Monitoring**: Set up alerts for important events

## Getting Help

- **Documentation**: See README.md and ARCHITECTURE.md
- **Logs**: Check Winston logs for detailed error messages
- **Issues**: Open a GitHub issue with logs attached

## Security Notes

⚠️ **Important**:
- Never share your PRIVATE_KEY
- Keep .env file secure (it's in .gitignore)
- Use a dedicated wallet for the bot
- Start with small positions to test
- Monitor bot activity regularly

## Support

For questions or issues:
1. Check logs for error messages
2. Review ARCHITECTURE.md for detailed documentation
3. Check COMPLIANCE_VERIFICATION.md for feature verification
4. Open a GitHub issue with relevant logs

---

**Happy Rebalancing! 🚀**

The bot is production-ready and designed to maximize your CLMM position yield while protecting your capital.
