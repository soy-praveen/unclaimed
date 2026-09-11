import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { connectWallet, silentWallet, short, type Wallet } from "./chain";
import { loadSnapshot, refreshPhases, type Snapshot } from "./data";
import Overview from "./pages/Overview";
import Claims from "./pages/Claims";
import Holders from "./pages/Holders";

type Ctx = {
  wallet: Wallet | null;
  connect: () => Promise<void>;
  snap: Snapshot | null;
  reload: () => Promise<void>;
  toast: (msg: string, err?: boolean) => void;
};
const AppCtx = createContext<Ctx>(null as any);
export const useApp = () => useContext(AppCtx);

function useRoute() {
  const [hash, setHash] = useState(location.hash || "#/");
  useEffect(() => {
    const on = () => setHash(location.hash || "#/");
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  if (hash.startsWith("#/claims")) return { page: "claims" as const, arg: decodeURIComponent(hash.split("/")[2] || "") };
  if (hash.startsWith("#/holders")) return { page: "holders" as const, arg: "" };
  return { page: "overview" as const, arg: "" };
}

export default function App() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [toastMsg, setToastMsg] = useState<{ msg: string; err: boolean } | null>(null);
  const route = useRoute();

  const toast = useCallback((msg: string, err = false) => {
    setToastMsg({ msg, err });
    setTimeout(() => setToastMsg(null), err ? 8000 : 4000);
  }, []);

  const reload = useCallback(async () => {
    try {
      const s = await loadSnapshot();
      setSnap(s);
      // live phase refresh runs after first paint so the table is never blocked on RPC
      refreshPhases(s.markets, 60)
        .then(() => setSnap({ ...s }))
        .catch(() => {});
    } catch (e: any) {
      toast("Could not load the snapshot: " + (e?.message || e), true);
    }
  }, [toast]);

  useEffect(() => {
    reload();
    silentWallet().then((w) => w && setWallet(w));
    const eth = window.ethereum;
    if (eth?.on) {
      const on = () => silentWallet().then(setWallet);
      eth.on("accountsChanged", on);
      eth.on("chainChanged", on);
    }
    const t = setInterval(() => {
      setSnap((s) => {
        if (s) refreshPhases(s.markets, 40).then(() => setSnap({ ...s })).catch(() => {});
        return s;
      });
    }, 15000);
    return () => clearInterval(t);
  }, [reload]);

  const connect = useCallback(async () => {
    try {
      setWallet(await connectWallet());
    } catch (e: any) {
      toast(e?.shortMessage || e?.message || String(e), true);
    }
  }, [toast]);

  return (
    <AppCtx.Provider value={{ wallet, connect, snap, reload, toast }}>
      <div className="wrap">
        <header className="top">
          <div className="brand">
            <span className="name">
              <b>Unclaimed</b>
            </span>
            <span className="sub">settlement desk for DreamDEX Event Contracts · Somnia Shannon</span>
          </div>
          <nav className="nav">
            <a className={route.page === "overview" ? "on" : ""} href="#/">
              windows
            </a>
            <a className={route.page === "holders" ? "on" : ""} href="#/holders">
              holders
            </a>
            <a className={route.page === "claims" ? "on" : ""} href="#/claims">
              claim desk
            </a>
          </nav>
          <div className="right">
            {snap && (
              <span className="tag">
                snapshot <b>{new Date(snap.generatedAt * 1000).toISOString().slice(11, 16)} UTC</b> · {snap.rangeHours}h · live phases
              </span>
            )}
            {wallet ? (
              <span className="tag">
                <b>{short(wallet.address)}</b>
              </span>
            ) : (
              <button className="btn amber" onClick={connect}>
                Connect
              </button>
            )}
          </div>
        </header>
        {route.page === "overview" && <Overview />}
        {route.page === "holders" && <Holders />}
        {route.page === "claims" && <Claims lookup={route.arg} />}
      </div>
      {toastMsg && <div className={`toast ${toastMsg.err ? "err" : ""}`}>{toastMsg.msg}</div>}
    </AppCtx.Provider>
  );
}
