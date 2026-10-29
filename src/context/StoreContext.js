import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as api from '../api';
import { unitPrice } from '../data/catalog';
import { describeChoice, lineKey } from '../data/options';
import { DEFAULT_LOCATION } from '../data/zambia';
import { applyDeliveryConfig } from '../data/delivery';

const StoreContext = createContext(null);

// Per-device preferences (cart, saved items, location) stay in the browser.
// Shops, products, users and orders live on the server.
function usePersistentState(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored ? JSON.parse(stored) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // storage unavailable (private mode): keep in memory only
    }
  }, [key, value]);
  return [value, setValue];
}

// Photos picked in the browser are data URLs until uploaded; uploaded ones are already /uploads/... URLs.
// A cart line is identified by product, chosen options and (for agreed wholesale prices) the price request.
const cartKey = (line) => `${lineKey(line.id, line.options)}${line.quoteId ? `|q:${line.quoteId}` : ''}`;

const prefersLowData = () => {
  try {
    return !!navigator.connection?.saveData;
  } catch {
    return false;
  }
};

const uploadImages = (images = []) =>
  Promise.all(images.map(async (src) => (src.startsWith('data:') ? (await api.uploadImage(src)).url : src)));

export function StoreProvider({ children }) {
  const [toast, setToast] = useState(null);
  const [cart, setCart] = usePersistentState('zedmarket.cart', []); // [{ id, qty, options, quoteId, quotePrice }]
  const [lowData, setLowData] = usePersistentState('zedmarket.lowData', prefersLowData());
  const [badges, setBadges] = useState({ notifications: 0, messages: 0, toDispatch: 0 });
  const [installPrompt, setInstallPrompt] = useState(null);
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  const [wishlist, setWishlist] = usePersistentState('zedmarket.wishlist', []);
  const [location, setLocation] = usePersistentState('zedmarket.location', DEFAULT_LOCATION);

  const [shopsState, setShopsState] = useState({ shops: [], status: 'loading', error: null });
  // Products seen so far, by id. Lists are fetched page by page; the cache serves the cart and quick lookups.
  const [productCache, setProductCache] = useState({});
  // Bumped after a shop owner changes products so open product lists fetch again.
  const [catalogVersion, setCatalogVersion] = useState(0);
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const pendingWelcome = useRef(null); // sign-up details kept until the emailed code is entered
  const [orders, setOrders] = useState([]);
  const [shopOrders, setShopOrders] = useState([]);
  const [ordersReady, setOrdersReady] = useState(false);

  const loadShops = useCallback(async () => {
    try {
      // Courier rates and Zed Market Points are applied before any price is shown.
      const [shops, delivery] = await Promise.all([api.getShops(), api.delivery().catch(() => null)]);
      if (delivery) applyDeliveryConfig(delivery);
      setShopsState({ shops, status: 'ready', error: null });
    } catch (err) {
      setShopsState((s) => ({ ...s, status: 'error', error: err.message }));
    }
  }, []);

  const remember = useCallback((products) => {
    if (!products?.length) return;
    setProductCache((cache) => {
      const next = { ...cache };
      products.forEach((p) => (next[p.id] = p));
      return next;
    });
  }, []);

  const loadOrders = useCallback(async (forUser) => {
    if (!forUser) {
      setOrders([]);
      setShopOrders([]);
      return;
    }
    const [mine, forShop] = await Promise.all([api.myOrders(), forUser.shopId ? api.shopOrders() : []]);
    setOrders(mine);
    setShopOrders(forShop);
    setOrdersReady(true);
  }, []);

  // Owners also get their own shop while it waits for approval, so the list depends on who is signed in:
  // reload it whenever that changes (sign in, sign out, switching numbers).
  const userId = user?.id;
  useEffect(() => {
    loadShops();
  }, [loadShops, userId]);

  // Whoever is signed in on this browser (Clerk keeps the session), as a ZedMarket user.
  useEffect(() => {
    api
      .restoreSession()
      .then((signedIn) => (signedIn ? api.me().then(setUser) : null))
      .catch(() => api.setToken(null))
      .finally(() => setAuthReady(true));
  }, []);

  useEffect(() => {
    loadOrders(user).catch(() => {});
  }, [user, loadOrders]);

  // Fetch any cart or saved products not yet in the cache (e.g. after a page reload).
  const wantedIds = useMemo(
    () => [...new Set([...cart.map((l) => l.id), ...wishlist])].sort().join(','),
    [cart, wishlist],
  );
  const [cartStatus, setCartStatus] = useState(wantedIds ? 'loading' : 'ready');
  useEffect(() => {
    if (!wantedIds) {
      setCartStatus('ready');
      return;
    }
    let cancelled = false;
    api
      .searchProducts({ ids: wantedIds, limit: 100 })
      .then((res) => !cancelled && remember(res.items))
      .catch(() => {})
      .finally(() => !cancelled && setCartStatus('ready'));
    return () => {
      cancelled = true;
    };
    // Refetch when the set of ids changes or products were edited, to pick up new prices and stock.
  }, [wantedIds, catalogVersion, remember]);

  // Red dots (notifications, messages, parcels to send): checked every 30 seconds while signed in and visible.
  const refreshUnread = useCallback(() => {
    if (!api.getToken()) return;
    api
      .counts()
      .then(setBadges)
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!user) {
      setBadges({ notifications: 0, messages: 0, toDispatch: 0 });
      return undefined;
    }
    refreshUnread();
    const t = setInterval(() => document.visibilityState !== 'hidden' && refreshUnread(), 30000);
    return () => clearInterval(t);
  }, [user, refreshUnread]);

  // "Install app" button support and offline notice.
  useEffect(() => {
    const onPrompt = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    const onInstalled = () => setInstallPrompt(null);
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(t);
  }, [toast]);

  const value = useMemo(() => {
    const { shops } = shopsState;
    const getShop = (id) => shops.find((s) => s.id === id);
    const getProduct = (id) => productCache[id];
    const myShop = user?.shopId ? getShop(user.shopId) : null;

    // Wholesale tiers count every selected variant of a product together (lines at an agreed price aside).
    const isSelected = (l) => l.selected !== false;
    const totalQty = {};
    cart.forEach((l) => isSelected(l) && !l.quoteId && (totalQty[l.id] = (totalQty[l.id] ?? 0) + l.qty));
    const items = cart
      .map((line) => {
        const product = getProduct(line.id);
        if (!product) return null;
        const price = line.quoteId ? line.quotePrice : unitPrice(product, totalQty[line.id] ?? line.qty);
        return {
          ...line,
          options: line.options ?? {},
          key: cartKey(line),
          selected: isSelected(line),
          choice: describeChoice(line.options),
          product,
          shop: getShop(product.shopId),
          price,
          total: price * line.qty,
        };
      })
      .filter(Boolean);

    const selectedItems = items.filter((i) => i.selected);
    const subtotal = selectedItems.reduce((sum, i) => sum + i.total, 0);
    const retailTotal = selectedItems.reduce((sum, i) => sum + i.product.price * i.qty, 0);

    const refreshMe = async () => {
      const fresh = await api.me();
      setUser(fresh);
      return fresh;
    };
    // Saves the sign-up details (if any), loads the account and greets the person.
    const finishSignIn = async (details, greeting) => {
      if (details) await api.welcome(details);
      const signedIn = await refreshMe();
      setToast(`${greeting}, ${signedIn.name.split(' ')[0]}!`);
      return signedIn;
    };
    const catalogChanged = () => {
      setCatalogVersion((v) => v + 1);
      loadShops();
    };

    return {
      catalogStatus: shopsState.status,
      catalogError: shopsState.error,
      reloadCatalog: loadShops,
      catalogVersion,
      shops,
      getShop,
      getProduct,
      remember,

      location,
      setLocation(loc) {
        setLocation(loc);
        setToast(`Showing shops and delivery prices for ${loc.town}`);
      },

      items,
      selectedItems,
      cartStatus,
      subtotal,
      wholesaleSavings: retailTotal - subtotal,
      cartCount: items.reduce((n, i) => n + i.qty, 0),
      addToCart(product, qty = 1, options = {}) {
        remember([product]);
        const key = cartKey({ id: product.id, options });
        setCart((prev) => {
          const existing = prev.find((l) => cartKey(l) === key);
          if (existing) return prev.map((l) => (l === existing ? { ...l, qty: l.qty + qty } : l));
          return [...prev, { id: product.id, qty, options }];
        });
        const choice = describeChoice(options);
        setToast(`Added ${qty} × ${product.name}${choice ? ` (${choice})` : ''} to cart`);
      },
      // A wholesale price was agreed for an exact quantity, so those lines keep their quantity.
      addAgreedPrice(request) {
        setCart((prev) => [
          ...prev.filter((l) => l.quoteId !== request.id),
          {
            id: request.productId,
            qty: request.qty,
            options: request.options ?? {},
            quoteId: request.id,
            quotePrice: request.quotedPrice,
          },
        ]);
        setToast(`Added ${request.qty} × ${request.productName} at your agreed price`);
      },
      setQty(key, qty) {
        setCart((prev) =>
          qty <= 0
            ? prev.filter((l) => cartKey(l) !== key)
            : prev.map((l) => (cartKey(l) === key && !l.quoteId ? { ...l, qty } : l)),
        );
      },
      removeFromCart(key) {
        setCart((prev) => prev.filter((l) => cartKey(l) !== key));
      },
      toggleSelected(key) {
        setCart((prev) => prev.map((l) => (cartKey(l) === key ? { ...l, selected: l.selected === false } : l)));
      },
      selectAll(selected) {
        setCart((prev) => prev.map((l) => ({ ...l, selected })));
      },
      removeSelected() {
        setCart((prev) => prev.filter((l) => l.selected === false));
      },
      // Moves the selected products to Saved items.
      saveSelectedForLater() {
        const ids = cart.filter(isSelected).map((l) => l.id);
        setWishlist((prev) => [...new Set([...prev, ...ids])]);
        setCart((prev) => prev.filter((l) => l.selected === false));
        setToast(`Moved ${ids.length} item${ids.length === 1 ? '' : 's'} to Saved`);
      },
      // Adds every item of a past order back to the cart ("Buy again").
      buyAgain(order) {
        // Agreed wholesale prices were one-off, so those items come back at the normal price.
        const lines = order.shipments.flatMap((s) => s.items);
        setCart((prev) => {
          let next = prev;
          for (const i of lines) {
            const options = Object.fromEntries(
              (i.options || '')
                .split(', ')
                .filter(Boolean)
                .map((pair) => pair.split(': '))
            );
            const key = cartKey({ id: i.id, options });
            next = next.some((l) => cartKey(l) === key)
              ? next.map((l) => (cartKey(l) === key ? { ...l, qty: l.qty + i.qty } : l))
              : [...next, { id: i.id, qty: i.qty, options }];
          }
          return next;
        });
        setToast('Added to your cart');
      },

      // ----- Messages -----
      unreadMessages: badges.messages,
      notificationCount: badges.notifications,
      toDispatchCount: badges.toDispatch,
      refreshUnread,

      // ----- Phone app & low-data mode -----
      lowData,
      setLowData,
      online,
      canInstall: !!installPrompt,
      async install() {
        if (!installPrompt) return;
        installPrompt.prompt();
        await installPrompt.userChoice.catch(() => {});
        setInstallPrompt(null);
      },

      wishlist,
      toggleWishlist(product) {
        remember([product]);
        setWishlist((prev) =>
          prev.includes(product.id) ? prev.filter((x) => x !== product.id) : [...prev, product.id],
        );
      },

      // ----- Sign-in -----
      user,
      authReady,
      // New account: email and password at Clerk, which emails a code to confirm the address (`needsCode`; send it to
      // `verifyCode`). Then the ZedMarket details (name, kind, invite code) are saved.
      async signUp({ name, email, password, accountType, referralCode }) {
        const details = { name, accountType, referralCode: referralCode || undefined };
        const step = await api.signUp({ name, email, password });
        if (step?.needsCode) {
          pendingWelcome.current = details;
          return { needsCode: true };
        }
        return finishSignIn(details, 'Welcome');
      },
      async signIn(credentials) {
        const step = await api.signIn(credentials);
        if (step?.needsCode) {
          pendingWelcome.current = null;
          return { needsCode: true };
        }
        return finishSignIn(null, 'Welcome back');
      },
      // The emailed code for a sign-up or a sign-in from a new device.
      async verifyCode(code) {
        await api.verifyCode(code);
        const details = pendingWelcome.current;
        pendingWelcome.current = null;
        return finishSignIn(details, details ? 'Welcome' : 'Welcome back');
      },
      signInWithGoogle: (returnTo) => api.signInWithGoogle(returnTo),
      // Back from Google: the ZedMarket account is made the first time the signed-in person uses the API.
      finishGoogleSignIn: (go) => api.finishGoogleSignIn(go),
      changePassword: (details) => api.changePassword(details),
      requestPasswordReset: (email) => api.requestPasswordReset(email),
      // Sets a new password with the emailed code, which also signs the person in.
      async resetPassword({ otp, password }) {
        await api.resetPassword({ otp, password });
        const signedIn = await refreshMe();
        setToast('Password changed. Welcome back!');
        return signedIn;
      },
      refreshMe,
      async logout() {
        await api.logout().catch(() => {});
        api.setToken(null);
        setUser(null);
      },
      async deleteAccount() {
        await api.deleteAccount();
        api.setToken(null);
        setUser(null);
        setCart([]);
        setWishlist([]);
        setToast('Your account has been deleted');
      },

      // ----- Shop owners -----
      myShop,
      async registerShop(shop, owner) {
        const created = await api.createShop({
          ...shop,
          banner: (await uploadImages(shop.banner ? [shop.banner] : []))[0] ?? null,
          ownerName: owner?.name,
          ownerFullName: owner?.name,
          nrc: owner?.nrc,
          pacra: owner?.pacra,
        });
        await Promise.all([loadShops(), refreshMe()]);
        setToast(`${created.name} has been sent for review`);
        return created;
      },
      async updateShop(id, patch) {
        const banner = patch.banner ? (await uploadImages([patch.banner]))[0] : patch.banner;
        await api.updateShop(id, { ...patch, ...(banner !== undefined && { banner }) });
        catalogChanged();
        setToast('Shop settings saved');
      },
      async addProduct(data) {
        const created = await api.createProduct({ ...data, images: await uploadImages(data.images) });
        remember([created]);
        catalogChanged();
        setToast(`${created.name} is now live`);
        return created;
      },
      async addProducts(list) {
        const result = await api.bulkCreateProducts(list);
        remember(result.items);
        catalogChanged();
        setToast(`${result.created} products added`);
        return result;
      },
      async updateProduct(id, data) {
        const updated = await api.updateProduct(id, { ...data, images: await uploadImages(data.images) });
        remember([updated]);
        catalogChanged();
        setToast('Product updated');
      },
      async deleteProduct(id) {
        await api.deleteProduct(id);
        setCart((prev) => prev.filter((l) => l.id !== id));
        catalogChanged();
        setToast('Product removed');
      },

      // ----- Orders -----
      orders,
      ordersReady,
      shopOrders,
      reloadOrders: () => loadOrders(user),
      async placeOrder(order) {
        const placed = await api.placeOrder(order);
        setCart((prev) => prev.filter((l) => l.selected === false));
        setOrders((prev) => [placed, ...prev]);
        catalogChanged(); // stock has changed
        return placed;
      },
      async updateShipment(orderId, shopId, patch) {
        const updated = await api.updateShipment(orderId, shopId, patch);
        setShopOrders((prev) => prev.map((o) => (o.id === orderId ? updated : o)));
      },
      async confirmReceived(orderId, shopId) {
        const updated = await api.confirmReceived(orderId, shopId);
        setOrders((prev) => prev.map((o) => (o.id === orderId ? updated : o)));
      },
      async confirmPayment(orderId, shopId) {
        const updated = await api.confirmPayment(orderId, shopId);
        setShopOrders((prev) => prev.map((o) => (o.id === orderId ? updated : o)));
      },

      // ----- Reviews -----
      async reviewItem(review) {
        const created = await api.createReview(review);
        await loadOrders(user);
        catalogChanged(); // ratings have changed
        setToast('Thanks for your review!');
        return created;
      },

      toast,
      notify: setToast,
    };
  }, [
    shopsState,
    productCache,
    catalogVersion,
    cart,
    cartStatus,
    wishlist,
    user,
    authReady,
    orders,
    shopOrders,
    ordersReady,
    location,
    toast,
    badges,
    lowData,
    online,
    installPrompt,
    refreshUnread,
    setLowData,
    loadShops,
    loadOrders,
    remember,
    setCart,
    setWishlist,
    setLocation,
  ]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export const useStore = () => useContext(StoreContext);
