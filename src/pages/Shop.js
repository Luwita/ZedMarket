import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon';
import ProductGrid from '../components/ProductGrid';
import { useStore } from '../context/StoreContext';
import { categories, getCategory } from '../data/catalog';
import { getProvince, provinces } from '../data/zambia';
import { useProductSearch } from '../hooks/useProducts';
import { useIsPhone } from '../phone';

export default function Shop({ wholesale = false }) {
  const { location, lowData } = useStore();
  const [params, setParams] = useSearchParams();
  const phone = useIsPhone();
  const [showFilters, setShowFilters] = useState(false); // phones: filters open from a button
  const q = params.get('q') ?? '';
  const cat = params.get('cat') ?? '';
  const prov = params.get('prov') ?? '';
  const town = params.get('town') ?? '';
  const local = params.get('local') === '1';
  const secondHand = params.get('secondHand') === '1';
  const sort = params.get('sort') ?? (q ? 'relevance' : 'nearest');
  const max = Number(params.get('max')) || 0;

  const update = (changes) => {
    const next = new URLSearchParams(params);
    Object.entries(changes).forEach(([key, value]) => (value ? next.set(key, value) : next.delete(key)));
    setParams(next);
  };

  // Filtering, sorting and paging happen on the server.
  const results = useProductSearch({
    q,
    cat,
    prov,
    town,
    local: local ? '1' : '',
    secondHand: secondHand ? '1' : '',
    max: max || '',
    wholesale: wholesale ? '1' : '',
    sort,
    nearProv: location.province,
    nearTown: location.town,
    limit: lowData ? 12 : 24,
  });

  const province = getProvince(prov);
  const where = town ? `in ${town}` : province ? `in ${province.name} Province` : 'across Zambia';
  const title = wholesale
    ? 'Wholesale marketplace'
    : q
      ? `Results for “${q}”`
      : cat
        ? getCategory(cat)?.name
        : 'All products';
  const isNearMe = prov === location.province && town === location.town;
  const filterCount = [cat, prov, max, local, secondHand].filter(Boolean).length;

  return (
    <div className="container shop">
      {wholesale && (
        <div className="wholesale-banner compact">
          <div>
            <h2>Wholesale prices, Kwacha checkout</h2>
            <p>
              Prices drop automatically when you reach each minimum order quantity (MOQ). Add to cart and adjust
              quantity.
            </p>
          </div>
        </div>
      )}

      <div className="scope-bar">
        <button
          className={isNearMe ? 'on' : ''}
          onClick={() => update({ prov: location.province, town: location.town })}
        >
          <Icon name="pin" size={14} className="inline-icon" />Near me ({location.town})
        </button>
        <button
          className={prov === location.province && !town ? 'on' : ''}
          onClick={() => update({ prov: location.province, town: '' })}
        >
          {getProvince(location.province)?.name} Province
        </button>
        <button className={!prov ? 'on' : ''} onClick={() => update({ prov: '', town: '' })}>
          All Zambia
        </button>
      </div>

      <div className="shop-layout">
        <aside className="card filters" hidden={phone && !showFilters}>
          <h3>Filters</h3>

          <label htmlFor="f-prov">Province</label>
          <select id="f-prov" value={prov} onChange={(e) => update({ prov: e.target.value, town: '' })}>
            <option value="">All provinces</option>
            {provinces.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <label htmlFor="f-town">Town</label>
          <select id="f-town" value={town} disabled={!province} onChange={(e) => update({ town: e.target.value })}>
            <option value="">{province ? `All towns in ${province.name}` : 'Pick a province first'}</option>
            {province?.towns.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>

          <label>Category</label>
          <div className="filter-list">
            <button className={!cat ? 'on' : ''} onClick={() => update({ cat: '' })}>
              All
            </button>
            {categories.map((c) => (
              <button key={c.id} className={cat === c.id ? 'on' : ''} onClick={() => update({ cat: c.id })}>
                {c.icon} {c.name}
              </button>
            ))}
          </div>

          <label htmlFor="max">Max price</label>
          <select id="max" value={max || ''} onChange={(e) => update({ max: e.target.value })}>
            <option value="">Any price</option>
            <option value="250">Under K250</option>
            <option value="500">Under K500</option>
            <option value="1000">Under K1,000</option>
            <option value="5000">Under K5,000</option>
          </select>

          <label className="check">
            <input type="checkbox" checked={local} onChange={(e) => update({ local: e.target.checked ? '1' : '' })} />
            Made in Zambia only
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={secondHand}
              onChange={(e) => update({ secondHand: e.target.checked ? '1' : '' })}
            />
            Second-hand and refurbished only
          </label>

          {(cat || prov || max || q || local || secondHand) && (
            <Link to={wholesale ? '/wholesale' : '/shop'} className="btn btn-outline btn-sm btn-block">
              Clear filters
            </Link>
          )}
          {phone && (
            <button className="btn btn-primary btn-block" onClick={() => setShowFilters(false)}>
              Show {results.total} products
            </button>
          )}
        </aside>

        <section>
          <div className="shop-toolbar">
            <div>
              <h1>{title}</h1>
              <span className="muted">
                {results.loading && !results.items.length ? 'Searching…' : `${results.total} products ${where}`}
              </span>
            </div>
            {phone && (
              <button className={`btn btn-outline btn-sm filter-btn ${showFilters ? 'on' : ''}`} onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters}>
                <Icon name="filter" size={18} /> Filters{filterCount > 0 && ` (${filterCount})`}
              </button>
            )}
            <select value={sort} onChange={(e) => update({ sort: e.target.value })} aria-label="Sort by">
              {q && <option value="relevance">Best match</option>}
              <option value="nearest">Nearest to me</option>
              <option value="popular">Most popular</option>
              <option value="newest">Newest listings</option>
              <option value="deals">Biggest discount</option>
              <option value="price-asc">Price: low to high</option>
              <option value="price-desc">Price: high to low</option>
              <option value="rating">Top rated</option>
            </select>
          </div>

          <ProductGrid
            result={results}
            empty={
              <div className="card empty">
                <p>No products match {town || province ? `in ${town || province.name} yet` : 'your search'}.</p>
                {prov && (
                  <button className="btn btn-outline" onClick={() => update({ prov: '', town: '' })}>
                    Search all of Zambia
                  </button>
                )}
                <Link to="/sell" className="muted small">
                  Have a shop {where}? Start selling →
                </Link>
              </div>
            }
          />
        </section>
      </div>
    </div>
  );
}
