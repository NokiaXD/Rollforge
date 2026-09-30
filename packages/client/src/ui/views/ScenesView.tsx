import { useState, useMemo } from "preact/hooks";
import type { CSSProperties, HTMLAttributes } from "preact";
import type { CollisionDetection, DragEndEvent } from "@dnd-kit/core";
import {
  DndContext,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  useDroppable,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, rectSortingStrategy } from "@dnd-kit/sortable";
import { scenes as scenesSignal } from "../../state/scenes";
import { folders as foldersSignal, createFolder } from "../../state/folders";
import { activeSceneId, gmCameraSceneId } from "../../state/scene";
import { currentUser } from "../../state/auth";
import {
  setActiveSceneAsGM,
  setGmCamera,
  deleteSceneRequest,
  moveSceneRequest,
} from "../../net/socket";
import {
  folderFormModal,
  folderDeleteConfirm,
  sceneFormModal,
  openContextMenu,
  type ContextMenuItem,
} from "../../state/ui";
import type { Scene } from "@rollforge/protocol";

//  drop target ids are prefixed to disambiguate from scene ids. "folder:" = root,
// "folder:<id>" = a specific folder.
const FOLDER_DROP_PREFIX = "folder:";

function folderDropId(folderId: string | null): string {
  return `${FOLDER_DROP_PREFIX}${folderId ?? ""}`;
}

function parseFolderDropId(id: string): string | null {
  if (!id.startsWith(FOLDER_DROP_PREFIX)) return null;
  return id.slice(FOLDER_DROP_PREFIX.length) || null;
}

//  fall back to background image URL when no explicit thumbnail is set, so the
// GM only uploads one image per scene. Only URL-shaped backgrounds render — colors fall through.
function thumbnailSrc(scene: Scene): string | null {
  if (scene.img) return scene.img;
  const bg = scene.system.background;
  if (bg && (bg.startsWith("/uploads/") || bg.startsWith("http"))) return bg;
  return null;
}

function sortByOrder(scenes: Scene[]): Scene[] {
  return scenes
    .slice()
    .sort(
      (a, b) =>
        (a.system.order ?? 0) - (b.system.order ?? 0) ||
        (a.name || a.id).localeCompare(b.name || b.id),
    );
}

//  cada sección es un droppable que *contiene* a sus escenas, así que el default
//  (rectIntersection) solapaba ambas y el drop caía siempre al final de la lista.
//  el hit más pequeño bajo el puntero gana: la escena, no su carpeta.
const innermostFirst: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  if (hits.length < 2) return hits.length ? hits : rectIntersection(args);
  const containerMap = new Map(args.droppableContainers.map((c) => [c.id, c]));
  const area = (id: string | number) => {
    const rect = containerMap.get(id)?.rect.current ?? args.droppableRects?.get?.(id);
    return rect ? rect.width * rect.height : Number.POSITIVE_INFINITY;
  };
  return [...hits].sort((a, b) => area(a.id) - area(b.id));
};

//  objeto en módulo, no inline: useSensor memoriza por identidad de `options` y una
//  identidad nueva en cada render rompe el setup de sensores de dnd-kit.
const POINTER_SENSOR_OPTS = { activationConstraint: { distance: 6 } };

//  id de drop de la sección raíz; "" = sin carpeta.
const ROOT = "";
const NO_IDS: string[] = [];

export function ScenesView() {
  const isGM = currentUser.value?.role === "GM";
  const sensors = useSensors(useSensor(PointerSensor, POINTER_SENSOR_OPTS));

  const allScenes = useMemo(() => [...scenesSignal.value.values()], [scenesSignal.value]);
  const allFolders = useMemo(
    () =>
      [...foldersSignal.value.values()].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    [foldersSignal.value],
  );

  const orphanScenes = useMemo(
    () => sortByOrder(allScenes.filter((s) => !s.system.folder)),
    [allScenes],
  );
  const scenesByFolder = useMemo(() => {
    const out = new Map<string, Scene[]>();
    for (const f of allFolders) out.set(f.id, []);
    for (const s of allScenes) {
      const k = s.system.folder;
      if (!k) continue;
      const bucket = out.get(k);
      if (bucket) bucket.push(s);
    }
    for (const [k, list] of out) out.set(k, sortByOrder(list));
    return out;
  }, [allScenes, allFolders]);

  //  identidad estable: SortableContext memoriza strategy/collisions sobre `items`,
  //  y un array nuevo por render re-registra los droppables y dispara el loop de renders.
  const sceneIdsByFolder = useMemo(() => {
    const m = new Map<string, string[]>();
    m.set(ROOT, orphanScenes.map((s) => s.id));
    for (const [k, list] of scenesByFolder) m.set(k, list.map((s) => s.id));
    return m;
  }, [orphanScenes, scenesByFolder]);

  const handleDragEnd = (event: DragEndEvent) => {
    if (!isGM) return;
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;
    const activeScene = scenesSignal.value.get(activeId);
    if (!activeScene) return;

    const listOf = (folder: string | null) =>
      folder === null ? orphanScenes : (scenesByFolder.get(folder) ?? []);
    const sourceFolder = activeScene.system.folder ?? null;

    let destFolder: string | null;
    let destIndex: number;

    const droppedOnFolder = parseFolderDropId(overId);
    if (droppedOnFolder !== null) {
      // dropped on a folder header or the "Sin carpeta" section
      destFolder = droppedOnFolder || null;
      destIndex = listOf(destFolder).length;
    } else {
      const overScene = scenesSignal.value.get(overId);
      if (!overScene) return;
      destFolder = overScene.system.folder ?? null;
      const list = listOf(destFolder);
      const overIndex = list.findIndex((s) => s.id === overId);
      if (overIndex < 0) return;
      if (destFolder !== sourceFolder) {
        destIndex = overIndex;
      } else {
        //  dentro de la misma carpeta el destino corre una posición si bajamos:
        //  arrayMove ya devuelve el índice final sin ofsets manuales.
        const from = list.findIndex((s) => s.id === activeId);
        if (from < 0) return;
        destIndex = arrayMove(list.map((s) => s.id), from, overIndex).indexOf(activeId);
      }
    }

    moveSceneRequest(activeId, destFolder, destIndex);
  };

  const empty = allScenes.length === 0 && allFolders.length === 0;

  //  context-menu items for right-clicks. Builders so each handler is fresh.
  const sceneContextItems = (scene: Scene): ContextMenuItem[] => {
    const isActive = activeSceneId.value === scene.id;
    const isCamera = gmCameraSceneId.value === scene.id;
    return [
      {
        label: "Cámara aquí",
        ...(isCamera ? { hint: "actual" } : {}),
        onClick: () => setGmCamera(scene.id),
      },
      {
        label: "Activar para jugadores",
        ...(isActive ? { hint: "actual" } : {}),
        disabled: isActive,
        onClick: () => setActiveSceneAsGM(scene.id),
      },
      { label: "Editar", onClick: () => (sceneFormModal.value = { mode: "edit", sceneId: scene.id }) },
      {
        label: "Eliminar",
        danger: true,
        onClick: () => {
          if (window.confirm(`Delete scene "${scene.name}"?`)) deleteSceneRequest(scene.id);
        },
      },
    ];
  };

  const folderContextItems = (folderId: string): ContextMenuItem[] => [
    {
      label: "Nueva escena aquí",
      onClick: () => (sceneFormModal.value = { mode: "create", folderId }),
    },
    {
      label: "Renombrar",
      onClick: () => (folderFormModal.value = { folderId }),
    },
    {
      label: "Eliminar",
      danger: true,
      onClick: () => (folderDeleteConfirm.value = folderId),
    },
  ];

  const emptyContextItems = (): ContextMenuItem[] => [
    { label: "Nueva escena", onClick: () => (sceneFormModal.value = { mode: "create" }) },
    { label: "Nueva carpeta", onClick: createFolder },
  ];

  const onRootContextMenu = (e: MouseEvent) => {
    if (!isGM) {
      e.preventDefault();
      return;
    }
    openContextMenu(e, emptyContextItems());
  };

  return (
    <DndContext sensors={sensors} collisionDetection={innermostFirst} onDragEnd={handleDragEnd}>
      <div
        class="custom-scroll flex h-full flex-col overflow-y-auto bg-transparent text-xs"
        onContextMenu={onRootContextMenu}
      >
        <div class="mb-3 flex items-center justify-between gap-1 pt-3 px-3">
          <span class="font-semibold uppercase tracking-wider text-muted text-[11px]">
            Scenes ({allScenes.length})
          </span>
          {isGM && (
            <div class="flex items-center gap-1.5">
              <button
                type="button"
                onClick={createFolder}
                class="rounded border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white hover:bg-white/10 transition-colors"
                title="Nueva carpeta"
              >
                <i class="nf nf-fa-folder_plus"></i>
              </button>
              <button
                type="button"
                onClick={() => (sceneFormModal.value = { mode: "create" })}
                class="rounded border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white hover:bg-white/10 transition-colors"
              >
                <i class="nf nf-fa-plus"></i> Scene
              </button>
            </div>
          )}
        </div>

        {empty ? (
          <div class="flex flex-1 flex-col items-center justify-center p-6 text-center text-muted">
            <span class=" mb-2 text-7xl"><div class="nf nf-fa-map"></div></span>
            <p class="font-medium">No scenes available</p>
            {isGM && <p class="mt-1 text-[11px]">Empezá creando una carpeta o escena.</p>}
          </div>
        ) : (
          <div class="space-y-2">
            {allFolders.map((f) => {
              const list = scenesByFolder.get(f.id) ?? [];
              return (
                <IconSection
                  key={f.id}
                  title={f.name}
                  folderId={f.id}
                  sceneIds={sceneIdsByFolder.get(f.id) ?? NO_IDS}
                  isGM={isGM}
                  defaultOpen
                  contextItems={isGM ? folderContextItems(f.id) : null}
                >
                  {list.length === 0 ? (
                    <p class="col-span-full pl-1 text-[11px] text-muted/60 italic">Carpeta vacía.</p>
                  ) : (
                    list.map((s) => (
                      <SortableSceneIcon
                        key={s.id}
                        scene={s}
                        isGM={isGM}
                        contextItems={sceneContextItems(s)}
                      />
                    ))
                  )}
                </IconSection>
              );
            })}
             {orphanScenes.length > 0 && (
              <IconSection
                title="Sin carpeta"
                folderId={null}
                sceneIds={sceneIdsByFolder.get(ROOT) ?? NO_IDS}
                isGM={isGM}
                defaultOpen
                contextItems={isGM ? emptyContextItems() : null}
              >
                {orphanScenes.map((s) => (
                  <SortableSceneIcon
                    key={s.id}
                    scene={s}
                    isGM={isGM}
                    contextItems={sceneContextItems(s)}
                  />
                ))}
              </IconSection>
            )}
          </div>
        )}
      </div>
    </DndContext>
  );
}

function IconSection({
  title,
  folderId,
  sceneIds,
  isGM,
  defaultOpen,
  contextItems,
  children,
}: {
  title: string;
  folderId: string | null;
  sceneIds: string[];
  isGM: boolean;
  defaultOpen: boolean;
  contextItems: ContextMenuItem[] | null;
  children: preact.ComponentChildren;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const { setNodeRef, isOver } = useDroppable({ id: folderDropId(folderId) });
  const headerActive = isOver;
  const onHeaderContext = (e: MouseEvent) => {
    if (!contextItems) {
      e.preventDefault();
      return;
    }
    openContextMenu(e, contextItems);
  };
  return (
    <section ref={setNodeRef}>
      <header
        class={`flex items-center gap-1  p-3 mb-1.5 transition-colors ${
          headerActive ? "border-accent/60 bg-accent/5 rounded" : "border-white/5"
        }`}
        onContextMenu={onHeaderContext}
      >
        <button
          type="button"
          onClick={() => setOpen(!open)}
          class="flex flex-1 items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted hover:text-white justify-center"
        >
        <span>{title}</span>
          <span>{open ? <i class= "nf nf-fa-chevron_down text-xl"></i> : <i class="nf nf-fa-chevron_right text-xl"></i>}</span>
        </button>
      </header>
      {open && (
        <SortableContext items={sceneIds} strategy={rectSortingStrategy}>
          <div
            class={`grid grid-cols-3 gap-2 rounded p-1 transition-colors ${
              headerActive ? "bg-accent/5" : ""
            }`}
          >
            {children}
          </div>
        </SortableContext>
      )}
    </section>
  );
}

function SortableSceneIcon({
  scene,
  isGM,
  contextItems,
}: {
  scene: Scene;
  isGM: boolean;
  contextItems: ContextMenuItem[];
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: scene.id,
    disabled: !isGM,
  });
  //  dnd-kit types role/tabIndex as plain string, preact wants AriaRole/Signalish.
  const a11y = { ...attributes, ...listeners } as unknown as HTMLAttributes<HTMLDivElement>;
  const style: CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition: transition ?? undefined,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...a11y}
      onContextMenu={(e) => {
        if (!isGM) {
          e.preventDefault();
          return;
        }
        openContextMenu(e, contextItems);
      }}
    >
      <SceneIcon scene={scene} />
    </div>
  );
}

function SceneIcon({ scene }: { scene: Scene }) {
  const isActive = activeSceneId.value === scene.id;
  const isCamera = gmCameraSceneId.value === scene.id;
  return (
    <div class="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setGmCamera(scene.id);
        }}
        title={`${scene.name}\n${scene.id} · ${scene.system.width}×${scene.system.height}`}
        class={`relative block w-full cursor-grab overflow-hidden rounded-lg border transition-all active:cursor-grabbing ${
          isActive
            ? "border-accent ring-2 ring-accent/40"
            : "border-white/10 hover:border-white/30"
        }`}
      >
        <div class="aspect-square w-full bg-[#0e1116]">
          {thumbnailSrc(scene) ? (
            <img src={thumbnailSrc(scene) ?? ""} alt="" class="h-full w-full object-cover" />
          ) : (
            <div class="flex h-full w-full items-center justify-center text-2xl text-muted/40">🗺️</div>
          )}
        </div>
        <span
          class={`block truncate px-1.5 py-1 text-[10px] text-center ${
            isActive ? "bg-accent/20 text-white font-medium" : "bg-black/40 text-muted"
          }`}
        >
          {scene.name}
        </span>
        {isCamera && !isActive && (
          <span class="absolute right-1 top-1 rounded bg-amber-500/30 px-1 text-[9px] font-semibold text-amber-200">VIEW</span>
        )}
      </button>
    </div>
  );
}