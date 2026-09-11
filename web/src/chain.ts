import { createPublicClient, createWalletClient, custom, http, parseAbi, formatUnits, type Address, type Hex, type WalletClient } from "viem";
import { somniaTestnet } from "viem/chains";

export const chain = somniaTestnet;
export const RPC = "https://dream-rpc.somnia.network";
export const EXPLORER = "https://shannon-explorer.somnia.network";
export const pub = createPublicClient({ chain, transport: http(RPC, { batch: true }), batch: { multicall: true } });

export const ADDR = {
  module: "0x3ecC694Cef705358864a646142ac17A90E29e388" as Address,
  outcomeToken: "0xB52c5934113Af5c0Bb20eb3C72290C8215f755b9" as Address,
  settlement: "0xbF4a49e0Dfd092e5FBE8E5761064C49533e6Ed23" as Address,
  collateral: "0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E" as Address,
};

export const marketAbi = parseAbi([
  "function status() view returns (uint8)",
  "function isResolved() view returns (bool)",
  "function isVoided() view returns (bool)",
  "function payoutNumerators() view returns (uint256[])",
  "function voidExpired()",
]);
export const moduleAbi = parseAbi([
  "function pokeOracle(uint256 oracleQuestionId)",
  "function redeemMany(uint32 operatorId, bytes32 venueId, bytes32[] marketIds, uint8[] outcomeIdxs, uint256[] amounts)",
]);
export const erc6909Abi = parseAbi([
  "function balanceOf(address owner, uint256 id) view returns (uint256)",
  "function isOperator(address owner, address spender) view returns (bool)",
  "function setOperator(address spender, bool approved) returns (bool)",
]);

export const txUrl = (h: string) => `${EXPLORER}/tx/${h}`;
export const addrUrl = (a: string) => `${EXPLORER}/address/${a}`;
export const short = (a: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
export const usd = (v: bigint | string | number, dp = 2) => Number(formatUnits(BigInt(typeof v === "number" ? Math.floor(v) : v), 6)).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
export const hhmm = (t: number) => new Date(t * 1000).toISOString().slice(11, 16);
export const hhmmss = (t: number) => new Date(t * 1000).toISOString().slice(11, 19);
export const dateShort = (t: number) => new Date(t * 1000).toISOString().slice(5, 16).replace("T", " ");
export const ago = (t: number) => {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - t);
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  return `${(s / 3600).toFixed(1)}h ago`;
};
export const price = (value: string, decimals: number) => {
  const n = Number(value) / 10 ** decimals;
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export type Wallet = { address: Address; client: WalletClient };
declare global {
  interface Window {
    ethereum?: any;
  }
}
export async function connectWallet(): Promise<Wallet> {
  const eth = window.ethereum;
  if (!eth) throw new Error("No injected wallet found.");
  const [address] = (await eth.request({ method: "eth_requestAccounts" })) as Address[];
  const hexId = `0x${chain.id.toString(16)}`;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
  } catch (e: any) {
    if (e?.code === 4902 || /4902|unrecognized|not added/i.test(String(e?.message))) {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [{ chainId: hexId, chainName: "Somnia Shannon Testnet", nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 }, rpcUrls: [RPC], blockExplorerUrls: [EXPLORER] }],
      });
    } else throw e;
  }
  return { address, client: createWalletClient({ chain, transport: custom(eth), account: address }) };
}
export async function silentWallet(): Promise<Wallet | null> {
  const eth = window.ethereum;
  if (!eth) return null;
  try {
    const accounts = (await eth.request({ method: "eth_accounts" })) as Address[];
    if (!accounts?.length) return null;
    return { address: accounts[0], client: createWalletClient({ chain, transport: custom(eth), account: accounts[0] }) };
  } catch {
    return null;
  }
}
export async function write(w: Wallet, address: Address, abi: any, functionName: string, args: unknown[]): Promise<Hex> {
  const gas = await pub.estimateContractGas({ address, abi, functionName, args, account: w.address });
  const hash = await w.client.writeContract({ address, abi, functionName, args, account: w.address, chain, gas: (gas * 13n) / 10n });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error("Transaction reverted");
  return hash;
}
