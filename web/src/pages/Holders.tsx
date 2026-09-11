import { useApp } from "../App";
import { addrUrl, short, usd } from "../chain";

export default function Holders() {
  const { snap } = useApp();
  if (!snap) return <div className="note">Loading…</div>;
  const total = BigInt(String(snap.stats.unclaimedTotal));
  return (
    <>
      <section className="hero">
        <h1>Wallets holding winnings they never redeemed.</h1>
        <p>
          Net ERC-6909 balances of the winning side of every settled window in the snapshot, valued at the market's payout vector. The module and settlement contracts are excluded. Click a
          wallet to open it in the claim desk.
        </p>
      </section>
      <div className="wrapx">
        <table className="tbl">
          <thead>
            <tr>
              <th>#</th>
              <th>wallet</th>
              <th className="r">unclaimed tUSDC</th>
              <th className="r">share of total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {snap.holders.map((h, i) => (
              <tr key={h.address} className="row" onClick={() => (location.hash = `#/claims/${h.address}`)}>
                <td className="dim">{i + 1}</td>
                <td>
                  <a href={addrUrl(h.address)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                    {h.address}
                  </a>
                </td>
                <td className="r amt">{usd(h.total)}</td>
                <td className="r dim">{total > 0n ? ((Number(BigInt(h.total)) / Number(total)) * 100).toFixed(1) : "0"}%</td>
                <td className="mini">
                  <a href={`#/claims/${h.address}`}>positions →</a>
                </td>
              </tr>
            ))}
            {snap.holders.length === 0 && (
              <tr>
                <td colSpan={5} className="dim">
                  Nothing unclaimed in this range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="stalebar">
        {short(snap.holders[0]?.address || "")} alone is holding {snap.holders[0] ? usd(snap.holders[0].total) : "0"} tUSDC of settled winnings. A bot that trades for a day and never sweeps looks exactly like this.
      </div>
    </>
  );
}
