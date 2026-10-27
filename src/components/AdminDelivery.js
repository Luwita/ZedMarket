import { useEffect, useState } from 'react';
import * as api from '../api';
import { useStore } from '../context/StoreContext';
import { INCLUDED_KG, couriers } from '../data/couriers';
import { applyDeliveryConfig } from '../data/delivery';
import { getProvince } from '../data/zambia';
import LocationFields from './LocationFields';
import { useAdminList } from './adminKit';

const BANDS = [
  ['town', 'Same town'],
  ['province', 'Same province'],
  ['national', 'Other province'],
];
// What each courier publishes (checked October 2026), so owners know which numbers still need confirming.
const NOTES = {
  pickup: 'The buyer collects from the shop, so there is no fee.',
  seller: "Starting fees for shops' own riders. Each shop can set its own fees in its settings.",
  yango:
    "Priced by distance, like Yango's app. Starting fares are Yango's published Lusaka maximums (yango.com/lusaka/tariff): " +
    'moto K10.17 for the first km then K4.95/km; car K19 for the first 1.5 km then K4.2/km plus K0.8/min. Rush hour can ' +
    'cost more. Same-town only. Without both map positions a typical trip is assumed.',
  platinum:
    'No published rate card. Platinum advertises small parcels "across Zambia for just K30"; bales and heavy items ' +
    'cost more. Ask their office for the per-kg rate.',
  bus: 'Bus companies (Mazhandu, Juldan, Power Tools…) price parcels at the counter by size; nothing is published. ' +
    'Ask at the bus station and enter what you agree.',
  zampost: 'Zampost prices EMS by weight at the post office and publishes no domestic table. Ask your post office.',
  point: 'Offered for every shop, in towns that have an open Zed Market Point.',
};
const VEHICLES = [
  ['moto', 'Motorbike'],
  ['car', 'Car'],
];
const FARE_FIELDS = [
  ['minFare', 'Minimum fare (K)'],
  ['includedKm', 'km included'],
  ['perKm', 'Each extra km (K)'],
  ['perMin', 'Per minute (K)'],
];
const text = (v) => (v === null || v === undefined ? '' : String(v));

function CourierEditor({ courier, saved, isOwner, onSaved }) {
  const { notify } = useStore();
  const [form, setForm] = useState(() => ({
    description: saved.description ?? '',
    rates: Object.fromEntries(BANDS.map(([b]) => [b, text(saved.rates?.[b])])),
    perKg: Object.fromEntries(BANDS.map(([b]) => [b, text(saved.perKg?.[b])])),
    eta: Object.fromEntries(BANDS.map(([b]) => [b, saved.eta?.[b] ?? ''])),
    maxKg: text(saved.maxKg),
    towns: (saved.towns ?? []).join(', '),
    cod: !!saved.cod,
    disabled: !!saved.disabled,
    distance: saved.distance
      ? {
          ...Object.fromEntries(
            VEHICLES.map(([v]) => [v, Object.fromEntries(FARE_FIELDS.map(([k]) => [k, text(saved.distance[v]?.[k])]))]),
          ),
          motoMaxKg: text(saved.distance.motoMaxKg),
          typicalKm: text(saved.distance.typicalKm),
        }
      : null,
  }));
  const setFare = (v, k) => (e) =>
    setForm((f) => ({ ...f, distance: { ...f.distance, [v]: { ...f.distance[v], [k]: e.target.value } } }));
  const [busy, setBusy] = useState(false);
  const setBand = (group, b) => (e) => setForm((f) => ({ ...f, [group]: { ...f[group], [b]: e.target.value } }));
  const id = (k) => `dl-${courier.id}-${k}`;

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const blankToNull = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === '' ? null : v]));
      const body = {
        description: form.description,
        rates: blankToNull(form.rates),
        perKg: blankToNull(form.perKg),
        eta: Object.fromEntries(Object.entries(form.eta).filter(([, v]) => v.trim())),
        maxKg: form.maxKg === '' ? null : form.maxKg,
        cod: form.cod,
        disabled: form.disabled,
        ...(form.distance ? { distance: form.distance } : {}),
        ...(courier.towns || saved.towns ? { towns: form.towns.split(',').map((t) => t.trim()).filter(Boolean) } : {}),
      };
      onSaved(await api.admin.saveCourier(courier.id, body));
      notify(`${courier.name} rates saved`);
    } catch (err) {
      notify(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={`card form-card courier-editor ${form.disabled ? 'off' : ''}`} onSubmit={save}>
      <div className="order-head">
        <h3>
          {courier.icon} {courier.name}
        </h3>
        {saved.confirmed ? (
          <span className="status status-delivered">Saved</span>
        ) : (
          <span className="status status-pending">Starting values, not confirmed</span>
        )}
      </div>
      {NOTES[courier.id] && <p className="muted small">{NOTES[courier.id]}</p>}
      <fieldset disabled={!isOwner} className="plain">
        <div className="field">
          <label htmlFor={id('desc')}>Description shown to buyers</label>
          <input id={id('desc')} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        </div>
        {form.distance ? (
          <>
            <div className="table-wrap">
              <table className="table rate-table">
                <thead>
                  <tr>
                    <th />
                    {VEHICLES.map(([v, label]) => (
                      <th key={v}>{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {FARE_FIELDS.map(([k, label]) => (
                    <tr key={k}>
                      <th scope="row">{label}</th>
                      {VEHICLES.map(([v, vLabel]) => (
                        <td key={v}>
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={form.distance[v][k]}
                            onChange={setFare(v, k)}
                            placeholder={k === 'perMin' ? 'none' : ''}
                            aria-label={`${courier.name} ${vLabel}: ${label}`}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="form-grid">
              <div className="field">
                <label htmlFor={id('motokg')}>Heaviest parcel by motorbike (kg)</label>
                <input
                  id={id('motokg')}
                  type="number"
                  min="0"
                  step="any"
                  value={form.distance.motoMaxKg}
                  onChange={(e) => setForm((f) => ({ ...f, distance: { ...f.distance, motoMaxKg: e.target.value } }))}
                />
              </div>
              <div className="field">
                <label htmlFor={id('typkm')}>Typical trip when a location is missing (km)</label>
                <input
                  id={id('typkm')}
                  type="number"
                  min="0"
                  step="any"
                  value={form.distance.typicalKm}
                  onChange={(e) => setForm((f) => ({ ...f, distance: { ...f.distance, typicalKm: e.target.value } }))}
                />
              </div>
              <div className="field">
                <label htmlFor={id('eta')}>Delivery time</label>
                <input id={id('eta')} value={form.eta.town} onChange={setBand('eta', 'town')} placeholder="e.g. 1–3 hours" />
              </div>
            </div>
          </>
        ) : (
        <div className="table-wrap">
          <table className="table rate-table">
            <thead>
              <tr>
                <th />
                {BANDS.map(([b, label]) => (
                  <th key={b}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Fee up to {INCLUDED_KG} kg (K)</th>
                {BANDS.map(([b, label]) => (
                  <td key={b}>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={form.rates[b]}
                      onChange={setBand('rates', b)}
                      placeholder="not offered"
                      aria-label={`${courier.name} fee, ${label}`}
                    />
                  </td>
                ))}
              </tr>
              <tr>
                <th scope="row">Each extra kg (K)</th>
                {BANDS.map(([b, label]) => (
                  <td key={b}>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={form.perKg[b]}
                      onChange={setBand('perKg', b)}
                      aria-label={`${courier.name} per kg, ${label}`}
                    />
                  </td>
                ))}
              </tr>
              <tr>
                <th scope="row">Delivery time</th>
                {BANDS.map(([b, label]) => (
                  <td key={b}>
                    <input value={form.eta[b]} onChange={setBand('eta', b)} placeholder="e.g. 1–2 days" aria-label={`${courier.name} time, ${label}`} />
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        )}
        {!form.distance && <p className="muted small">Leave a fee blank where this courier doesn't deliver.</p>}
        <div className="form-grid">
          <div className="field">
            <label htmlFor={id('max')}>Heaviest parcel (kg, blank = no limit)</label>
            <input id={id('max')} type="number" min="0" step="any" value={form.maxKg} onChange={(e) => setForm((f) => ({ ...f, maxKg: e.target.value }))} />
          </div>
          {(courier.towns || saved.towns) && (
            <div className="field">
              <label htmlFor={id('towns')}>Towns covered (comma-separated)</label>
              <input id={id('towns')} value={form.towns} onChange={(e) => setForm((f) => ({ ...f, towns: e.target.value }))} />
            </div>
          )}
        </div>
        <label className="check">
          <input type="checkbox" checked={form.cod} onChange={(e) => setForm((f) => ({ ...f, cod: e.target.checked }))} /> Pay on
          delivery possible
        </label>
        <label className="check">
          <input type="checkbox" checked={form.disabled} onChange={(e) => setForm((f) => ({ ...f, disabled: e.target.checked }))} />{' '}
          Switched off (not offered to anyone)
        </label>
        {isOwner && (
          <button className="btn btn-primary btn-sm" disabled={busy}>
            Save {courier.name}
          </button>
        )}
      </fieldset>
    </form>
  );
}

const blankPoint = { id: '', province: 'lusaka', town: 'Lusaka', name: '', address: '', hours: 'Mon–Sat 08:00–17:00', phone: '', active: true };
const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);

function PointsEditor({ saved, confirmed, isOwner, onSaved }) {
  const { notify } = useStore();
  const [points, setPoints] = useState(() => (confirmed ? saved.map(({ example, ...p }) => p) : []));
  const [draft, setDraft] = useState(blankPoint);
  const [busy, setBusy] = useState(false);

  const add = (e) => {
    e.preventDefault();
    if (draft.name.trim().length < 3 || draft.address.trim().length < 3) {
      notify('Give the point a name and an address');
      return;
    }
    const id = slug(`${draft.town}-${draft.name.replace(/zed market point/i, '')}`) || `point-${points.length + 1}`;
    setPoints((list) => [...list, { ...draft, id: list.some((p) => p.id === id) ? `${id}-${list.length + 1}` : id }]);
    setDraft((d) => ({ ...blankPoint, province: d.province, town: d.town }));
  };
  const save = async () => {
    setBusy(true);
    try {
      onSaved(await api.admin.savePoints(points));
      notify('Zed Market Points saved');
    } catch (err) {
      notify(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card form-card">
      <div className="order-head">
        <h3>Zed Market Points</h3>
        {confirmed ? (
          <span className="status status-delivered">Saved</span>
        ) : (
          <span className="status status-pending">Showing {saved.length} example points</span>
        )}
      </div>
      <p className="muted small">
        Collection points where buyers pick up parcels. The example points are only shown while testing on this
        computer; on the live site buyers are offered no points until you save your own list. Closed points are kept
        but not offered.
      </p>
      {points.length > 0 ? (
        <ul className="admin-log">
          {points.map((p, i) => (
            <li key={p.id} className="banner-row">
              <span className="grow">
                <strong>{p.name}</strong> · {p.address}, {p.town} ({getProvince(p.province)?.name})
                <span className="block small muted">
                  {p.hours} {p.phone && `· ${p.phone}`} · code {p.id}
                </span>
              </span>
              {isOwner && (
                <>
                  <label className="check small">
                    <input
                      type="checkbox"
                      checked={p.active}
                      onChange={() => setPoints((list) => list.map((x, j) => (j === i ? { ...x, active: !x.active } : x)))}
                    />{' '}
                    Open
                  </label>
                  <button type="button" className="link-btn danger" onClick={() => setPoints((list) => list.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">{confirmed ? 'No points saved, so the Zed Market Point option is not offered.' : 'No real points added yet.'}</p>
      )}
      {isOwner && (
        <>
          <form className="marketing-form" onSubmit={add}>
            <h4>Add a point</h4>
            <div className="form-grid">
              <LocationFields value={draft} onChange={(loc) => setDraft((d) => ({ ...d, ...loc }))} idPrefix="pt" />
              <div className="field">
                <label htmlFor="pt-name">Name</label>
                <input id="pt-name" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="e.g. Zed Market Point Chisokone" />
              </div>
              <div className="field">
                <label htmlFor="pt-address">Address or landmark</label>
                <input id="pt-address" value={draft.address} onChange={(e) => setDraft((d) => ({ ...d, address: e.target.value }))} />
              </div>
              <div className="field">
                <label htmlFor="pt-hours">Opening hours</label>
                <input id="pt-hours" value={draft.hours} onChange={(e) => setDraft((d) => ({ ...d, hours: e.target.value }))} />
              </div>
              <div className="field">
                <label htmlFor="pt-phone">Phone (optional)</label>
                <input id="pt-phone" type="tel" value={draft.phone} onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))} />
              </div>
            </div>
            <button className="btn btn-outline btn-sm">+ Add to the list</button>
          </form>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            Save Zed Market Points ({points.length})
          </button>
        </>
      )}
    </section>
  );
}

export function DeliverySettings() {
  const { user, reloadCatalog } = useStore();
  const { items } = useAdminList(() => api.admin.delivery(), {});
  const [config, setConfig] = useState(null);
  useEffect(() => {
    if (items) setConfig(items);
  }, [items]);
  if (!config) return <p className="muted">Loading…</p>;
  const isOwner = user?.staffRole === 'owner';
  const onSaved = (next) => {
    setConfig(next);
    applyDeliveryConfig(next);
    reloadCatalog();
  };
  const unconfirmed = couriers.filter((c) => !config.couriers[c.id]?.confirmed).length;

  return (
    <>
      <p className={unconfirmed || !config.pointsConfirmed ? 'review-note' : 'muted small'}>
        {unconfirmed || !config.pointsConfirmed
          ? `${unconfirmed} courier${unconfirmed === 1 ? '' : 's'}${config.pointsConfirmed ? '' : ' and the Zed Market Points'} still use starting values. Enter the rates agreed with each courier and save.`
          : 'All delivery rates and points have been set.'}{' '}
        Changes apply to new orders straight away; past orders keep the fee they were charged.
        {!isOwner && ' Only owners can change these.'}
      </p>
      {couriers.map((c) => (
        <CourierEditor key={c.id} courier={c} saved={config.couriers[c.id] ?? {}} isOwner={isOwner} onSaved={onSaved} />
      ))}
      <PointsEditor saved={config.points} confirmed={config.pointsConfirmed} isOwner={isOwner} onSaved={onSaved} />
    </>
  );
}
