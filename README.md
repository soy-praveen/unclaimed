# Unclaimed

**The settlement desk for DreamDEX Event Contracts on Somnia.**

Every window, how it settled, who is still holding winnings they never redeemed, which windows are stuck after expiry, and one transaction to collect everything.

Built for the Somnia x DreamDEX Event Contracts Hackathon. Runs against Somnia Shannon testnet.

- Live app: _link in the submission_
- Repo layout: `indexer/` (snapshot builder, resolver keeper, self-test), `web/` (Vite + React + viem)

## The problem it answers

A settled Event Contract pays out only when someone asks it to. Winning Up or Down tokens sit on the ERC-6909 singleton until their owner calls `redeem` through the `BinaryMarketsModule`. Nothing sweeps them, and the SDK's `loadMarkets()` hides finalized markets, so a bot that trades for a day and never claims looks like it lost money.

The same opacity applies to resolution itself. The oracle adapter, the question id, the numeric answer and the payout vector all exist on chain, but no DreamDEX surface shows them next to the window. When a window expires without a resolution there is a permissionless fix (`pokeOracle`, then `voidExpired` after the settlement window), and nobody can see when it is needed.

In one hour of Shannon history on 11 September 2026 the indexer found 186 windows, 178 resolved, and about 37,000 tUSDC of settled winnings still unredeemed across 41 wallets. One wallet alone held 5,307 tUSDC across 28 windows.

## What it does

**Windows.** Every tUSDC window in the indexed range with series, strike, the oracle's close price, the winning side, live phase (trading, settling, stalled, resolved, voided), collateral backing, holder count and unclaimed winnings. Expanding a row shows the oracle question and id, the adapter address, the raw answer and its decimals, the payout vector, the settlement window, both outcome ids, and the top unredeemed holders.

**Stuck windows.** A window that expired without a resolution is flagged. Inside the settlement window the row offers *Poke oracle* (module `pokeOracle(questionId)`); after it, *Void expired market* (`voidExpired()` on the market). Both are permissionless calls signed by whoever clicks.

**Holders.** The wallets with the most unredeemed winnings, valued at each market's payout vector, excluding the module and settlement contracts.

**Claim desk.** Paste any address or connect. Live ERC-6909 balances across every indexed window, split into settled positions that redeem and open positions still trading. *Claim all* sends one `redeemMany` for every settled position, after a one-time `setOperator` on the outcome token if the module is not yet approved.

## How it gets its data

No indexer service and no database. `indexer/index.mjs` rebuilds everything from the chain:

1. `MarketCreated` logs from the `BinaryMarketsModule` (the 20-field event that carries the oracle question id, operator and venue ids, outcome ids, nonce and payout policy).
2. Per-market view calls, batched through multicall3: `status`, `isResolved`, `isVoided`, `payoutNumerators`, `settlementWindow`, `backing`, and the module's `markets(marketId)` record for the oracle adapter.
3. `pullNumericAnswer` and `PRICE_DECIMALS` on each market's adapter, for the close price.
4. ERC-6909 `Transfer` logs from the outcome-token singleton, netted per holder and id. Because outcome ids only exist after their window is created, balances computed from logs inside the range are exact, not approximate.

The result is written to `web/public/data/snapshot.json`. A GitHub Actions workflow (`.github/workflows/snapshot.yml`) re-runs the indexer every 30 minutes and republishes the site, so the live app stays current without any server. The web app loads it, then re-reads the phase and payout of the newest windows live every 15 seconds, and reads a wallet's balances live when you open the claim desk. Somnia caps `eth_getLogs` at 1000 blocks, so the indexer pages in parallel; six hours of history is a few minutes.

`indexer/keeper.mjs` is a small resolver keeper: it scans recent windows, pokes the oracle for anything unresolved past a grace period, voids anything past its settlement window, and with `CLAIM=1` sweeps its own wallet's winnings with `redeemMany`.

`indexer/selftest.mjs` proves the claim path end to end on testnet: mint a complete set on the soonest window, wait for resolution, redeem the winning side through `redeemMany`.

## Run it

```bash
npm install
cp ../last-call/.env.example .env          # PRIVATE_KEY only needed for the keeper and self-test
RANGE_HOURS=6 npm run index                # writes web/public/data/snapshot.json
npm run keeper                             # resolver keeper loop
node indexer/selftest.mjs                  # mint, wait, redeem

cd web && npm install && npm run dev       # http://127.0.0.1:5174
```

## Notes for the DreamDEX team

- `pullNumericAnswer` lives on the market's adapter, not on OracleHub, and the adapter differs per series (the price-feed adapter answers in 18 decimals and exposes `PRICE_DECIMALS`). The docs never say where to read the answer. The module's `markets(marketId)` record is the only place the adapter address is exposed.
- The creator-side `MarketCreated` event omits `oracleQuestionId`, `operatorId` and `venueId`; the module-side event has them, and the module is the only emitter whose address is stable. The SDK's address map points market discovery at a different contract.
- `intervalSec` is not on the module event. Deriving it from `expiry - tradingStart` gives non-round values on some windows because `tradingStart` lags the schedule by a few seconds.
- `strike` is 0 in the creation event for the 15-minute and 1-hour series at creation time. The question text is the only place the level appears, and it changes wording.
- Nothing on chain or in the SDK lists "settled windows with unredeemed balances". This project exists because that query needs raw log replay.
