# DoraHacks submission text: Unclaimed

## Project name

Unclaimed

## One-liner (vision)

The settlement desk for DreamDEX Event Contracts: how every window resolved, which ones are stuck, who is still holding winnings they never redeemed, and one transaction to collect them.

## Description

A settled Event Contract pays out only when someone asks it to. Winning tokens sit on the ERC-6909 singleton until their owner redeems through the module. The SDK hides finalized markets from `loadMarkets()`, nothing sweeps positions, and the oracle answer, adapter and payout vector are never shown next to a window. In one hour of Shannon history on 11 September the indexer found about 37,000 tUSDC of settled winnings unredeemed across 41 wallets, with a single wallet holding 5,307 tUSDC across 28 windows.

Unclaimed is the missing resolver and settlement surface:

- **Windows**: every tUSDC window with series, strike, the oracle's close price, winning side, live phase, backing, holders and unclaimed winnings. Each row expands to the oracle question and id, adapter address, raw answer and decimals, payout vector, settlement window, outcome ids and top unredeemed holders.
- **Stuck windows**: expired-without-resolution windows are flagged, with one-click permissionless *Poke oracle* inside the settlement window and *Void expired* after it.
- **Holders**: the wallets sitting on the most unredeemed winnings.
- **Claim desk**: paste any address or connect; live ERC-6909 balances across every window, split into settled and open; *Claim all* sends one `redeemMany` for everything, with the one-time `setOperator` handled.
- **Resolver keeper**: a script that pokes late oracles, voids dead windows, and sweeps its own winnings.

Everything is rebuilt from chain data: module `MarketCreated` logs, multicalled market views, adapter answers, and ERC-6909 Transfer logs netted per holder. No indexer service, no database. A GitHub Actions cron re-runs the indexer every 30 minutes and republishes, so the live site is always within half an hour of the chain.

Why it matters for DreamDEX: pull-based settlement is invisible money, and invisible money is a trust problem for every bot, vault and consumer app in the ecosystem. This makes resolution legible and claiming one click, which is exactly the "resolver experience" gap the hackathon starter template called out.

## SDK and docs feedback

- The numeric answer is read from the market's oracle adapter, not from OracleHub, and the adapter varies per series; the only place its address is exposed is the module's `markets(marketId)` record. The docs do not say this.
- The module-side `MarketCreated` event is the one with oracle question id, operator and venue ids and nonce; the creator-side event lacks them, and the SDK address map points discovery at a contract that is not the emitter on Shannon.
- Interval is not on the module event and `expiry - tradingStart` is not always a round number.
- Strike is 0 at creation for 15-minute and 1-hour windows.
- There is no query for "settled windows with unredeemed balances" anywhere in the SDK; it requires ERC-6909 log replay.

## Links

- GitHub: https://github.com/soy-praveen/unclaimed
- Live app: https://soy-praveen.github.io/unclaimed/
- Demo video: _YouTube link_
