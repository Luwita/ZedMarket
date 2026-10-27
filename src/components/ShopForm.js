import { useState } from 'react';
import { compressImage } from '../utils/image';
import { categories, momoNetworks } from '../data/catalog';
import { shopCouriers as couriers } from '../data/couriers';
import { DEFAULT_LOCATION } from '../data/zambia';
import LocationFields from './LocationFields';
import { currentPosition, mapLink } from '../utils/geo';

const PHONE = /^(\+?260|0)?[79]\d{8}$/;

const NRC = /^\d{6}\/\d{2}\/\d$/;

const empty = {
  ownerName: '',
  nrc: '',
  pacra: '',
  name: '',
  phone: '',
  category: '',
  ...DEFAULT_LOCATION,
  area: '',
  couriers: ['pickup', 'seller', 'yango', 'platinum'],
  ownRates: { town: 30, province: 90 },
  momoNetwork: '',
  momoNumber: '',
  momoName: '',
};

// Shop details form used for registration and for editing settings later.
export default function ShopForm({ initial, onSubmit, submitLabel, withOwner = false }) {
  const [form, setForm] = useState({
    ...empty,
    ...initial,
    category: initial?.category ?? '',
    area: initial?.area ?? '',
    ownRates: initial?.ownRates ?? empty.ownRates,
    tpin: initial?.tpin ?? '',
    vatRegistered: initial?.vatRegistered ?? false,
    banner: initial?.banner ?? '',
    about: initial?.about ?? '',
    openingHours: initial?.openingHours ?? '',
    momoNetwork: initial?.momoNetwork ?? '',
    momoNumber: initial?.momoNumber ?? '',
    momoName: initial?.momoName ?? '',
    lat: initial?.lat ?? null,
    lng: initial?.lng ?? null,
  });
  const [locating, setLocating] = useState(false);
  const locate = async () => {
    setLocating(true);
    try {
      const pos = await currentPosition();
      setForm((f) => ({ ...f, ...pos }));
      setErrors((er) => ({ ...er, position: null }));
    } catch (err) {
      setErrors((er) => ({ ...er, position: err.message }));
    } finally {
      setLocating(false);
    }
  };
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const toggleCourier = (id) =>
    setForm((f) => ({
      ...f,
      couriers: f.couriers.includes(id) ? f.couriers.filter((c) => c !== id) : [...f.couriers, id],
    }));

  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (withOwner && form.ownerName.trim().length < 4) errs.ownerName = 'Enter your full name as on your NRC';
    if (withOwner && !NRC.test(form.nrc.trim())) errs.nrc = 'Enter your NRC number like 123456/78/1';
    if (!form.name.trim()) errs.name = 'Enter your shop name';
    if (!PHONE.test(form.phone.replace(/\s/g, ''))) errs.phone = 'Enter a valid Zambian number';
    if (!form.area.trim()) errs.area = 'Enter your street, market or area';
    if (form.tpin && !/^\d{10}$/.test(form.tpin.trim())) errs.tpin = 'A TPIN has 10 digits';
    if (!form.momoNetwork) errs.momoNetwork = 'Choose the network';
    if (!PHONE.test(form.momoNumber.replace(/\s/g, ''))) errs.momoNumber = 'Enter your Mobile Money number';
    if (form.momoName.trim().length < 3) errs.momoName = 'Enter the name the number is registered in';
    if (!form.couriers.some((c) => c !== 'pickup')) errs.couriers = 'Choose at least one delivery option';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const { ownerName, nrc, pacra, ...shop } = form;
    const category = categories.find((c) => c.id === shop.category);
    setSaving(true);
    try {
      await onSubmit(
        { ...shop, logo: category?.icon ?? shop.logo ?? '🏪' },
        { name: ownerName.trim(), phone: form.phone, nrc: nrc.trim(), pacra: pacra.trim() },
      );
    } catch (err) {
      setErrors({ form: err.message });
    } finally {
      setSaving(false);
    }
  };

  const input = (key, label, props = {}) => (
    <div className="field">
      <label htmlFor={`shop-${key}`}>{label}</label>
      <input
        id={`shop-${key}`}
        value={form[key]}
        onChange={set(key)}
        className={errors[key] ? 'invalid' : ''}
        {...props}
      />
      {errors[key] && <span className="error">{errors[key]}</span>}
    </div>
  );

  return (
    <form onSubmit={submit} noValidate>
      {withOwner && (
        <>
          <h3>About you</h3>
          <p className="muted small">
            Zed Market reviews every new shop before buyers can see it, usually within 2 working days. Your NRC is only
            used for this check and is never shown to buyers.
          </p>
          <div className="form-grid">
            {input('ownerName', 'Your full name (as on your NRC)', { autoComplete: 'name' })}
            {input('nrc', 'NRC number', { placeholder: '123456/78/1' })}
            {input('pacra', 'PACRA registration (if registered)', {})}
          </div>
        </>
      )}
      <h3>Shop details</h3>
      <div className="form-grid">
        {input('name', 'Shop name', { placeholder: 'e.g. Mwansa General Dealers' })}
        {input('phone', 'Phone (WhatsApp)', { type: 'tel', placeholder: '097 123 4567' })}
        <div className="field">
          <label htmlFor="shop-category">Main category</label>
          <select id="shop-category" value={form.category} onChange={set('category')}>
            <option value="">Mixed / general</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <h3>Shop location</h3>
      <div className="form-grid">
        <LocationFields
          value={{ province: form.province, town: form.town }}
          onChange={(loc) => setForm((f) => ({ ...f, ...loc }))}
          idPrefix="shop"
        />
      </div>
      {input('area', 'Street, market or area', { placeholder: 'e.g. Shop 14, Kamwala Market' })}
      <div className="field">
        <span className="label">Shop's position on the map (for Yango prices)</span>
        <p className="muted small">
          Press this while you are at your shop. Yango charges by distance, so buyers then see the exact delivery
          price to their door.
        </p>
        <div className="pdp-buttons">
          <button type="button" className="btn btn-outline btn-sm" onClick={locate} disabled={locating}>
            {locating ? 'Finding your location…' : form.lat != null ? 'Update to where I am now' : 'Use my current location'}
          </button>
          {form.lat != null && (
            <a className="link small" href={mapLink(form)} target="_blank" rel="noreferrer">
              Saved: check it on the map
            </a>
          )}
        </div>
        {errors.position && <span className="error">{errors.position}</span>}
      </div>

      <h3>Getting paid</h3>
      <p className="muted small">
        Buyers who pay by Mobile Money send the money straight to this number, and you confirm it has arrived before
        you send the parcel. Buyers only see the number after they order from you. Give the name the number is
        registered in, so they can check it before they send.
      </p>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="shop-momoNetwork">Mobile Money network</label>
          <select
            id="shop-momoNetwork"
            value={form.momoNetwork}
            onChange={set('momoNetwork')}
            className={errors.momoNetwork ? 'invalid' : ''}
          >
            <option value="">Choose…</option>
            {momoNetworks.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </select>
          {errors.momoNetwork && <span className="error">{errors.momoNetwork}</span>}
        </div>
        {input('momoNumber', 'Mobile Money number', { type: 'tel', placeholder: '097 123 4567' })}
        {input('momoName', 'Name the number is registered in', { placeholder: 'e.g. Mwansa Banda' })}
      </div>

      <h3>Your shop page</h3>
      <p className="muted small">Make your page look like your shop. Buyers see this when they open your shop.</p>
      <div className="field">
        <span className="label">Cover photo (optional)</span>
        {form.banner ? (
          <div className="banner-preview" style={{ backgroundImage: `url(${form.banner})` }}>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setForm((f) => ({ ...f, banner: '' }))}>
              Remove
            </button>
          </div>
        ) : (
          <input
            type="file"
            accept="image/*"
            aria-label="Cover photo"
            onChange={async (e) => {
              const file = e.target.files[0];
              if (!file) return;
              try {
                const banner = await compressImage(file, 1200, 0.7);
                setForm((f) => ({ ...f, banner }));
              } catch (err) {
                setErrors((er) => ({ ...er, banner: err.message }));
              }
            }}
          />
        )}
        {errors.banner && <span className="error">{errors.banner}</span>}
      </div>
      {input('openingHours', 'Opening hours', { placeholder: 'e.g. Mon–Sat 08:00–18:00, Sun closed' })}
      <div className="field">
        <label htmlFor="shop-about">About your shop</label>
        <textarea
          id="shop-about"
          rows="3"
          maxLength={1000}
          value={form.about}
          onChange={set('about')}
          placeholder="What you sell, how long you've been trading, what makes you different…"
        />
      </div>

      <h3>Tax details (optional)</h3>
      <p className="muted small">Shown on your customers' receipts.</p>
      <div className="form-grid">
        {input('tpin', 'TPIN', { inputMode: 'numeric', placeholder: '10 digits' })}
        <label className="check">
          <input
            type="checkbox"
            checked={form.vatRegistered}
            onChange={(e) => setForm((f) => ({ ...f, vatRegistered: e.target.checked }))}
          />
          Registered for VAT (prices include 16% VAT)
        </label>
      </div>

      <h3>How do you deliver?</h3>
      <p className="muted small">Buyers will see these options with prices to their town.</p>
      <div className="courier-pick">
        {couriers.filter((c) => !c.disabled).map((c) => (
          <label key={c.id} className={`pay-option ${form.couriers.includes(c.id) ? 'on' : ''}`}>
            <input type="checkbox" checked={form.couriers.includes(c.id)} onChange={() => toggleCourier(c.id)} />
            <span className="pay-icon">{c.icon}</span>
            <span>
              <strong>{c.name}</strong>
              <span className="muted small block">{c.description}</span>
            </span>
          </label>
        ))}
      </div>
      {errors.couriers && <span className="error">{errors.couriers}</span>}

      {form.couriers.includes('seller') && (
        <div className="form-grid">
          <div className="field">
            <label htmlFor="rate-town">Your delivery fee, same town (K)</label>
            <input
              id="rate-town"
              type="number"
              min="0"
              value={form.ownRates.town}
              onChange={(e) => setForm((f) => ({ ...f, ownRates: { ...f.ownRates, town: e.target.value } }))}
            />
          </div>
          <div className="field">
            <label htmlFor="rate-prov">Other towns in your province (K), blank = don't deliver</label>
            <input
              id="rate-prov"
              type="number"
              min="0"
              value={form.ownRates.province}
              onChange={(e) => setForm((f) => ({ ...f, ownRates: { ...f.ownRates, province: e.target.value } }))}
            />
          </div>
        </div>
      )}

      {errors.form && <p className="error">{errors.form}</p>}
      <button className="btn btn-primary btn-lg btn-block" disabled={saving}>
        {saving ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}
