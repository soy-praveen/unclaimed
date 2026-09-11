// End-to-end proof of the claim path: mint a complete set on the soonest live
// window, wait for DreamDEX to resolve it, then redeem the winning side with the
// same `redeemMany` call the claim desk sends.
//
//   node indexer/selftest.mjs
import { parseAbi } from "viem";
import { pub, ADDR, marketCreatedEvent, marketAbi, moduleAbi, erc6909Abi, pagedLogs, walletFor, send, log, sleep, now } from "./chain.mjs";

const w = walletFor(process.env.PRIVATE_KEY);
const me = w.account.address;
const erc20 = parseAbi(["function approve(address,uint256) returns (bool)", "function allowance(address,address) view returns (uint256)"]);
const pool = parseAbi(["function mintSet(address yesTo, address noTo, uint256 amount)"]);
const AMOUNT = 2_000_000n; // 2 sets

const head = await pub.getBlockNumber();
const logs = await pagedLogs({ address: ADDR.module, event: marketCreatedEvent }, head - 2999n, head, 3);
const t = now();
const live = logs
  .map((l) => l.args)
  .filter((a) => (a.collateral || "").toLowerCase() === ADDR.collateral.toLowerCase() && Number(a.expiry) > t + 45)
  .sort((a, b) => Number(a.expiry) - Number(b.expiry));
const m = live[0];
if (!m) throw new Error("no live window");
log(`window ${m.asset} closes ${new Date(Number(m.expiry) * 1000).toISOString().slice(11, 19)} pool ${m.pool}`);

const allowance = await pub.readContract({ address: ADDR.collateral, abi: erc20, functionName: "allowance", args: [me, m.pool] });
if (allowance < AMOUNT) await send(w, { address: ADDR.collateral, abi: erc20, functionName: "approve", args: [m.pool, 2n ** 255n] }, "approve pool");
await send(w, { address: m.pool, abi: pool, functionName: "mintSet", args: [me, me, AMOUNT] }, "mintSet 2 sets");

log("waiting for resolution…");
for (;;) {
  const [resolved, voided] = await Promise.all([
    pub.readContract({ address: m.market, abi: marketAbi, functionName: "isResolved" }),
    pub.readContract({ address: m.market, abi: marketAbi, functionName: "isVoided" }),
  ]);
  if (resolved || voided) break;
  await sleep(10000);
}
const pn = await pub.readContract({ address: m.market, abi: marketAbi, functionName: "payoutNumerators" });
const side = pn[0] > 0n ? 0 : 1;
const id = side === 0 ? m.yesId : m.noId;
const bal = await pub.readContract({ address: ADDR.outcomeToken, abi: erc6909Abi, functionName: "balanceOf", args: [me, id] });
log(`resolved ${side === 0 ? "UP" : "DOWN"}, holding ${Number(bal) / 1e6} winning tokens`);
const isOp = await pub.readContract({ address: ADDR.outcomeToken, abi: erc6909Abi, functionName: "isOperator", args: [me, ADDR.module] });
if (!isOp) await send(w, { address: ADDR.outcomeToken, abi: erc6909Abi, functionName: "setOperator", args: [ADDR.module, true] }, "setOperator(module)");
const before = await pub.readContract({ address: ADDR.collateral, abi: parseAbi(["function balanceOf(address) view returns (uint256)"]), functionName: "balanceOf", args: [me] });
await send(w, { address: ADDR.module, abi: moduleAbi, functionName: "redeemMany", args: [0, "0x" + "0".repeat(64), [m.marketId], [side], [bal]] }, "redeemMany");
const after = await pub.readContract({ address: ADDR.collateral, abi: parseAbi(["function balanceOf(address) view returns (uint256)"]), functionName: "balanceOf", args: [me] });
log(`collateral back: ${Number(after - before) / 1e6} tUSDC`);
process.exit(0);
