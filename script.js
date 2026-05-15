/* ------------------------------------------------------------------
 * Configuración
 * ------------------------------------------------------------------
 * Pega aquí la URL de tu despliegue de Apps Script (Web App).
 * Termina en "/exec" cuando se despliega como aplicación web.
 */
const APPS_SCRIPT_URL = "PEGA_AQUI_LA_URL_DE_TU_APPS_SCRIPT";

const MAX_DIMENSION = 1600;   // px del lado más largo tras comprimir
const JPEG_QUALITY  = 0.8;    // calidad JPEG de la imagen comprimida

/* ------------------------------------------------------------------
 * Estado
 * ------------------------------------------------------------------
 * Dos huecos fijos: photos[0] y photos[1].
 * Cada entrada es null o un objeto:
 *   { name, lat, lng, takenAt, base64, previewUrl }
 */
const photos = [null, null];

/* ------------------------------------------------------------------
 * Referencias DOM
 * ------------------------------------------------------------------ */
const slotEls   = document.querySelectorAll(".slot");
const uploadBtn = document.getElementById("upload-btn");
const statusEl  = document.getElementById("status");

/* ------------------------------------------------------------------
 * Inicialización: cablear los dos slots
 * ------------------------------------------------------------------ */
slotEls.forEach((slot) => {
  const index    = Number(slot.dataset.index);
  const input    = slot.querySelector(".slot-input");
  const changeEl = slot.querySelector(".slot-change");

  input.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) onPhotoSelected(index, file);
    // permitir volver a elegir el mismo archivo
    e.target.value = "";
  });

  // "Cambiar foto": reabre el selector de archivos
  changeEl.addEventListener("click", () => input.click());
});

uploadBtn.addEventListener("click", onUploadClicked);

/* ==================================================================
 * Selección de fotos
 * ================================================================== */
async function onPhotoSelected(index, file) {
  if (!file.type.startsWith("image/")) {
    showStatus("error", "Solo se aceptan imágenes.");
    return;
  }

  setSlotLoading(index, true);
  clearStatus();

  try {
    const metadata   = await readExifMetadata(file);
    const compressed = await compressImage(file);

    photos[index] = {
      name:       file.name,
      lat:        metadata.lat,
      lng:        metadata.lng,
      takenAt:    metadata.takenAt,
      base64:     compressed.base64,
      previewUrl: compressed.dataUrl,
    };

    renderSlot(index);
    refreshUploadButton();
  } catch (err) {
    console.error(err);
    photos[index] = null;
    renderSlot(index);
    showStatus("error", "No se pudo procesar la foto. Inténtalo de nuevo.");
  } finally {
    setSlotLoading(index, false);
  }
}

/* ==================================================================
 * Extracción de metadatos EXIF (GPS + fecha)
 * ==================================================================
 * Usa la librería global EXIF (exif-js). Se ejecuta antes de comprimir,
 * ya que la compresión vía canvas elimina los metadatos.
 */
function readExifMetadata(file) {
  return new Promise((resolve) => {
    if (typeof EXIF === "undefined") {
      resolve({ lat: null, lng: null, takenAt: null });
      return;
    }
    EXIF.getData(file, function () {
      const lat    = EXIF.getTag(this, "GPSLatitude");
      const latRef = EXIF.getTag(this, "GPSLatitudeRef");
      const lng    = EXIF.getTag(this, "GPSLongitude");
      const lngRef = EXIF.getTag(this, "GPSLongitudeRef");
      const date   = EXIF.getTag(this, "DateTimeOriginal");

      resolve({
        lat:     toDecimal(lat, latRef),
        lng:     toDecimal(lng, lngRef),
        takenAt: parseExifDate(date),
      });
    });
  });
}

function toDecimal(dms, ref) {
  if (!dms || !ref) return null;
  const [d, m, s] = dms;
  let value = d + m / 60 + s / 3600;
  if (ref === "S" || ref === "W") value = -value;
  return Number(value.toFixed(6));
}

function parseExifDate(raw) {
  // Formato EXIF: "2024:05:14 17:30:00"
  if (!raw || typeof raw !== "string") return null;
  const [date, time] = raw.split(" ");
  if (!date) return null;
  return date.replace(/:/g, "-") + "T" + (time || "00:00:00");
}

/* ==================================================================
 * Compresión de imágenes en cliente (canvas)
 * ================================================================== */
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      const { width, height } = scaleDimensions(
        img.naturalWidth,
        img.naturalHeight,
        MAX_DIMENSION
      );

      const canvas = document.createElement("canvas");
      canvas.width  = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);

      const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
      const base64  = dataUrl.split(",")[1];

      URL.revokeObjectURL(url);
      resolve({ dataUrl, base64 });
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("No se pudo cargar la imagen"));
    };

    img.src = url;
  });
}

function scaleDimensions(w, h, max) {
  if (w <= max && h <= max) return { width: w, height: h };
  const ratio = Math.min(max / w, max / h);
  return {
    width:  Math.round(w * ratio),
    height: Math.round(h * ratio),
  };
}

/* ==================================================================
 * Render de slots y estado del botón
 * ================================================================== */
function renderSlot(index) {
  const slot       = slotEls[index];
  const emptyEl    = slot.querySelector(".slot-empty");
  const filledEl   = slot.querySelector(".slot-filled");
  const photo      = photos[index];

  if (!photo) {
    slot.classList.remove("is-filled");
    emptyEl.hidden  = false;
    filledEl.hidden = true;
    return;
  }

  slot.classList.add("is-filled");
  emptyEl.hidden  = true;
  filledEl.hidden = false;

  slot.querySelector(".slot-preview").src      = photo.previewUrl;
  slot.querySelector(".slot-filename").textContent = photo.name;
  slot.querySelector(".slot-meta").innerHTML       = formatMeta(photo);
}

function formatMeta(photo) {
  const parts = [];
  if (photo.lat != null && photo.lng != null) {
    parts.push(`<span class="has-gps">📍 GPS disponible</span>`);
  } else {
    parts.push(`<span>Sin datos de ubicación</span>`);
  }
  if (photo.takenAt) {
    const dateStr = photo.takenAt.slice(0, 10);
    parts.push(`<span>${dateStr}</span>`);
  }
  return parts.join(" · ");
}

function setSlotLoading(index, isLoading) {
  const loadingEl = slotEls[index].querySelector(".slot-loading");
  loadingEl.hidden = !isLoading;
}

function refreshUploadButton() {
  uploadBtn.disabled = !(photos[0] && photos[1]);
}

/* ==================================================================
 * Subida al backend (Google Apps Script)
 * ==================================================================
 * Se envía como text/plain con un JSON.stringify dentro para evitar
 * el preflight CORS de Apps Script.
 */
async function onUploadClicked() {
  if (!photos[0] || !photos[1]) return;

  if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.startsWith("PEGA_AQUI")) {
    showStatus("error", "Falta configurar la URL del Apps Script en script.js.");
    return;
  }

  uploadBtn.disabled = true;
  showStatus("loading", "Subiendo…");

  try {
    const body = JSON.stringify({
      photos: photos.map((p) => ({
        name:    p.name,
        lat:     p.lat,
        lng:     p.lng,
        takenAt: p.takenAt,
        base64:  p.base64,
      })),
    });

    const res = await fetch(APPS_SCRIPT_URL, {
      method:  "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body,
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.message || "Error en el servidor");

    showStatus("success", "Fotos subidas correctamente.");
    resetForm();
  } catch (err) {
    console.error(err);
    showStatus("error", "Error al subir las fotos. Inténtalo de nuevo.");
    refreshUploadButton();
  }
}

function resetForm() {
  photos[0] = null;
  photos[1] = null;
  slotEls.forEach((_, i) => renderSlot(i));
  refreshUploadButton();
}

/* ==================================================================
 * Mensajes de estado
 * ================================================================== */
function showStatus(type, message) {
  statusEl.className = "status " + type;
  statusEl.textContent = message;
}

function clearStatus() {
  statusEl.className = "status";
  statusEl.textContent = "";
}
