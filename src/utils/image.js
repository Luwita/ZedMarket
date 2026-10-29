// Resize an uploaded photo in the browser and return it as a compact JPEG data URL,
// so product photos stay small enough to store.
export function compressImage(file, maxSize = 640, quality = 0.75) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error(`${file.name} is not an image`));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error(`${file.name} is not a supported image`));
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// The width and height of a photo before it is shrunk, or null if the browser can't tell within a second.
export function measureImage(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL?.(file);
    if (!url) return resolve(null);
    const img = new Image();
    const done = (size) => {
      URL.revokeObjectURL?.(url);
      resolve(size);
    };
    const timer = setTimeout(() => done(null), 1000);
    img.onload = () => {
      clearTimeout(timer);
      done({ width: img.width, height: img.height });
    };
    img.onerror = () => {
      clearTimeout(timer);
      done(null);
    };
    img.src = url;
  });
}

// Photos shorter than this on their short side look blurry on a phone screen.
export const MIN_PHOTO_SIDE = 400;
export const isSmallPhoto = (size) => !!size && Math.min(size.width, size.height) < MIN_PHOTO_SIDE;
