import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../context/StoreContext';

export const date = (d) => new Date(d).toLocaleDateString('en-ZM', { day: 'numeric', month: 'short', year: 'numeric' });

// A button that asks for a reason before acting. The reason is shown to the person affected and logged.
export function ReasonButton({ label, placeholder = 'Reason', danger = false, onConfirm }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  if (!open) {
    return (
      <button className={`btn btn-sm ${danger ? 'btn-danger' : 'btn-outline'}`} onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }
  return (
    <span className="reason-inline">
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={placeholder}
        aria-label={`${label}: reason`}
        autoFocus
      />
      <button
        className={`btn btn-sm ${danger ? 'btn-danger' : 'btn-primary'}`}
        disabled={busy || reason.trim().length < 3}
        onClick={async () => {
          setBusy(true);
          const ok = await onConfirm(reason.trim());
          setBusy(false);
          if (ok) {
            setOpen(false);
            setReason('');
          }
        }}
      >
        Confirm
      </button>
      <button className="link-btn" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </span>
  );
}

// Loads a list and offers a way to run an action then reload.
// `filters` lists the values the loader depends on; the list reloads when they change.
export function useAdminList(load, filters) {
  const { notify, reloadCatalog } = useStore();
  const [items, setItems] = useState(null);
  const latestLoad = useRef(load);
  latestLoad.current = load;
  const key = JSON.stringify(filters);
  const reload = useCallback(
    () =>
      latestLoad
        .current()
        .then(setItems)
        .catch((err) => notify(err.message)),
    [notify],
  );
  useEffect(() => {
    reload();
  }, [reload, key]);
  const run = async (fn, message) => {
    try {
      await fn();
      notify(message);
      await reload();
      // The rest of the app keeps the shop list from when it opened; reload it so a deleted, suspended or newly
      // approved shop disappears from (or appears on) the Shops page and product pages straight away.
      reloadCatalog();
      return true;
    } catch (err) {
      notify(err.message);
      return false;
    }
  };
  return { items, run, reload };
}

export function SearchBox({ value, onChange, placeholder, children }) {
  return (
    <div className="admin-filters">
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label="Search"
      />
      {children}
    </div>
  );
}
