//  Image upload, shared by every client extension (`api.ui.imagePicker`).
//
//  A picked File never leaves the browser: it is drawn into a canvas and handed
//  back as a data URL, so the caller decides where it goes (a document's
//  `system`, a flag) and no endpoint, no temp file and no static mount exist.
//
//  Picking a file opens a modal with the cropper (drag to pan, wheel or pinch to
//  zoom — the cropper.js widget, react-easy-crop's job done) and the shape the
//  token will use: a square, or a circle clipped over a frame colour. The modal
//  is the host's own window shell, not a `fixed inset-0` overlay: the picker is
//  also rendered inside a sidebar panel, where an overlay is clipped by the panel.

import { useEffect, useRef, useState } from "preact/hooks";
import Cropper from "cropperjs";
import "cropperjs/dist/cropper.css";
import type {
  ClientExtensionAPI,
  ClientImagePickerProps,
  ClientImageShape,
} from "@rollforge/extension-api";

import { openModal } from "../extensions/clientModals";

// Cut size in px, and the size of the crop box the user frames in.
export const IMAGE_SIZE = 256;
export const CROP_FRAME = 288;
const MAX_ZOOM = 4;

/**
 * Cuts an already square image into the shape a token uses: a square, or a
 * circle clipped over a frame colour. PNG, not JPEG — a circle needs the
 * corners transparent.
 */
export function shapeImage(
  source: HTMLImageElement | HTMLCanvasElement,
  shape: ClientImageShape,
  color: string,
): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = IMAGE_SIZE;
  canvas.height = IMAGE_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, IMAGE_SIZE, IMAGE_SIZE);
  ctx.drawImage(source, 0, 0, IMAGE_SIZE, IMAGE_SIZE);
  if (shape === "circle") {
    ctx.globalCompositeOperation = "destination-in";
    ctx.beginPath();
    ctx.arc(IMAGE_SIZE / 2, IMAGE_SIZE / 2, IMAGE_SIZE / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  return canvas.toDataURL("image/png");
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image"));
    img.src = url;
  });
}

interface CropDialogProps {
  // Injected by the host's ExtensionModal window.
  close: () => void;
  src: string;
  label: string;
  // Starting shape and colour. They are LOCAL state, not props from the picker:
  // `openModal` stores its props once, so a prop would never change again and
  // the frame would only react on accept.
  shape: ClientImageShape;
  color: string;
  onConfirm: (result: {
    cut: string | null;
    rawSquare: string | null;
    shape: ClientImageShape;
    color: string;
  }) => void;
}

function CropDialog({ close, src, label, shape: initialShape, color: initialColor, onConfirm }: CropDialogProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [cropper, setCropper] = useState<Cropper | null>(null);
  const [shape, setShape] = useState<ClientImageShape>(initialShape);
  const [color, setColor] = useState(initialColor);

  useEffect(() => {
    const el = imgRef.current;
    if (!el) return;
    const c = new Cropper(el, {
      // A token portrait: one fixed square box the image is moved and zoomed
      // inside, never resized. autoCropArea 1 fills it edge to edge. Drag,
      // wheel and pinch are the widget's own; there is no slider (react-easy-crop
      // has none either) because cropper's zoom ratio is not in its typings.
      //
      // viewMode 3 (crop-to-fill), not 1/2 ("fit"): those scale the image DOWN to
      // its own aspect inside the frame, so for anything non-square the 1:1 crop
      // box lands strictly INSIDE the frame with bare canvas around it — and
      // that inner box is the cut. 3 makes the image cover the frame instead, so
      // the crop box is the frame: one shape on screen, one thing that gets cut.
      viewMode: 3,
      dragMode: "move",
      aspectRatio: 1,
      autoCropArea: 1,
      background: false,
      responsive: true,
      restore: false,
      guides: false,
      center: true,
      highlight: false,
      cropBoxMovable: false,
      cropBoxResizable: false,
      toggleDragModeOnDblclick: false,
      ready() {
        setCropper(c);
      },
    });
    return () => {
      setCropper(null);
      c.destroy();
    };
  }, [src]);

  // Unmount is the only guaranteed end (Esc, ✕, Usar and Cancelar all close the
  // window), so the object URL is revoked here instead of in four handlers.
  // Re-adjusting an existing image hands over a data URL, which must survive.
  useEffect(
    () => () => {
      if (src.startsWith("blob:")) URL.revokeObjectURL(src);
    },
    [src],
  );

  const chip = "rounded border border-white/10 px-2 py-0.5 text-[11px] text-muted hover:text-white";

  // Cropper's container is the img's own parent box, so this exact square is
  // its container, its canvas limit and its crop box: nothing outside it can be
  // part of the cut, and in Circular it is clipped to the circle that survives
  // the mask. A circle drawn NEXT TO the real box would only lie about it.
  return (
    <div class="flex flex-col items-center gap-3">
      <div
        class="image-cropper relative flex items-center justify-center overflow-hidden border-2 border-white/40"
        style={{
          width: CROP_FRAME,
          height: CROP_FRAME,
          background: color,
          borderRadius: shape === "circle" ? "50%" : "0",
        }}
      >
        {/* Cropper hides this element once it starts; it only needs to exist. */}
        <img ref={imgRef} src={src} alt={label} class="block" />
      </div>

      <div class="flex w-full items-center gap-2">
        <span class="text-[10px] text-muted/80">
          Arrastra para encuadrar · rueda o pellizco para el zoom
        </span>
        <span class="ml-auto flex gap-2">
          <button
            type="button"
            class={`${chip} ${shape === "square" ? "border-accent text-white" : ""}`}
            onClick={() => setShape("square")}
          >
            Cuadrada
          </button>
          <button
            type="button"
            class={`${chip} ${shape === "circle" ? "border-accent text-white" : ""}`}
            onClick={() => setShape("circle")}
          >
            Circular
          </button>
          <input
            type="color"
            value={color}
            title="Color del marco"
            class="h-6 w-8 cursor-pointer border border-white/10 bg-transparent"
            onInput={(e) => setColor(e.currentTarget.value)}
          />
        </span>
      </div>

      <div class="flex w-full items-center justify-end gap-2">
        <button type="button" class={chip} onClick={close}>
          Cancelar
        </button>
        <button
          type="button"
          class={`${chip} border-accent text-white`}
          disabled={!cropper}
          onClick={() => {
            const cutCanvas = cropper?.getCroppedCanvas({
              width: IMAGE_SIZE,
              height: IMAGE_SIZE,
              imageSmoothingQuality: "high",
            });
            if (!cutCanvas) return;
            const shaped = shapeImage(cutCanvas, shape, color);
            const rawSquare = cutCanvas.toDataURL("image/png");
            onConfirm({ cut: shaped, rawSquare, shape, color });
            close();
          }}
        >
          Usar
        </button>
      </div>
    </div>
  );
}

// One cropper at a time per picker; a counter keeps two open windows (two
// portraits in the same document) from replacing each other.
let cropModalId = 0;

export function ImagePicker({
  api,
  value,
  onChange,
  shape = "square",
  color: initialColor = "#101319",
  label = "Imagen",
  compact = false,
}: ClientImagePickerProps & { api: ClientExtensionAPI }) {
  // Shape and colour live here rather than in props — an extension asked for a
  // picker, not for a token editor, and nobody re-renders it to change a colour.
  const [curShape, setCurShape] = useState<ClientImageShape>(shape);
  const [color, setColor] = useState(initialColor);
  // The uncut square is the source of truth: changing shape or colour re-cuts
  // it, so a mistake never costs the user their file.
  const [square, setSquare] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!square) return;
    let live = true;
    void loadImage(square).then(
      (img) => {
        if (!live) return;
        const url = shapeImage(img, curShape, color);
        setError(url ? "" : "canvas");
        if (url) onChange(url);
      },
      () => live && setError("No se pudo recortar la imagen."),
    );
    // `onChange` is deliberately out of deps: an inline arrow from the caller
    // would re-cut the image on every parent render.
  }, [curShape, color]);

  /**
   * Opens the cropper over `src`, which is either a fresh file's object URL or
   * the already cut square (re-adjusting). The cropper owns every option, so
   * the picker itself is a thumbnail and a file input.
   */
  const open = (src: string) => {
    const id = `image-crop-${++cropModalId}`;
    openModal({
      id,
      api,
      modal: {
        id,
        title: "Ajustar imagen",
        component: CropDialog,
        props: {
          src,
          label,
          shape: curShape,
          color,
          onConfirm: ({
            cut,
            rawSquare,
            shape,
            color,
          }: {
            cut: string | null;
            rawSquare: string | null;
            shape: ClientImageShape;
            color: string;
          }) => {
            if (!cut) return;
            setCurShape(shape);
            setColor(color);
            setSquare(rawSquare ?? cut);
            onChange(cut);
          },
        },
      },
    });
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError("");
    const src = URL.createObjectURL(file);
    try {
      await loadImage(src);
    } catch {
      URL.revokeObjectURL(src);
      setError("No se pudo leer la imagen.");
      setBusy(false);
      return;
    }
    setBusy(false);
    open(src);
  };

  const clear = (e?: Event) => {
    if (e) e.stopPropagation();
    setSquare(null);
    setError("");
    onChange(null);
  };

  const triggerPick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) void pick(file);
  };

  const hiddenInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept="image/*"
      class="hidden"
      disabled={busy}
      onChange={(e) => {
        void pick(e.currentTarget.files?.[0]);
        // picking the same file twice must still fire change
        e.currentTarget.value = "";
      }}
    />
  );

  if (compact) {
    return (
      <div
        class="relative group h-full w-full flex items-center justify-center overflow-hidden select-none"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {hiddenInput}
        {value ? (
          <>
            <img src={value} alt={label} class="h-full w-full object-cover block" />
            <div class="absolute inset-0 bg-black/75 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1 p-1">
              <button
                type="button"
                class="w-full rounded bg-white/20 hover:bg-white/30 text-[10px] text-white py-0.5 font-mono font-medium transition-colors"
                onClick={() => open(square ?? value)}
                title="Reajustar encuadre"
              >
                Ajustar
              </button>
              <button
                type="button"
                class="w-full rounded bg-white/20 hover:bg-white/30 text-[10px] text-white py-0.5 font-mono font-medium transition-colors"
                onClick={triggerPick}
                title="Cambiar imagen"
              >
                Cambiar
              </button>
              <button
                type="button"
                class="w-full rounded bg-red-500/30 hover:bg-red-500/50 text-[10px] text-red-200 py-0.5 font-mono font-medium transition-colors"
                onClick={clear}
                title="Quitar imagen"
              >
                ✕ Quitar
              </button>
            </div>
          </>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={triggerPick}
            title={`Subir ${label.toLowerCase()}`}
            class={`h-full w-full flex flex-col items-center justify-center gap-1 border border-dashed transition-colors ${
              isDragging
                ? "border-accent bg-accent/15 text-white"
                : "border-white/20 bg-black/30 text-white/60 hover:border-accent hover:text-white hover:bg-black/40"
            }`}
          >
            <span class="text-xs">📷</span>
            <span class="text-[9px] font-mono tracking-wider uppercase font-semibold">
              {busy ? "..." : "Subir"}
            </span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div class="flex items-start gap-3">
      {hiddenInput}
      <div
        class="relative group h-24 w-24 shrink-0 rounded border border-white/10 bg-black/30 overflow-hidden flex items-center justify-center select-none"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {value ? (
          <>
            <img src={value} alt={label} class="h-full w-full object-cover block" />
            <button
              type="button"
              title="Volver a ajustar"
              onClick={() => open(square ?? value)}
              class="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-[10px] text-white font-mono"
            >
              Ajustar
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={triggerPick}
            class={`h-full w-full flex flex-col items-center justify-center gap-1 text-[10px] transition-colors border border-dashed ${
              isDragging
                ? "border-accent bg-accent/15 text-white"
                : "border-white/15 text-muted hover:border-accent hover:text-white"
            }`}
          >
            <span class="text-sm">📷</span>
            <span>{busy ? "Cargando..." : "Subir foto"}</span>
          </button>
        )}
      </div>

      <div class="min-w-0 flex-1 space-y-2 py-0.5">
        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="rounded border border-white/15 bg-white/10 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-white/20 transition-colors"
            onClick={triggerPick}
            disabled={busy}
          >
            {value ? "Cambiar imagen" : "Elegir archivo"}
          </button>
          {value && (
            <>
              <button
                type="button"
                class="rounded border border-white/10 bg-black/30 px-2.5 py-1 text-[11px] text-muted hover:text-white transition-colors"
                onClick={() => open(square ?? value)}
              >
                Ajustar encuadre
              </button>
              <button
                type="button"
                class="rounded border border-red-500/20 bg-red-500/10 px-2 py-1 text-[11px] text-red-300 hover:bg-red-500/20 transition-colors"
                onClick={clear}
              >
                Quitar
              </button>
            </>
          )}
        </div>
        <p class="text-[10px] text-muted/70">
          {value
            ? "Haz clic en la imagen o en Ajustar para encuadrar y cambiar forma."
            : "Haz clic o arrastra un archivo PNG, JPG o WebP."}
        </p>
        {error && <p class="text-[10px] text-red-300">{error}</p>}
      </div>
    </div>
  );
}