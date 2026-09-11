// Shared chain setup and ABIs for the Unclaimed indexer and keeper.
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { somniaTestnet } from "viem/chains";
import { config } from "dotenv";
config();

export const RPC = process.env.RPC_URL || "https://dream-rpc.somnia.network";
export const pub = createPublicClient({ chain: somniaTestnet, transport: http(RPC, { batch: true }), batch: { multicall: true } });

export const ADDR = {
  module: "0x3ecC694Cef705358864a646142ac17A90E29e388",
  outcomeToken: "0xB52c5934113Af5c0Bb20eb3C72290C8215f755b9",
  settlement: "0xbF4a49e0Dfd092e5FBE8E5761064C49533e6Ed23",
  collateral: "0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E",
  oracleHub: "0xe40db387cC98601Dd11bd634fF2f3AD5686dE32b",
};

export const marketCreatedEvent = {
  type: "event",
  name: "MarketCreated",
  inputs: [
    { name: "marketId", type: "bytes32", indexed: true },
    { name: "market", type: "address", indexed: true },
    { name: "pool", type: "address", indexed: true },
    { name: "oracleQuestionId", type: "uint256", indexed: false },
    { name: "operatorId", type: "uint32", indexed: false },
    { name: "venueId", type: "bytes32", indexed: false },
    { name: "creator", type: "address", indexed: false },
    { name: "collateral", type: "address", indexed: false },
    { name: "yesId", type: "uint256", indexed: false },
    { name: "noId", type: "uint256", indexed: false },
    { name: "nonce", type: "uint64", indexed: false },
    { name: "outcomeSlotCount", type: "uint8", indexed: false },
    { name: "marketType", type: "uint8", indexed: false },
    { name: "tradingStart", type: "uint64", indexed: false },
    { name: "expiry", type: "uint64", indexed: false },
    { name: "voidPolicy", type: "uint8", indexed: false },
    { name: "asset", type: "string", indexed: false },
    { name: "strike", type: "uint256", indexed: false },
    { name: "question", type: "string", indexed: false },
    { name: "context", type: "bytes", indexed: false },
  ],
};

export const transferEvent = {
  type: "event",
  name: "Transfer",
  inputs: [
    { name: "caller", type: "address", indexed: false },
    { name: "sender", type: "address", indexed: true },
    { name: "receiver", type: "address", indexed: true },
    { name: "id", type: "uint256", indexed: true },
    { name: "amount", type: "uint256", indexed: false },
  ],
};

export const marketAbi = parseAbi([
  "function status() view returns (uint8)",
  "function isResolved() view returns (bool)",
  "function isVoided() view returns (bool)",
  "function payoutNumerators() view returns (uint256[])",
  "function settlementWindow() view returns (uint64)",
  "function backing() view returns (uint256)",
  "function voidExpired()",
]);

export const moduleAbi = parseAbi([
  "function markets(bytes32 marketId) view returns (uint256 oracleQuestionId, uint8 outcomeSlotCount, uint8 voidPolicy, address collateral, uint32 originOperatorId, bytes32 originVenueId, address oracleAdapter, address creator, address market, address pool, uint256 yesId, uint256 noId, uint64 tradingStart, uint64 expiry)",
  "function pokeOracle(uint256 oracleQuestionId)",
  "function redeem(uint32 operatorId, bytes32 venueId, bytes32 marketId, uint8 outcomeIdx, uint256 amount)",
  "function redeemMany(uint32 operatorId, bytes32 venueId, bytes32[] marketIds, uint8[] outcomeIdxs, uint256[] amounts)",
  "function finalizeMarket(bytes32 marketId)",
]);

export const adapterAbi = parseAbi([
  "function pullNumericAnswer(uint256 oracleQuestionId) view returns (int256 numericValue, bool voided)",
  "function PRICE_DECIMALS() view returns (uint8)",
]);

export const erc6909Abi = parseAbi([
  "function balanceOf(address owner, uint256 id) view returns (uint256)",
  "function isOperator(address owner, address spender) view returns (bool)",
  "function setOperator(address spender, bool approved) returns (bool)",
]);

export const poolAbi = parseAbi([
  "function getBinaryPoolParams() view returns ((address collateralToken, address market, address outcomeToken, uint256 yesId, uint256 noId, uint256 oneCollateral, uint256 setBacking, address feeRecipient, uint256 makerFeeBpsTimes1k, uint256 takerFeeBpsTimes1k, uint256 maxBuilderFeeBpsTimes1k, uint256 settlementFeeBpsTimes1k, address settlement, uint64 marketNonce, bool finalized))",
]);

export function walletFor(pk) {
  const account = privateKeyToAccount(pk);
  return { account, wallet: createWalletClient({ chain: somniaTestnet, transport: http(RPC), account }) };
}

export const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const now = () => Math.floor(Date.now() / 1000);

/// Page a getLogs query over [from, to] in 1000-block pages, `par` pages at a time.
export async function pagedLogs(params, from, to, par = 8, onPage) {
  const ranges = [];
  for (let f = from; f <= to; f += 1000n) ranges.push([f, f + 999n > to ? to : f + 999n]);
  const out = [];
  for (let i = 0; i < ranges.length; i += par) {
    const batch = ranges.slice(i, i + par);
    const res = await Promise.all(
      batch.map(([a, b]) =>
        pub.getLogs({ ...params, fromBlock: a, toBlock: b }).catch(async () => {
          await sleep(500);
          return pub.getLogs({ ...params, fromBlock: a, toBlock: b }).catch(() => []);
        })
      )
    );
    for (const r of res) out.push(...r);
    if (onPage) onPage(Math.min(i + par, ranges.length), ranges.length, out.length);
  }
  return out;
}

/// Send a write with Somnia-friendly fees and wait for the receipt.
export async function send(w, req, label) {
  const fees = await pub.estimateFeesPerGas();
  const gas = await pub.estimateContractGas({ ...req, account: w.account });
  const hash = await w.wallet.writeContract({ ...req, gas: (gas * 15n) / 10n, maxFeePerGas: fees.maxFeePerGas * 2n, maxPriorityFeePerGas: fees.maxPriorityFeePerGas });
  const rcpt = await pub.waitForTransactionReceipt({ hash });
  if (rcpt.status !== "success") throw new Error(`${label || req.functionName} reverted: ${hash}`);
  log(`${label || req.functionName} ok ${hash}`);
  return rcpt;
}
