import { useEffect, useState } from 'react';
import { getCategory } from '../data/catalog';
import { useStore } from '../context/StoreContext';
import { discountPct, formatK } from '../utils/format';

// "Share to Status": a ready-made picture of a product (photo, name, price, shop and link), in the tall shape of
// a WhatsApp Status. On phones it goes through the share sheet (WhatsApp → My status); elsewhere it downloads.
// WhatsApp can't be told to open Status from a link, so the picture is the way in. The product link is copied
// as well, for the caption.

const W = 1080;
const H = 1920;
const GREEN = '#0e6b52';
const FONT = "'Inter', -apple-system, 'Segoe UI', Roboto, sans-serif";

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Breaks text into at most `max` lines that fit `width`; the last one ends in … when cut short.
function lines(ctx, text, width, max) {
  const out = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= width) line = next;
    else {
      out.push(line);
      line = word;
      if (out.length === max) break;
    }
  }
  if (out.length < max) out.push(line);
  else {
    let last = out[max - 1];
    while (last && ctx.measureText(`${last}…`).width > width) last = last.slice(0, -1);
    out[max - 1] = `${last}…`;
  }
  return out.filter(Boolean);
}

// Draws the picture and resolves to a PNG blob, or null where the browser can't draw (e.g. very old phones).
async function drawStatus({ product, shop, url }) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext?.('2d');
  if (!ctx) return null;
  await document.fonts?.load(`800 64px Inter`).catch(() => {});

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0a5340');
  bg.addColorStop(0.55, GREEN);
  bg.addColorStop(1, '#2fa37c');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Logo
  roundRect(ctx, 80, 92, 88, 88, 22);
  ctx.fillStyle = '#16825f';
  ctx.fill();
  ctx.fillStyle = '#f2b53a';
  ctx.fillRect(80, 168, 88, 12);
  ctx.fillStyle = '#fff';
  ctx.font = `800 54px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Z', 124, 134);
  ctx.textAlign = 'left';
  ctx.font = `400 56px ${FONT}`;
  ctx.fillText('zed', 190, 136);
  const zed = ctx.measureText('zed').width;
  ctx.font = `800 56px ${FONT}`;
  ctx.fillText('market', 190 + zed, 136);

  // Card
  roundRect(ctx, 60, 250, W - 120, 1330, 44);
  ctx.fillStyle = '#fff';
  ctx.fill();

  // Photo, or the product's picture on a tinted background. A little wider than tall, so two lines of name,
  // the price, the wholesale price and the shop all fit on the card below it.
  const px = 100;
  const py = 290;
  const ps = W - 200;
  const ph = 760;
  ctx.save();
  roundRect(ctx, px, py, ps, ph, 30);
  ctx.clip();
  const tint = getCategory(product.category)?.color ?? '#888';
  ctx.fillStyle = `${tint}22`;
  ctx.fillRect(px, py, ps, ph);
  let drewPhoto = false;
  if (product.images?.[0]) {
    try {
      const img = await loadImage(product.images[0]);
      const scale = Math.max(ps / img.width, ph / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.fillStyle = '#fff';
      ctx.fillRect(px, py, ps, ph);
      ctx.drawImage(img, px + (ps - w) / 2, py + (ph - h) / 2, w, h);
      drewPhoto = true;
    } catch {
      // keep the picture below
    }
  }
  if (!drewPhoto && product.icon) {
    ctx.font = `340px ${FONT}`;
    ctx.fillStyle = '#000'; // a see-through colour would fade the emoji too
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(product.icon, px + ps / 2, py + ph / 2 + 20);
  }
  ctx.restore();

  const off = discountPct(product.price, product.oldPrice);
  if (off > 0) {
    ctx.font = `800 48px ${FONT}`;
    const label = `-${off}%`;
    const w = ctx.measureText(label).width + 48;
    roundRect(ctx, px + 28, py + 28, w, 76, 18);
    ctx.fillStyle = '#dc2626';
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, px + 52, py + 68);
  }

  // Name, price, wholesale and shop
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#111827';
  ctx.font = `700 62px ${FONT}`;
  let y = py + ph + 90;
  for (const l of lines(ctx, product.name, ps, 2)) {
    ctx.fillText(l, px, y);
    y += 76;
  }
  y += 40;
  ctx.fillStyle = GREEN;
  ctx.font = `800 112px ${FONT}`;
  const price = formatK(product.price);
  ctx.fillText(price, px, y);
  if (product.oldPrice > product.price) {
    const x = px + ctx.measureText(price).width + 28;
    ctx.font = `500 56px ${FONT}`;
    ctx.fillStyle = '#6b7280';
    const old = formatK(product.oldPrice);
    ctx.fillText(old, x, y);
    ctx.fillRect(x, y - 20, ctx.measureText(old).width, 5);
  }
  const lowest = product.tiers?.length ? product.tiers[product.tiers.length - 1] : null;
  if (lowest) {
    y += 76;
    ctx.fillStyle = '#198754';
    ctx.font = `600 46px ${FONT}`;
    ctx.fillText(`Wholesale ${formatK(lowest.price)} for ${lowest.min}+`, px, y);
  }
  if (shop) {
    y += 70;
    ctx.fillStyle = '#6b7280';
    ctx.font = `500 42px ${FONT}`;
    ctx.fillText(lines(ctx, `${shop.name} · ${shop.town}`, ps, 1)[0], px, y);
  }

  // Call to action and link
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.font = `800 58px ${FONT}`;
  ctx.fillText('Order on Zed Market', W / 2, 1700);
  ctx.font = `500 40px ${FONT}`;
  ctx.fillText(url.replace(/^https?:\/\//, ''), W / 2, 1772);
  ctx.globalAlpha = 0.85;
  ctx.font = `400 36px ${FONT}`;
  ctx.fillText('Pay with Mobile Money or cash on delivery', W / 2, 1836);
  ctx.globalAlpha = 1;

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

export default function StatusShare({ product, label = 'Share to Status', className = 'btn btn-outline btn-sm' }) {
  const { getShop, notify } = useStore();
  const [open, setOpen] = useState(false);
  const [picture, setPicture] = useState(null); // { file, src } once drawn, false if the browser can't draw
  const shop = getShop(product.shopId);
  const url = `${window.location.origin}/product/${product.id}`;
  const message = `${product.name} for ${formatK(product.price)}${shop ? ` at ${shop.name}` : ''}. Order on Zed Market: ${url}`;

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    let src = null;
    drawStatus({ product, shop, url })
      .catch(() => null)
      .then((blob) => {
        if (cancelled) return;
        if (!blob) return setPicture(false);
        const name = `${product.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'product'}.png`;
        src = URL.createObjectURL(blob);
        setPicture({ file: new File([blob], name, { type: 'image/png' }), src });
      });
    return () => {
      cancelled = true;
      if (src) URL.revokeObjectURL(src);
      setPicture(null);
    };
    // The picture is drawn once each time the box opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const copyLink = async (quiet) => {
    try {
      await navigator.clipboard.writeText(url);
      if (!quiet) notify('Link copied');
      return true;
    } catch {
      if (!quiet) notify(url);
      return false;
    }
  };

  const canShareFile = !!picture && !!navigator.canShare?.({ files: [picture.file] });
  const sharePicture = async () => {
    const copied = await copyLink(true);
    try {
      await navigator.share({ files: [picture.file], text: message });
      if (copied) notify('Link copied: paste it as the caption on your status');
    } catch (err) {
      if (err?.name !== 'AbortError') notify("Couldn't open sharing. Download the picture instead.");
    }
  };

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && (
        <>
          <div className="backdrop dim" onClick={() => setOpen(false)} />
          <div className="card status-sheet" role="dialog" aria-modal="true" aria-label="Share on WhatsApp Status">
            <div className="status-sheet-head">
              <h3>Share on WhatsApp Status</h3>
              <button type="button" className="icon-btn" aria-label="Close" onClick={() => setOpen(false)}>
                ×
              </button>
            </div>
            <div className="status-preview">
              {picture ? (
                <img src={picture.src} alt={`${product.name}, ready for your status`} />
              ) : (
                <span className="muted small">{picture === false ? 'This browser cannot make the picture.' : 'Making the picture…'}</span>
              )}
            </div>
            <p className="muted small">
              {canShareFile
                ? 'Tap Share picture, choose WhatsApp, then My status. The product link is copied, so you can paste it as the caption.'
                : 'Download the picture, then post it on your WhatsApp Status from your phone with the product link as the caption.'}
            </p>
            <div className="status-actions">
              {canShareFile && (
                <button type="button" className="btn btn-primary" onClick={sharePicture}>
                  Share picture
                </button>
              )}
              {picture && (
                <a className={`btn ${canShareFile ? 'btn-outline' : 'btn-primary'}`} href={picture.src} download={picture.file.name}>
                  Download picture
                </a>
              )}
              <a className="btn btn-outline" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">
                Send link on WhatsApp
              </a>
              <button type="button" className="btn btn-outline" onClick={() => copyLink(false)}>
                Copy link
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
