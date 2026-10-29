import { useState } from 'react';
import { useStore } from '../context/StoreContext';
import { categories, categoryAliases } from '../data/catalog';
import { downloadCsv, parseCsv } from '../utils/csv';
import { formatK } from '../utils/format';

export const TEMPLATE_HEADERS = [
  'name',
  'category',
  'price',
  'was_price',
  'stock',
  'weight_kg',
  'low_stock_at',
  'made_in_zambia',
  'wholesale',
  'options',
  'description',
];

const EXAMPLE_ROWS = [
  ['200W Solar Panel', 'solar', '1850', '2200', '40', '12', '5', 'no', '10:1650; 50:1540', '', 'Monocrystalline panel'],
  ['Chitenge 6 Yards', 'fashion', '180', '', '300', '1', '20', 'yes', '20:145', 'Pattern=Blue|Red|Gold', ''],
];

const findCategory = (value) => {
  const v = value.trim().toLowerCase();
  return categories.find((c) => c.id === v || c.name.toLowerCase() === v)?.id ?? categoryAliases[v] ?? v;
};

// "10:90; 50:80" -> [{ min: 10, price: 90 }, { min: 50, price: 80 }]
const parseTiers = (text) =>
  text
    .split(';')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => {
      const [min, price] = t.split(':').map((x) => Number(x.trim()));
      return { min, price };
    });

// "Size=S|M|L; Colour=Black|Blue" -> [{ name: 'Size', values: [...] }, ...]
const parseOptions = (text) =>
  text
    .split(';')
    .map((o) => o.trim())
    .filter(Boolean)
    .map((o) => {
      const [name, values = ''] = o.split('=');
      return {
        name: name.trim(),
        values: values
          .split('|')
          .map((v) => v.trim())
          .filter(Boolean),
      };
    });

// Turns spreadsheet rows into products, noting obvious problems before anything is sent.
export function rowsToProducts(rows) {
  const [header, ...body] = rows;
  const cols = header.map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const missing = ['name', 'category', 'price', 'stock'].filter((c) => !cols.includes(c));
  if (missing.length) throw new Error(`The file is missing these columns: ${missing.join(', ')}`);

  return body.map((cells) => {
    const get = (col) => (cells[cols.indexOf(col)] ?? '').trim();
    const product = {
      name: get('name'),
      category: findCategory(get('category')),
      price: Number(get('price')),
      oldPrice: get('was_price') ? Number(get('was_price')) : null,
      stock: Number(get('stock')),
      weightKg: get('weight_kg') ? Number(get('weight_kg')) : 1,
      lowStockAt: get('low_stock_at') ? Number(get('low_stock_at')) : 5,
      local: /^(y|yes|true|1)$/i.test(get('made_in_zambia')),
      tiers: parseTiers(get('wholesale')),
      options: parseOptions(get('options')),
      description: get('description'),
    };
    let error = null;
    if (!product.name) error = 'Missing name';
    else if (!categories.some((c) => c.id === product.category)) error = `Unknown category "${get('category')}"`;
    else if (!(product.price > 0)) error = 'Price must be a number above 0';
    else if (!Number.isInteger(product.stock) || product.stock < 0) error = 'Stock must be a whole number';
    else if (!(product.weightKg > 0)) error = 'Weight must be a number above 0';
    else if (product.tiers.some((t) => !(t.min > 1) || !(t.price > 0))) error = 'Wholesale must look like 10:90; 50:80';
    else if (product.options.some((o) => !o.name || !o.values.length)) error = 'Options must look like Size=S|M|L';
    return { product, error };
  });
}

const readText = (file) =>
  file.text
    ? file.text()
    : new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Could not read the file'));
        reader.readAsText(file);
      });

export default function BulkUpload({ onDone }) {
  const { addProducts } = useStore();
  const [rows, setRows] = useState(null);
  const [fileError, setFileError] = useState(null);
  const [serverError, setServerError] = useState(null);
  const [saving, setSaving] = useState(false);

  const readFile = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setFileError(null);
    setServerError(null);
    try {
      const parsed = parseCsv(await readText(file));
      if (parsed.length < 2) throw new Error('The file has no product rows');
      if (parsed.length > 201) throw new Error('Upload at most 200 products at a time');
      setRows(rowsToProducts(parsed));
    } catch (err) {
      setRows(null);
      setFileError(err.message);
    }
  };

  const upload = async () => {
    setSaving(true);
    setServerError(null);
    try {
      await addProducts(rows.map((r) => r.product));
      setRows(null);
      onDone?.();
    } catch (err) {
      // The server checks every row; show its message next to each one.
      const byRow = Object.fromEntries((err.data?.rows ?? []).map((r) => [r.row, r.error]));
      if (Object.keys(byRow).length) setRows((prev) => prev.map((r, i) => ({ ...r, error: byRow[i + 1] ?? r.error })));
      setServerError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const problems = rows?.filter((r) => r.error).length ?? 0;

  return (
    <div className="bulk">
      <h2>Upload many products at once</h2>
      <ol className="muted small">
        <li>Download the template and fill it in with Excel or Google Sheets. One product per row.</li>
        <li>Save it as CSV (File → Save as → CSV), then choose the file below.</li>
        <li>Check the preview, then publish. Add photos to each product afterwards.</li>
      </ol>
      <div className="pdp-buttons">
        <button
          type="button"
          className="btn btn-outline"
          onClick={() => downloadCsv('zed-market-products-template.csv', [TEMPLATE_HEADERS, ...EXAMPLE_ROWS])}
        >
          ⬇ Download template
        </button>
        <label className="btn btn-primary">
          📄 Choose CSV file
          <input type="file" accept=".csv,text/csv" onChange={readFile} hidden aria-label="CSV file" />
        </label>
      </div>
      <p className="muted small">
        Categories: {categories.map((c) => c.id).join(', ')}. Wholesale: <code>10:90; 50:80</code>. Options:{' '}
        <code>Size=S|M|L; Colour=Black|Blue</code>.
      </p>
      {fileError && <p className="error">{fileError}</p>}

      {rows && (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Name</th>
                  <th>Category</th>
                  <th>Price</th>
                  <th>Stock</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ product, error }, i) => (
                  <tr key={i} className={error ? 'row-error' : ''}>
                    <td>{i + 1}</td>
                    <td>{product.name}</td>
                    <td>{product.category}</td>
                    <td>{product.price > 0 ? formatK(product.price) : '—'}</td>
                    <td>{Number.isFinite(product.stock) ? product.stock : '—'}</td>
                    <td>{error ? <span className="error">{error}</span> : '✓'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {serverError && <p className="error">{serverError}</p>}
          <button className="btn btn-primary btn-lg" disabled={problems > 0 || saving} onClick={upload}>
            {saving
              ? 'Publishing…'
              : problems
                ? `Fix ${problems} row${problems > 1 ? 's' : ''} to continue`
                : `Publish ${rows.length} products`}
          </button>
        </>
      )}
    </div>
  );
}
