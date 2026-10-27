import { Link } from 'react-router-dom';
import { useStore } from '../context/StoreContext';
import { provinces } from '../data/zambia';

export default function Footer() {
  const { lowData, setLowData, canInstall, install, user } = useStore();
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div>
          <div className="logo logo-light">
            <span className="logo-mark">Z</span>
            <span className="logo-text">
              zed<strong>market</strong>
            </span>
          </div>
          <p className="muted-light">
            Zambia's marketplace for local shops. Buy retail or wholesale from sellers in all 10 provinces, delivered by
            Zambian couriers.
          </p>
          <div className="pay-logos">
            <span>MTN MoMo</span>
            <span>Airtel Money</span>
            <span>Zamtel Kwacha</span>
            <span>Pay on Delivery</span>
          </div>
        </div>
        <div>
          <h4>Shop by province</h4>
          {provinces.map((p) => (
            <Link key={p.id} to={`/shop?prov=${p.id}`}>
              {p.name}
            </Link>
          ))}
        </div>
        <div>
          <h4>Sell</h4>
          {user?.isAdmin ? (
            <Link to="/admin">Admin panel</Link>
          ) : (
            <>
              <Link to="/sell">Open a shop</Link>
              <Link to="/seller">Seller dashboard</Link>
            </>
          )}
          <Link to="/delivery">Delivery partners</Link>
          <Link to="/wholesale">Wholesale</Link>
        </div>
        <div>
          <h4>Help</h4>
          <Link to="/account">My orders</Link>
          <Link to="/legal/returns">Returns & refunds</Link>
          <Link to="/stores">Find a shop</Link>
          <a href="mailto:support@zedmarket.co.zm">support@zedmarket.co.zm</a>
          <a href="tel:+260211000000">+260 211 000 000</a>
          <span className="muted-light">Cairo Road, Lusaka</span>
        </div>
      </div>
      <div className="container footer-tools">
        <label className="check low-data-toggle">
          <input type="checkbox" checked={lowData} onChange={(e) => setLowData(e.target.checked)} />
          Low-data mode: skip photos and load fewer products
        </label>
        {canInstall && (
          <button className="btn btn-light btn-sm" onClick={install}>
            Install the Zed Market app
          </button>
        )}
      </div>
      <div className="container footer-bottom">
        <span>© {new Date().getFullYear()} Zed Market Zambia. All prices in Zambian Kwacha (ZMW).</span>
        <span className="footer-legal">
          <Link to="/legal/terms">Terms</Link>
          <Link to="/legal/privacy">Privacy</Link>
          <Link to="/legal/sellers">Seller terms</Link>
        </span>
      </div>
    </footer>
  );
}
