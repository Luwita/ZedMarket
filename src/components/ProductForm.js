import { useState } from 'react';
import { categories } from '../data/catalog';
import { compressImage } from '../utils/image';

const MAX_PHOTOS = 4;

const blank = {
  name: '',
  category: '',
  price: '',
  oldPrice: '',
  stock: '',
  weightKg: '',
  lowStockAt: '5',
  description: '',
  local: false,
  images: [],
  tiers: [],
  options: [],
};

export default function ProductForm({ initial, onSubmit, onCancel, submitLabel = 'Publish product' }) {
  const [form, setForm] = useState(() => ({
    ...blank,
    ...initial,
    tiers: (initial?.tiers ?? []).map((t) => ({ min: String(t.min), price: String(t.price) })),
    // Edited as text: "S, M, L".
    options: (initial?.options ?? []).map((o) => ({ name: o.name, values: o.values.join(', ') })),
    weightKg: initial?.weightKg != null ? String(initial.weightKg) : '',
    lowStockAt: initial?.lowStockAt != null ? String(initial.lowStockAt) : '5',
  }));
  const [errors, setErrors] = useState({});
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) =>
    setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const addPhotos = async (e) => {
    const files = [...e.target.files].slice(0, MAX_PHOTOS - form.images.length);
    e.target.value = '';
    if (!files.length) return;
    setUploading(true);
    try {
      const images = await Promise.all(files.map((f) => compressImage(f)));
      setForm((f) => ({ ...f, images: [...f.images, ...images].slice(0, MAX_PHOTOS) }));
      setErrors((er) => ({ ...er, images: undefined }));
    } catch (err) {
      setErrors((er) => ({ ...er, images: err.message }));
    } finally {
      setUploading(false);
    }
  };

  const setTier = (i, key, value) =>
    setForm((f) => ({ ...f, tiers: f.tiers.map((t, j) => (j === i ? { ...t, [key]: value } : t)) }));
  const setOption = (i, key, value) =>
    setForm((f) => ({ ...f, options: f.options.map((o, j) => (j === i ? { ...o, [key]: value } : o)) }));

  const submit = async (e) => {
    e.preventDefault();
    const price = Number(form.price);
    const tiers = form.tiers
      .filter((t) => t.min !== '' || t.price !== '')
      .map((t) => ({ min: Number(t.min), price: Number(t.price) }))
      .sort((a, b) => a.min - b.min);
    const options = form.options
      .map((o) => ({
        name: o.name.trim(),
        values: [
          ...new Set(
            o.values
              .split(',')
              .map((v) => v.trim())
              .filter(Boolean),
          ),
        ],
      }))
      .filter((o) => o.name || o.values.length);

    const errs = {};
    if (!form.name.trim()) errs.name = 'Enter a product name';
    if (!form.category) errs.category = 'Choose a category';
    if (!(price > 0)) errs.price = 'Enter a price in Kwacha';
    if (form.oldPrice && Number(form.oldPrice) <= price) errs.oldPrice = 'Was-price must be higher than the price';
    if (!(Number(form.stock) >= 0) || form.stock === '') errs.stock = 'Enter how many you have';
    if (!(Number(form.weightKg) > 0)) errs.weightKg = 'Enter the weight of one unit in kg, e.g. 0.5';
    if (options.some((o) => !o.name || !o.values.length))
      errs.options = 'Give each option a name and at least one choice, e.g. Size: S, M, L';
    if (
      tiers.some((t, i) => !(t.min > 1) || !(t.price > 0) || t.price >= (i ? tiers[i - 1].price : price)) ||
      new Set(tiers.map((t) => t.min)).size !== tiers.length
    )
      errs.tiers = 'Each wholesale tier needs a minimum quantity above 1 and a price lower than the tier before it';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setSaving(true);
    try {
      await onSubmit({
        name: form.name.trim(),
        category: form.category,
        price,
        oldPrice: form.oldPrice ? Number(form.oldPrice) : null,
        stock: Number(form.stock),
        weightKg: Number(form.weightKg),
        lowStockAt: Number(form.lowStockAt) || 0,
        options,
        description: form.description.trim() || form.name.trim(),
        local: form.local,
        images: form.images,
        tiers,
        ...(form.sourceProductId ? { sourceProductId: form.sourceProductId } : {}),
      });
    } catch (err) {
      setErrors({ form: err.message });
    } finally {
      setSaving(false);
    }
  };

  const input = (key, label, props = {}) => (
    <div className="field">
      <label htmlFor={`pf-${key}`}>{label}</label>
      <input
        id={`pf-${key}`}
        value={form[key] ?? ''}
        onChange={set(key)}
        className={errors[key] ? 'invalid' : ''}
        {...props}
      />
      {errors[key] && <span className="error">{errors[key]}</span>}
    </div>
  );

  return (
    <form onSubmit={submit} noValidate>
      <div className="field">
        <label>Photos (up to {MAX_PHOTOS})</label>
        <div className="upload-grid">
          {form.images.map((src, i) => (
            <div key={i} className="upload-thumb">
              <img src={src} alt={`Product ${i + 1}`} />
              {i === 0 && <span className="upload-main">Main</span>}
              <button
                type="button"
                aria-label="Remove photo"
                onClick={() => setForm((f) => ({ ...f, images: f.images.filter((_, j) => j !== i) }))}
              >
                ×
              </button>
            </div>
          ))}
          {form.images.length < MAX_PHOTOS && (
            <label className="upload-add">
              <input type="file" accept="image/*" multiple onChange={addPhotos} hidden />
              {uploading ? 'Uploading…' : 'Add photos'}
            </label>
          )}
        </div>
        {errors.images && <span className="error">{errors.images}</span>}
      </div>

      {input('name', 'Product name', { placeholder: 'e.g. 200W Solar Panel' })}
      <div className="form-grid">
        <div className="field">
          <label htmlFor="pf-category">Category</label>
          <select
            id="pf-category"
            value={form.category}
            onChange={set('category')}
            className={errors.category ? 'invalid' : ''}
          >
            <option value="">Choose…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon} {c.name}
              </option>
            ))}
          </select>
          {errors.category && <span className="error">{errors.category}</span>}
        </div>
        {input('stock', 'Quantity in stock', { type: 'number', min: 0 })}
        {input('price', 'Price (K)', { type: 'number', min: 0, step: '0.01' })}
        {input('oldPrice', 'Was-price (K), optional', { type: 'number', min: 0, step: '0.01' })}
        {input('weightKg', 'Weight per unit (kg)', { type: 'number', min: 0, step: '0.1', placeholder: 'e.g. 0.5' })}
        {input('lowStockAt', 'Warn me when stock falls to', { type: 'number', min: 0 })}
      </div>
      <p className="muted small">Weight sets the delivery price buyers see. Heavier parcels cost more.</p>

      <div className="field">
        <label htmlFor="pf-description">Description</label>
        <textarea
          id="pf-description"
          rows="4"
          value={form.description}
          onChange={set('description')}
          placeholder="Size, colour, condition, what's included…"
        />
      </div>

      <label className="check">
        <input type="checkbox" checked={form.local} onChange={set('local')} /> Made in Zambia
      </label>

      <div className="field tiers-editor">
        <label>Wholesale prices (optional)</label>
        <p className="muted small">Reward bulk buyers: e.g. 10+ units at K90 each, 50+ units at K80 each.</p>
        {form.tiers.map((t, i) => (
          <div key={i} className="tier-row">
            <input
              type="number"
              min="2"
              placeholder="Min qty"
              value={t.min}
              onChange={(e) => setTier(i, 'min', e.target.value)}
              aria-label="Minimum quantity"
            />
            <span>units or more at K</span>
            <input
              type="number"
              min="0"
              placeholder="Price"
              value={t.price}
              onChange={(e) => setTier(i, 'price', e.target.value)}
              aria-label="Wholesale price"
            />
            <span>each</span>
            <button
              type="button"
              className="link-btn"
              onClick={() => setForm((f) => ({ ...f, tiers: f.tiers.filter((_, j) => j !== i) }))}
            >
              Remove
            </button>
          </div>
        ))}
        {form.tiers.length < 4 && (
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => setForm((f) => ({ ...f, tiers: [...f.tiers, { min: '', price: '' }] }))}
          >
            + Add wholesale price
          </button>
        )}
        {errors.tiers && <span className="error">{errors.tiers}</span>}
      </div>

      <div className="field tiers-editor">
        <label>Options (optional)</label>
        <p className="muted small">
          Let buyers choose, e.g. Size: S, M, L or Colour: Black, Blue. Same price and stock.
        </p>
        {form.options.map((o, i) => (
          <div key={i} className="tier-row">
            <input
              placeholder="Option, e.g. Size"
              value={o.name}
              onChange={(e) => setOption(i, 'name', e.target.value)}
              aria-label="Option name"
            />
            <input
              className="grow"
              placeholder="Choices, separated by commas"
              value={o.values}
              onChange={(e) => setOption(i, 'values', e.target.value)}
              aria-label="Option choices"
            />
            <button
              type="button"
              className="link-btn"
              onClick={() => setForm((f) => ({ ...f, options: f.options.filter((_, j) => j !== i) }))}
            >
              Remove
            </button>
          </div>
        ))}
        {form.options.length < 3 && (
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => setForm((f) => ({ ...f, options: [...f.options, { name: '', values: '' }] }))}
          >
            + Add option
          </button>
        )}
        {errors.options && <span className="error">{errors.options}</span>}
      </div>

      {errors.form && <p className="error">{errors.form}</p>}
      <div className="pdp-buttons">
        <button className="btn btn-primary btn-lg" disabled={uploading || saving}>
          {saving ? 'Saving…' : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-outline btn-lg" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
