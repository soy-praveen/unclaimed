import { useEffect, useState } from "react";
import { isAddress, type Address } from "viem";
import { useApp } from "../App";
import { ADDR, addrUrl, txUrl, short, usd, hhmm, dateShort, write, moduleAbi, erc6909Abi, pub } from "../chain";
import { positionsOf, type Claimable } from "../data";

const sideName = (w: number) => (w === 0 ? "UP" : "DOWN");

export default function Claims({ lookup }: { lookup: string }) {
  const { snap, wallet, connect, toast } = useApp();
  const [addr, setAddr] = useState<string>(lookup || "");
  const [pos, setPos] = useState<{ claimable: Claimable[]; open: Claimable[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastTx, setLastTx] = useState<string | null>(null);

  const target = (isAddress(addr) ? addr : wallet?.address) as Address | undefined;

  useEffect(() => {
    if (lookup) setAddr(lookup);
  }, [lookup]);

  useEffect(() => {
    if (!snap || !target) return setPos(null);
    setLoading(true);
    positionsOf(target, snap.markets)
      .then(setPos)
      .catch(() => setPos(null))
      .finally(() => setLoading(false));
  }, [snap, target, lastTx]);

  const total = pos ? pos.claimable.reduce((a, c) => a + c.amount, 0n) : 0n;
  const mine = wallet && target && wallet.address.toLowerCase() === target.toLowerCase();

  const claimAll = async () => {
    if (!wallet || !pos) return;
    setBusy(true);
    try {
      const isOp = await pub.readContract({ address: ADDR.outcomeToken, abi: erc6909Abi, functionName: "isOperator", args: [wallet.address, ADDR.module] });
      if (!isOp) {
        toast("Approving the module as operator on the outcome token (one time)…");
        await write(wallet, ADDR.outcomeToken, erc6909Abi, "setOperator", [ADDR.module, true]);
      }
      const ids = pos.claimable.map((c) => c.m.marketId);
      const idxs = pos.claimable.map((c) => c.side);
      const amts = pos.claimable.map((c) => c.tokens);
      const hash = await write(wallet, ADDR.module, moduleAbi, "redeemMany", [0, ("0x" + "0".repeat(64)) as `0x${string}`, ids, idxs, amts]);
      setLastTx(hash);
      toast(`Claimed ${usd(total)} tUSDC across ${ids.length} windows`);
    } catch (e: any) {
      toast((e?.shortMessage || e?.message || String(e)).split("\n")[0].slice(0, 200), true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className="hero">
        <h1>Claim desk.</h1>
        <p>
          Live ERC-6909 balances for one wallet across every window in the snapshot, split into settled winnings you can redeem and open positions still trading. One transaction
          collects everything through the module's <code>redeemMany</code>.
        </p>
      </section>

      <div className="bar">
        <input style={{ width: 420, maxWidth: "100%" }} placeholder="0x… any wallet, or connect yours" value={addr} onChange={(e) => setAddr(e.target.value.trim())} />
        {!wallet && (
          <button className="btn amber" onClick={connect}>
            Connect wallet
          </button>
        )}
        {wallet && !isAddress(addr) && (
          <span className="tag">
            showing <b>{short(wallet.address)}</b>
          </span>
        )}
        <span className="sp" />
        {target && (
          <a className="mini" href={addrUrl(target)} target="_blank" rel="noreferrer">
            explorer ↗
          </a>
        )}
      </div>

      {!target && <div className="note">Paste an address or connect a wallet.</div>}
      {target && loading && !pos && <div className="note">Reading balances on chain…</div>}

      {pos && (
        <>
          <div className="tiles">
            <div className="tile">
              <div className="k">claimable now</div>
              <div className="v amber">{usd(total)}</div>
              <div className="s">tUSDC across {pos.claimable.length} window{pos.claimable.length === 1 ? "" : "s"}</div>
            </div>
            <div className="tile">
              <div className="k">open positions</div>
              <div className="v">{pos.open.length}</div>
              <div className="s">{usd(pos.open.reduce((a, c) => a + c.tokens, 0n))} contracts still trading</div>
            </div>
            <div className="tile">
              <div className="k">action</div>
              <div style={{ marginTop: 6 }}>
                {mine ? (
                  <button className="btn amber" disabled={busy || pos.claimable.length === 0} onClick={claimAll}>
                    {busy ? "Claiming…" : pos.claimable.length ? `Claim all · ${usd(total)} tUSDC` : "Nothing to claim"}
                  </button>
                ) : (
                  <span className="dim mini">{wallet ? "Connect as this wallet to claim" : "Connect to claim your own"}</span>
                )}
              </div>
              {lastTx && (
                <div className="s">
                  <a href={txUrl(lastTx)} target="_blank" rel="noreferrer">
                    last claim tx ↗
                  </a>
                </div>
              )}
            </div>
          </div>

          <h3 style={{ fontFamily: "var(--sans)", fontSize: 13, margin: "16px 0 6px" }}>Settled, not yet redeemed</h3>
          <div className="wrapx">
            <table className="tbl">
              <thead>
                <tr>
                  <th>closed</th>
                  <th>series</th>
                  <th>held</th>
                  <th className="r">tokens</th>
                  <th className="r">payout</th>
                  <th className="r">redeems for</th>
                  <th>market</th>
                </tr>
              </thead>
              <tbody>
                {pos.claimable.map((c) => (
                  <tr key={c.m.marketId + c.side}>
                    <td>{dateShort(c.m.expiry)}</td>
                    <td>
                      {c.m.asset} {c.m.intervalSec / 60}m
                    </td>
                    <td>
                      <span className={`side ${c.side === 0 ? "up" : "down"}`}>{sideName(c.side)}</span> {c.m.voided ? <span className="dim">(voided)</span> : ""}
                    </td>
                    <td className="r">{usd(c.tokens)}</td>
                    <td className="r">{(c.m.payoutFrac[c.side] ?? 0).toFixed(2)}</td>
                    <td className="r amt">{usd(c.amount)}</td>
                    <td className="mini">
                      <a href={addrUrl(c.m.market)} target="_blank" rel="noreferrer">
                        {short(c.m.market)}
                      </a>
                    </td>
                  </tr>
                ))}
                {pos.claimable.length === 0 && (
                  <tr>
                    <td colSpan={7} className="dim">
                      Nothing settled and unredeemed for this wallet in the indexed range.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <h3 style={{ fontFamily: "var(--sans)", fontSize: 13, margin: "16px 0 6px" }}>Open positions</h3>
          <div className="wrapx">
            <table className="tbl">
              <thead>
                <tr>
                  <th>closes</th>
                  <th>series</th>
                  <th>side</th>
                  <th className="r">contracts</th>
                  <th>phase</th>
                </tr>
              </thead>
              <tbody>
                {pos.open.map((c) => (
                  <tr key={c.m.marketId + c.side}>
                    <td>{hhmm(c.m.expiry)} UTC</td>
                    <td>
                      {c.m.asset} {c.m.intervalSec / 60}m
                    </td>
                    <td className={`side ${c.side === 0 ? "up" : "down"}`}>{sideName(c.side)}</td>
                    <td className="r">{usd(c.tokens)}</td>
                    <td>
                      <span className={`pill ${c.m.phase}`}>{c.m.phase}</span>
                    </td>
                  </tr>
                ))}
                {pos.open.length === 0 && (
                  <tr>
                    <td colSpan={5} className="dim">
                      No open positions.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
