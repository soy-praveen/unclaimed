// Unclaimed indexer: rebuilds the settlement picture of DreamDEX Event Contracts
// on Somnia Shannon from chain logs and on-chain reads, and writes a snapshot the
// web app serves. No indexer, no database: MarketCreated logs from the module,
// ERC-6909 Transfer logs from the outcome token, and view calls.
//
//   RANGE_HOURS=6 node indexer/index.mjs
import { writeFileSync, mkdirSync } from "fs";
import { pub, ADDR, marketCreatedEvent, transferEvent, marketAbi, moduleAbi, adapterAbi, poolAbi, pagedLogs, log, now } from "./chain.mjs";

const RANGE_HOURS = Number(process.env.RANGE_HOURS || 6);
const BLOCKS_PER_SEC = 10.4; // measured on Shannon, Sept 2026
const ZERO = "0x0000000000000000000000000000000000000000";
const SKIP_HOLDERS = new Set([ZERO, ADDR.module, ADDR.settlement].map((a) => a.toLowerCase()));

const head = await pub.getBlockNumber();
const from = head - BigInt(Math.floor(RANGE_HOURS * 3600 * BLOCKS_PER_SEC));
log(`indexing blocks ${from} .. ${head} (${RANGE_HOURS}h)`);

// 1. markets
const created = await pagedLogs({ address: ADDR.module, event: marketCreatedEvent }, from, head, 10, (d, t, n) => d % 50 === 0 && log(`markets: page ${d}/${t}, ${n} logs`));
const markets = new Map();
for (const l of created) {
  const a = l.args;
  if ((a.collateral || "").toLowerCase() !== ADDR.collateral.toLowerCase()) continue;
  markets.set(a.marketId, {
    marketId: a.marketId,
    market: a.market,
    pool: a.pool,
    nonce: a.nonce.toString(),
    oracleQuestionId: a.oracleQuestionId.toString(),
    operatorId: Number(a.operatorId),
    venueId: a.venueId,
    creator: a.creator,
    yesId: a.yesId.toString(),
    noId: a.noId.toString(),
    asset: a.asset,
    strike: a.strike.toString(),
    question: a.question,
    tradingStart: Number(a.tradingStart),
    expiry: Number(a.expiry),
    intervalSec: Math.max(60, Math.round((Number(a.expiry) - Number(a.tradingStart)) / 60) * 60),
    voidPolicy: Number(a.voidPolicy),
    createdBlock: Number(l.blockNumber),
    createdTx: l.transactionHash,
  });
}
log(`${markets.size} tUSDC markets`);
const byId = new Map();
for (const m of markets.values()) {
  byId.set(m.yesId, { m, side: 0 });
  byId.set(m.noId, { m, side: 1 });
}

// 2. on-chain state per market (batched via multicall)
const rows = [...markets.values()];
const calls = rows.flatMap((m) => [
  { address: m.market, abi: marketAbi, functionName: "status" },
  { address: m.market, abi: marketAbi, functionName: "isResolved" },
  { address: m.market, abi: marketAbi, functionName: "isVoided" },
  { address: m.market, abi: marketAbi, functionName: "payoutNumerators" },
  { address: m.market, abi: marketAbi, functionName: "settlementWindow" },
  { address: m.market, abi: marketAbi, functionName: "backing" },
  { address: ADDR.module, abi: moduleAbi, functionName: "markets", args: [m.marketId] },
]);
const results = [];
for (let i = 0; i < calls.length; i += 350) {
  const r = await pub.multicall({ contracts: calls.slice(i, i + 350), allowFailure: true });
  results.push(...r);
  log(`state: ${Math.min(i + 350, calls.length)}/${calls.length} calls`);
}
const val = (r) => (r && r.status === "success" ? r.result : null);
rows.forEach((m, i) => {
  const o = i * 7;
  m.status = Number(val(results[o]) ?? -1);
  m.resolved = Boolean(val(results[o + 1]));
  m.voided = Boolean(val(results[o + 2]));
  const pn = val(results[o + 3]) || [];
  m.payout = pn.map((x) => x.toString());
  m.settlementWindow = Number(val(results[o + 4]) ?? 0);
  m.backing = (val(results[o + 5]) ?? 0n).toString();
  const rec = val(results[o + 6]);
  m.adapter = rec ? rec[6] : null;
  const sum = pn.reduce((a, b) => a + b, 0n);
  m.winner = m.resolved && sum > 0n ? (pn[0] > pn[1] ? 0 : 1) : -1;
  m.payoutFrac = sum > 0n ? pn.map((x) => Number(x) / Number(sum)) : [0, 0];
  m.voidableAt = m.expiry + m.settlementWindow;
  const t = now();
  m.phase = m.resolved ? "resolved" : m.voided ? "voided" : t < m.tradingStart ? "listed" : t < m.expiry ? "trading" : t < m.voidableAt ? "settling" : "stalled";
});

// 3. oracle answers for terminal markets
const answerCalls = rows.filter((m) => m.adapter && m.adapter !== ZERO && (m.resolved || m.voided)).flatMap((m) => [
  { address: m.adapter, abi: adapterAbi, functionName: "pullNumericAnswer", args: [BigInt(m.oracleQuestionId)], _m: m },
  { address: m.adapter, abi: adapterAbi, functionName: "PRICE_DECIMALS", _m: m },
]);
for (let i = 0; i < answerCalls.length; i += 300) {
  const slice = answerCalls.slice(i, i + 300);
  const r = await pub.multicall({ contracts: slice.map(({ _m, ...c }) => c), allowFailure: true });
  slice.forEach((c, j) => {
    const v = val(r[j]);
    if (c.functionName === "pullNumericAnswer" && v) c._m.answer = { value: v[0].toString(), voided: v[1] };
    if (c.functionName === "PRICE_DECIMALS" && v !== null) c._m.answerDecimals = Number(v);
  });
}
for (const m of rows) if (m.answer && m.answerDecimals === undefined) m.answerDecimals = m.adapter.toLowerCase() === ADDR.oracleHub.toLowerCase() ? 2 : 2;
log(`answers: ${rows.filter((m) => m.answer).length}`);

// 4. outcome token balances from Transfer logs (ids only exist after creation, so the range is exact)
const transfers = await pagedLogs({ address: ADDR.outcomeToken, event: transferEvent }, from, head, 10, (d, t, n) => d % 50 === 0 && log(`transfers: page ${d}/${t}, ${n} logs`));
const bal = new Map(); // `${holder}|${id}` -> bigint
let volume = 0n;
const touched = new Map(); // marketId -> set of holders
for (const l of transfers) {
  const a = l.args;
  const id = a.id.toString();
  const hit = byId.get(id);
  if (!hit) continue;
  const amt = a.amount;
  const s = a.sender.toLowerCase(), r = a.receiver.toLowerCase();
  if (s !== ZERO) bal.set(`${s}|${id}`, (bal.get(`${s}|${id}`) || 0n) - amt);
  if (r !== ZERO) bal.set(`${r}|${id}`, (bal.get(`${r}|${id}`) || 0n) + amt);
  if (s !== ZERO && r !== ZERO) volume += amt;
  for (const h of [s, r]) {
    if (SKIP_HOLDERS.has(h)) continue;
    if (!touched.has(hit.m.marketId)) touched.set(hit.m.marketId, new Set());
    touched.get(hit.m.marketId).add(h);
  }
}
log(`${transfers.length} transfers, ${bal.size} holder positions`);

// 5. unclaimed winnings: resolved -> winning side holders; voided -> both sides at their payout
const holderTotals = new Map();
let unclaimedTotal = 0n;
let positions = 0;
for (const m of rows) {
  m.holders = touched.get(m.marketId)?.size || 0;
  m.unclaimed = { total: "0", holders: [] };
  if (!(m.resolved || m.voided)) continue;
  const sides = m.voided ? [0, 1] : [m.winner];
  const list = [];
  for (const side of sides) {
    const id = side === 0 ? m.yesId : m.noId;
    const frac = m.payoutFrac[side] || (m.voided ? 0.5 : 1);
    for (const [key, v] of bal) {
      if (v <= 0n) continue;
      const [holder, hid] = key.split("|");
      if (hid !== id || SKIP_HOLDERS.has(holder)) continue;
      const value = BigInt(Math.floor(Number(v) * frac));
      if (value <= 0n) continue;
      list.push({ address: holder, side, tokens: v.toString(), amount: value.toString() });
      holderTotals.set(holder, (holderTotals.get(holder) || 0n) + value);
      unclaimedTotal += value;
      positions++;
    }
  }
  list.sort((a, b) => (BigInt(b.amount) > BigInt(a.amount) ? 1 : -1));
  m.unclaimed = { total: list.reduce((a, b) => a + BigInt(b.amount), 0n).toString(), holders: list.slice(0, 25), count: list.length };
}

const holders = [...holderTotals.entries()]
  .map(([address, total]) => ({ address, total: total.toString() }))
  .sort((a, b) => (BigInt(b.total) > BigInt(a.total) ? 1 : -1))
  .slice(0, 100);

const stats = {
  windows: rows.length,
  resolved: rows.filter((m) => m.resolved).length,
  voided: rows.filter((m) => m.voided).length,
  stalled: rows.filter((m) => m.phase === "stalled").length,
  settling: rows.filter((m) => m.phase === "settling").length,
  trading: rows.filter((m) => m.phase === "trading").length,
  upWins: rows.filter((m) => m.winner === 0).length,
  downWins: rows.filter((m) => m.winner === 1).length,
  withTrades: rows.filter((m) => m.holders > 0).length,
  unclaimedTotal: unclaimedTotal.toString(),
  unclaimedPositions: positions,
  unclaimedHolders: holderTotals.size,
  transfers: transfers.length,
  volumeTokens: volume.toString(),
};

rows.sort((a, b) => b.expiry - a.expiry);
const snapshot = { generatedAt: now(), chainId: 50312, fromBlock: from.toString(), toBlock: head.toString(), rangeHours: RANGE_HOURS, addresses: ADDR, stats, markets: rows, holders };
mkdirSync(new URL("../web/public/data/", import.meta.url), { recursive: true });
writeFileSync(new URL("../web/public/data/snapshot.json", import.meta.url), JSON.stringify(snapshot));
log(`snapshot written: ${rows.length} markets, unclaimed ${Number(unclaimedTotal) / 1e6} tUSDC across ${holderTotals.size} holders, stalled ${stats.stalled}`);
process.exit(0);
