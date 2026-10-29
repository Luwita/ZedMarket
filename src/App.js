import { useEffect } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigationType, useParams } from 'react-router-dom';
import './App.css';
import './marketplace.css';
import './phase2.css';
import './phase3.css';
import './admin.css';
import './features.css';
import './responsive.css';
import './mobile.css';
import './modern.css';
import Footer from './components/Footer';
import Header from './components/Header';
import TabBar from './components/TabBar';
import { useIsPhone } from './phone';
import { StoreProvider, useStore } from './context/StoreContext';
import Account from './pages/Account';
import Cart from './pages/Cart';
import Checkout from './pages/Checkout';
import Home from './pages/Home';
import HomeApp from './pages/HomeApp';
import Login from './pages/Login';
import SsoCallback from './pages/SsoCallback';
import Delivery from './pages/Delivery';
import { Receipt, Statement } from './pages/Documents';
import Legal from './pages/Legal';
import Messages from './pages/Messages';
import Admin from './pages/Admin';
import { RequestBoard, RequestDetail } from './pages/BuyingRequests';
import Help from './pages/Help';
import Notifications from './pages/Notifications';
import CasePage from './pages/CasePage';
import Categories from './pages/Categories';
import OrderSuccess from './pages/OrderSuccess';
import ProductDetail from './pages/ProductDetail';
import Sell from './pages/Sell';
import SellerDashboard from './pages/SellerDashboard';
import Shop from './pages/Shop';
import Stores, { StorePage } from './pages/Stores';

// New screens start at the top; going back returns to where you were (e.g. the same spot in a product list).
const scrollPositions = new Map();

function ScrollManager() {
  const { pathname, search, hash, key } = useLocation();
  const type = useNavigationType();

  useEffect(() => {
    const remember = () => scrollPositions.set(key, window.scrollY);
    window.addEventListener('scroll', remember, { passive: true });
    return () => window.removeEventListener('scroll', remember);
  }, [key]);

  useEffect(() => {
    if (hash) {
      document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth' });
      return undefined;
    }
    const saved = type === 'POP' ? scrollPositions.get(key) : 0;
    if (!saved) {
      window.scrollTo(0, 0);
      return undefined;
    }
    // The list is fetched again after going back, so wait until the page is tall enough.
    let tries = 0;
    const timer = setInterval(() => {
      const tallEnough = document.documentElement.scrollHeight >= saved + window.innerHeight;
      if (tallEnough || ++tries > 30) {
        window.scrollTo(0, saved);
        clearInterval(timer);
      }
    }, 50);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, search, hash]);
  return null;
}

function OfflineNotice() {
  const { online } = useStore();
  return online ? null : (
    <div className="status-bar offline-bar" role="status">
      You're offline. Pages you've already opened still work; orders and messages need a connection.
    </div>
  );
}

function CatalogStatus() {
  const { catalogStatus, catalogError, reloadCatalog } = useStore();
  if (catalogStatus === 'loading') return <div className="status-bar">Loading products…</div>;
  if (catalogStatus === 'error') {
    return (
      <div className="status-bar error-bar" role="alert">
        {catalogError}{' '}
        <button className="link-btn" onClick={reloadCatalog}>
          Try again
        </button>
      </div>
    );
  }
  return null;
}

function Toast() {
  const { toast } = useStore();
  return toast ? (
    <div className="toast" role="status">
      {toast}
    </div>
  ) : null;
}

// Re-mount the product page when the id changes so quantity state resets.
function ProductRoute() {
  const { id } = useParams();
  return <ProductDetail key={id} />;
}

function NotFound() {
  return (
    <div className="container section card empty">
      <h2>Page not found</h2>
      <Link to="/" className="btn btn-primary">
        Go home
      </Link>
    </div>
  );
}

export default function App() {
  const phone = useIsPhone();
  return (
    <StoreProvider>
      <BrowserRouter>
        <ScrollManager />
        <Header />
        <main>
          <OfflineNotice />
          <CatalogStatus />
          <Routes>
            <Route path="/" element={phone ? <HomeApp /> : <Home />} />
            <Route path="/shop" element={<Shop />} />
            <Route path="/categories" element={<Categories />} />
            <Route path="/wholesale" element={<Shop wholesale />} />
            <Route path="/product/:id" element={<ProductRoute />} />
            <Route path="/cart" element={<Cart />} />
            <Route path="/checkout" element={<Checkout />} />
            <Route path="/order/:id" element={<OrderSuccess />} />
            <Route path="/order/:id/receipt" element={<Receipt />} />
            <Route path="/seller/statement" element={<Statement />} />
            <Route path="/messages" element={<Messages />} />
            <Route path="/cases/:id" element={<CasePage />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/messages/:id" element={<Messages />} />
            <Route path="/legal/:doc" element={<Legal />} />
            <Route path="/terms" element={<Navigate to="/legal/terms" replace />} />
            <Route path="/privacy" element={<Navigate to="/legal/privacy" replace />} />
            <Route path="/sell" element={<Sell />} />
            <Route path="/seller" element={<SellerDashboard />} />
            <Route path="/stores" element={<Stores />} />
            <Route path="/store/:id" element={<StorePage />} />
            <Route path="/delivery" element={<Delivery />} />
            <Route path="/logistics" element={<Navigate to="/delivery" replace />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/help" element={<Help />} />
            <Route path="/help/:id" element={<Help />} />
            <Route path="/requests" element={<RequestBoard />} />
            <Route path="/requests/:id" element={<RequestDetail />} />
            <Route path="/login" element={<Login />} />
            <Route path="/sso-callback" element={<SsoCallback />} />
            <Route path="/account" element={<Account />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
        {phone ? <TabBar /> : <Footer />}
        <Toast />
      </BrowserRouter>
    </StoreProvider>
  );
}
