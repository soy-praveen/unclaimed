import { useMemo, useState } from "react";
import { useApp } from "../App";
import { ADDR, addrUrl, txUrl, short, usd, hhmm, hhmmss, dateShort, ago, price, write, marketAbi, moduleAbi } from "../chain";
import type { Market } from "../data";

const series = (m: Market) => `${m.asset} ${m.intervalSec / 60}m`;
const sideName = (w: number) => (w === 0 ? "UP" : w === 1 ? "DOWN" : "—");

export default function Overview() {
  const { snap, wallet, connect, toast, reload } = useApp();
  const [filter, setFilter] = useState<string>("all");
  const [phase, setPhase] = useState<string>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const rows = useMemo(() => {
    if (!snap) return [];
    return snap.markets.filter((m) => (filter === "all" || series(m) === filter) && (phase === "all" || m.phase === phase || (phase === "unclaimed" && BigInt(m.unclaimed.total) > 0n)));
  }, [snap, filter, phase]);
  // only the DreamDEX BTC/ETH series get filter buttons; other creators' test markets stay reachable under "all series"
  const seriesList = useMemo(() => (snap ? [...new Set(snap.markets.filter((m) => m.asset === "BTC" || m.asset === "ETH").map(series))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) : []), [snap]);

  if (!snap) return <div className="note">Loading the settlement snapshot…</div>;
  const s = snap.stats as Record<string, number | string>;
  const stalled = snap.markets.filter((m) => m.phase === "stalled" || m.phase === "settling");

  const act = async (label: string, fn: () => Promise<unknown>) => {
    if (!wallet) return connect();
    setBusy(label);
    try {
      await fn();
      toast(`${label} sent`);
      await reload();
    } catch (e: any) {
      toast((e?.shortMessage || e?.message || String(e)).split("\n")[0].slice(0, 200), true);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <section className="hero">
        <h1>Every DreamDEX window, how it settled, and who never collected.</h1>
        <p>
          A settled Event Contract pays out only when someone asks it to. Winning tokens sit on the ERC-6909 singleton until their owner redeems. Unclaimed rebuilds the
          settlement picture from chain logs and view calls, flags windows that are stuck after expiry, and lets any wallet collect everything in one transaction.
        </p>
      </section>

      <div className="tiles">
        <div className="tile">
          <div className="k">windows indexed</div>
          <div className="v">{s.windows}</div>
          <div className="s">last {snap.rangeHours}h · {s.withTrades} with positions</div>
        </div>
        <div className="tile">
          <div className="k">resolved</div>
          <div className="v">{s.resolved}</div>
          <div className="s">
            <span className="side up">{s.upWins} up</span> · <span className="side down">{s.downWins} down</span> · {s.voided} voided
          </div>
        </div>
        <div className="tile">
          <div className="k">stuck after expiry</div>
          <div className={`v ${stalled.length ? "down" : "up"}`}>{stalled.length}</div>
          <div className="s">{stalled.length ? "poke or void below" : "oracle is keeping up"}</div>
        </div>
        <div className="tile">
          <div className="k">unclaimed winnings</div>
          <div className="v amber">{usd(String(s.unclaimedTotal))}</div>
          <div className="s">tUSDC · {s.unclaimedPositions} positions · {s.unclaimedHolders} wallets</div>
        </div>
        <div className="tile">
          <div className="k">outcome-token transfers</div>
          <div className="v">{Number(s.transfers).toLocaleString()}</div>
          <div className="s">{usd(String(s.volumeTokens), 0)} contracts moved</div>
        </div>
      </div>

      {stalled.length > 0 && (
        <div className="note red">
          {stalled.length} window{stalled.length > 1 ? "s" : ""} expired without a resolution. Inside the settlement window anyone can poke the oracle; after it, anyone can void the market so both
          sides redeem. Open a row below to act.
        </div>
      )}

      <div className="bar">
        <div className="seg">
          <button className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>
            all series
          </button>
          {seriesList.map((x) => (
            <button key={x} className={filter === x ? "on" : ""} onClick={() => setFilter(x)}>
              {x}
            </button>
          ))}
        </div>
        <div className="seg">
          {["all", "trading", "settling", "stalled", "resolved", "voided", "unclaimed"].map((p) => (
            <button key={p} className={phase === p ? "on" : ""} onClick={() => setPhase(p)}>
              {p}
            </button>
          ))}
        </div>
        <span className="sp" />
        <span className="dim mini">
          blocks {snap.fromBlock}–{snap.toBlock} · {rows.length} rows
        </span>
      </div>

      <div className="wrapx">
        <table className="tbl">
          <thead>
            <tr>
              <th>closes</th>
              <th>series</th>
              <th>strike</th>
              <th>close price</th>
              <th>result</th>
              <th>phase</th>
              <th className="r">backing</th>
              <th className="r">holders</th>
              <th className="r">unclaimed</th>
              <th>contracts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <Row key={m.marketId} m={m} open={open === m.marketId} onToggle={() => setOpen(open === m.marketId ? null : m.marketId)} busy={busy} act={act} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="stalebar">
        Snapshot generated {ago(snap.generatedAt)} by <code>indexer/index.mjs</code> from MarketCreated and ERC-6909 Transfer logs. Phases and payouts of the newest windows are re-read live
        every 15 seconds. Module {short(ADDR.module)} · outcome token {short(ADDR.outcomeToken)}.
      </div>
    </>
  );
}

function Row({ m, open, onToggle, busy, act }: { m: Market; open: boolean; onToggle: () => void; busy: string | null; act: (l: string, f: () => Promise<unknown>) => Promise<void> }) {
  const { wallet } = useApp();
  const strike = Number(m.strike) > 0 ? (Number(m.strike) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
  const close = m.answer ? price(m.answer.value, m.answerDecimals ?? 2) : "";
  const now = Math.floor(Date.now() / 1000);
  return (
    <>
      <tr className={`row ${open ? "open" : ""}`} onClick={onToggle}>
        <td>
          {dateShort(m.expiry)} <span className="dim">UTC</span>
        </td>
        <td>{series(m)}</td>
        <td>{strike || <span className="dim">—</span>}</td>
        <td>{close || <span className="dim">{m.phase === "trading" ? "live" : "—"}</span>}</td>
        <td>
          <span className={`side ${m.resolved ? (m.winner === 0 ? "up" : "down") : m.voided ? "void" : ""}`}>{m.resolved ? sideName(m.winner) : m.voided ? "VOID" : "—"}</span>
        </td>
        <td>
          <span className={`pill ${m.phase}`}>{m.phase}</span>
        </td>
        <td className="r">{usd(m.backing, 0)}</td>
        <td className="r">{m.holders}</td>
        <td className="r">{BigInt(m.unclaimed.total) > 0n ? <span className="amt">{usd(m.unclaimed.total)}</span> : <span className="dim">0</span>}</td>
        <td className="mini">
          <a href={addrUrl(m.market)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
            market
          </a>{" "}
          ·{" "}
          <a href={addrUrl(m.pool)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
            pool
          </a>
        </td>
      </tr>
      {open && (
        <tr className="detail">
          <td colSpan={10}>
            <div className="cols">
              <div className="kv">
                <span className="k">question</span>
                <span className="v">{m.question}</span>
                <span className="k">window</span>
                <span className="v">
                  {hhmmss(m.tradingStart)} → {hhmmss(m.expiry)} UTC · {m.intervalSec / 60} min
                </span>
                <span className="k">marketId</span>
                <span className="v">{m.marketId}</span>
                <span className="k">oracle question</span>
                <span className="v">{m.oracleQuestionId}</span>
                <span className="k">oracle adapter</span>
                <span className="v">
                  {m.adapter ? (
                    <a href={addrUrl(m.adapter)} target="_blank" rel="noreferrer">
                      {m.adapter}
                    </a>
                  ) : (
                    "—"
                  )}
                </span>
                <span className="k">answer</span>
                <span className="v">
                  {m.answer ? `${price(m.answer.value, m.answerDecimals ?? 2)} (raw ${m.answer.value}, ${m.answerDecimals} dp)${m.answer.voided ? " · voided" : ""}` : "not final"}
                </span>
                <span className="k">payout vector</span>
                <span className="v">{m.payout.length ? `[${m.payout.join(", ")}]  →  up ${m.payoutFrac[0]?.toFixed(2)} · down ${m.payoutFrac[1]?.toFixed(2)}` : "empty"}</span>
                <span className="k">settlement window</span>
                <span className="v">
                  {m.settlementWindow}s · voidable from {hhmm(m.voidableAt)} UTC
                </span>
                <span className="k">outcome ids</span>
                <span className="v">
                  up {m.yesId}
                  <br />
                  down {m.noId}
                </span>
                <span className="k">created</span>
                <span className="v">
                  block {m.createdBlock} ·{" "}
                  <a href={txUrl(m.createdTx)} target="_blank" rel="noreferrer">
                    tx
                  </a>
                </span>
              </div>
              <div>
                {(m.phase === "settling" || m.phase === "stalled") && (
                  <div className="note red">
                    Expired {ago(m.expiry)} with no resolution.{" "}
                    {now < m.voidableAt ? "The oracle callback is late; anyone can ask the module to pull the answer again." : "The settlement window has passed; anyone can void this market so both sides redeem at their share."}
                    <div style={{ marginTop: 8 }}>
                      {now < m.voidableAt ? (
                        <button className="btn sm amber" disabled={busy !== null} onClick={() => act("pokeOracle", () => write(wallet!, ADDR.module, moduleAbi, "pokeOracle", [BigInt(m.oracleQuestionId)]))}>
                          {wallet ? "Poke oracle" : "Connect to poke oracle"}
                        </button>
                      ) : (
                        <button className="btn sm amber" disabled={busy !== null} onClick={() => act("voidExpired", () => write(wallet!, m.market, marketAbi, "voidExpired", []))}>
                          {wallet ? "Void expired market" : "Connect to void"}
                        </button>
                      )}
                    </div>
                  </div>
                )}
                <h3 style={{ margin: "0 0 8px", fontFamily: "var(--sans)", fontSize: 13 }}>
                  Unclaimed on this window · {usd(m.unclaimed.total)} tUSDC · {m.unclaimed.count || 0} position{(m.unclaimed.count || 0) === 1 ? "" : "s"}
                </h3>
                {m.unclaimed.holders.length === 0 ? (
                  <div className="dim mini">{m.resolved || m.voided ? "Everyone has collected." : "Not settled yet."}</div>
                ) : (
                  <div className="list">
                    {m.unclaimed.holders.map((h) => (
                      <div className="li" key={h.address + h.side}>
                        <span>
                          <a href={`#/claims/${h.address}`}>{short(h.address)}</a> <span className={`side ${h.side === 0 ? "up" : "down"}`}>{sideName(h.side)}</span>{" "}
                          <span className="dim">{usd(h.tokens)} tokens</span>
                        </span>
                        <span className="amt">{usd(h.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
