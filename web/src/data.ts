import { type Address } from "viem";
import { pub, ADDR, marketAbi, erc6909Abi } from "./chain";

export type Holder = { address: string; side: number; tokens: string; amount: string };
export type Market = {
  marketId: `0x${string}`;
  market: Address;
  pool: Address;
  nonce: string;
  oracleQuestionId: string;
  operatorId: number;
  venueId: `0x${string}`;
  creator: Address;
  yesId: string;
  noId: string;
  asset: string;
  strike: string;
  question: string;
  tradingStart: number;
  expiry: number;
  intervalSec: number;
  voidPolicy: number;
  createdBlock: number;
  createdTx: string;
  status: number;
  resolved: boolean;
  voided: boolean;
  payout: string[];
  payoutFrac: number[];
  settlementWindow: number;
  backing: string;
  adapter: Address | null;
  winner: number;
  voidableAt: number;
  phase: "listed" | "trading" | "settling" | "stalled" | "resolved" | "voided";
  answer?: { value: string; voided: boolean };
  answerDecimals?: number;
  holders: number;
  unclaimed: { total: string; holders: Holder[]; count?: number };
};
export type Snapshot = {
  generatedAt: number;
  fromBlock: string;
  toBlock: string;
  rangeHours: number;
  stats: Record<string, number | string>;
  markets: Market[];
  holders: { address: string; total: string }[];
};

export async function loadSnapshot(): Promise<Snapshot> {
  const r = await fetch(`data/snapshot.json?t=${Math.floor(Date.now() / 60000)}`);
  if (!r.ok) throw new Error("snapshot missing");
  return r.json();
}

/** Re-read status/resolution for the freshest markets so phases are live, not snapshot-old. */
export async function refreshPhases(markets: Market[], limit = 40): Promise<Market[]> {
  const fresh = markets.slice(0, limit);
  const res = await pub.multicall({
    allowFailure: true,
    contracts: fresh.flatMap((m) => [
      { address: m.market, abi: marketAbi, functionName: "isResolved" },
      { address: m.market, abi: marketAbi, functionName: "isVoided" },
      { address: m.market, abi: marketAbi, functionName: "payoutNumerators" },
    ]),
  });
  const now = Math.floor(Date.now() / 1000);
  fresh.forEach((m, i) => {
    const resolved = Boolean(res[i * 3].result), voided = Boolean(res[i * 3 + 1].result);
    const pn = (res[i * 3 + 2].result as bigint[] | undefined) || [];
    if (resolved || voided) {
      m.resolved = resolved;
      m.voided = voided;
      const sum = pn.reduce((a, b) => a + b, 0n);
      m.payout = pn.map(String);
      m.payoutFrac = sum > 0n ? pn.map((x) => Number(x) / Number(sum)) : m.payoutFrac;
      m.winner = resolved && sum > 0n ? (pn[0] > pn[1] ? 0 : 1) : -1;
    }
    m.phase = m.resolved ? "resolved" : m.voided ? "voided" : now < m.tradingStart ? "listed" : now < m.expiry ? "trading" : now < m.voidableAt ? "settling" : "stalled";
  });
  return markets;
}

export type Claimable = { m: Market; side: number; tokens: bigint; amount: bigint };

/** Live positions of one address across every indexed terminal market. */
export async function positionsOf(address: Address, markets: Market[]): Promise<{ claimable: Claimable[]; open: Claimable[] }> {
  const rows = markets.filter((m) => m.phase !== "listed");
  const res = await pub.multicall({
    allowFailure: true,
    contracts: rows.flatMap((m) => [
      { address: ADDR.outcomeToken, abi: erc6909Abi, functionName: "balanceOf", args: [address, BigInt(m.yesId)] },
      { address: ADDR.outcomeToken, abi: erc6909Abi, functionName: "balanceOf", args: [address, BigInt(m.noId)] },
    ]),
  });
  const claimable: Claimable[] = [];
  const open: Claimable[] = [];
  rows.forEach((m, i) => {
    const yes = (res[i * 2].result as bigint | undefined) || 0n;
    const no = (res[i * 2 + 1].result as bigint | undefined) || 0n;
    for (const [side, tokens] of [[0, yes], [1, no]] as [number, bigint][]) {
      if (tokens <= 0n) continue;
      if (m.resolved || m.voided) {
        const frac = m.payoutFrac[side] ?? 0;
        if (frac > 0) claimable.push({ m, side, tokens, amount: BigInt(Math.floor(Number(tokens) * frac)) });
      } else {
        open.push({ m, side, tokens, amount: tokens });
      }
    }
  });
  claimable.sort((a, b) => (b.amount > a.amount ? 1 : -1));
  return { claimable, open };
}
