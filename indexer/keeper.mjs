// Resolver keeper: keeps DreamDEX windows from getting stuck after expiry.
//
// A window that has expired but has no resolution is in one of two states:
//   * inside the settlement window: the oracle callback is late. `pokeOracle`
//     on the module is permissionless and re-pulls the answer.
//   * past the settlement window: the oracle never answered. `voidExpired` on
//     the market is permissionless and refunds both sides.
//
// With CLAIM=1 it also sweeps the keeper wallet's own winnings via redeemMany.
//
//   node indexer/keeper.mjs            (loops every 20s over the last 2h of windows)
import { pub, ADDR, marketCreatedEvent, marketAbi, moduleAbi, erc6909Abi, pagedLogs, walletFor, send, log, sleep, now } from "./chain.mjs";

const w = walletFor(process.env.PRIVATE_KEY);
const LOOKBACK_H = Number(process.env.LOOKBACK_HOURS || 2);
const GRACE = Number(process.env.POKE_GRACE_SEC || 120); // give the oracle this long after expiry before poking
const poked = new Map(); // marketId -> last poke time

log(`resolver keeper ${w.account.address}`);

async function scan() {
  const head = await pub.getBlockNumber();
  const from = head - BigInt(Math.floor(LOOKBACK_H * 3600 * 10.4));
  const logs = await pagedLogs({ address: ADDR.module, event: marketCreatedEvent }, from, head, 10);
  const t = now();
  const expired = logs.map((l) => l.args).filter((a) => Number(a.expiry) < t && (a.collateral || "").toLowerCase() === ADDR.collateral.toLowerCase());
  if (!expired.length) return;
  const state = await pub.multicall({
    allowFailure: true,
    contracts: expired.flatMap((a) => [
      { address: a.market, abi: marketAbi, functionName: "isResolved" },
      { address: a.market, abi: marketAbi, functionName: "isVoided" },
      { address: a.market, abi: marketAbi, functionName: "settlementWindow" },
    ]),
  });
  let stuck = 0;
  for (let i = 0; i < expired.length; i++) {
    const a = expired[i];
    const resolved = state[i * 3].result, voided = state[i * 3 + 1].result, sw = Number(state[i * 3 + 2].result ?? 300);
    if (resolved || voided) continue;
    stuck++;
    const age = t - Number(a.expiry);
    if (age < GRACE) continue;
    const key = a.marketId;
    if (t < Number(a.expiry) + sw) {
      if ((poked.get(key) || 0) > t - 300) continue;
      poked.set(key, t);
      log(`${a.asset} window closed ${new Date(Number(a.expiry) * 1000).toISOString().slice(11, 19)} is unresolved ${age}s after expiry: poking oracle`);
      try {
        await send(w, { address: ADDR.module, abi: moduleAbi, functionName: "pokeOracle", args: [a.oracleQuestionId] }, "pokeOracle");
      } catch (e) {
        log(`poke failed: ${(e.shortMessage || e.message).split("\n")[0]}`);
      }
    } else {
      log(`${a.asset} window closed ${new Date(Number(a.expiry) * 1000).toISOString().slice(11, 19)} is past its settlement window: voiding`);
      try {
        await send(w, { address: a.market, abi: marketAbi, functionName: "voidExpired" }, "voidExpired");
      } catch (e) {
        log(`void failed: ${(e.shortMessage || e.message).split("\n")[0]}`);
      }
    }
  }
  if (stuck) log(`${stuck} expired window(s) without resolution`);
  if (process.env.CLAIM === "1") await claimMine(logs.map((l) => l.args), state, expired);
}

async function claimMine(all, state, expired) {
  const me = w.account.address;
  const terminal = expired.filter((a, i) => state[i * 3].result || state[i * 3 + 1].result);
  if (!terminal.length) return;
  const bals = await pub.multicall({
    allowFailure: true,
    contracts: terminal.flatMap((a) => [
      { address: ADDR.outcomeToken, abi: erc6909Abi, functionName: "balanceOf", args: [me, a.yesId] },
      { address: ADDR.outcomeToken, abi: erc6909Abi, functionName: "balanceOf", args: [me, a.noId] },
      { address: a.market, abi: marketAbi, functionName: "payoutNumerators" },
    ]),
  });
  const ids = [], idxs = [], amts = [];
  terminal.forEach((a, i) => {
    const yes = bals[i * 3].result || 0n, no = bals[i * 3 + 1].result || 0n, pn = bals[i * 3 + 2].result || [];
    if (yes > 0n && (pn[0] || 0n) > 0n) { ids.push(a.marketId); idxs.push(0); amts.push(yes); }
    if (no > 0n && (pn[1] || 0n) > 0n) { ids.push(a.marketId); idxs.push(1); amts.push(no); }
  });
  if (!ids.length) return;
  const isOp = await pub.readContract({ address: ADDR.outcomeToken, abi: erc6909Abi, functionName: "isOperator", args: [me, ADDR.module] });
  if (!isOp) await send(w, { address: ADDR.outcomeToken, abi: erc6909Abi, functionName: "setOperator", args: [ADDR.module, true] }, "setOperator(module)");
  log(`claiming ${ids.length} position(s) in one redeemMany`);
  await send(w, { address: ADDR.module, abi: moduleAbi, functionName: "redeemMany", args: [0, "0x" + "0".repeat(64), ids, idxs, amts] }, "redeemMany");
}

for (;;) {
  try {
    await scan();
  } catch (e) {
    log(`scan failed: ${(e.shortMessage || e.message).split("\n")[0]}`);
  }
  await sleep(Number(process.env.TICK_MS || 20000));
}
