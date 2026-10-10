import { useRef } from "preact/hooks";
import {
  renderedFloatingPanelIds,
  dockFloating,
  closeFloatingPanel,
} from "../state/layout";
import { focusWindow, windowFocusOrder } from "../state/ui";
import { listPanels, panelEntries } from "../extensions/clientPanels";
import { WindowFrame } from "./WindowFrame";
import {
  calculateCascadePosition,
  calculateWindowZIndex,
  getWindowDistanceFromTop,
  nextCascadeStep,
} from "./windowFrameUtils";

export function FloatingPanels() {
  const panelIds = renderedFloatingPanelIds.value;
  if (panelIds.length === 0) return null;

  return (
    <>
      {panelIds.map((id) => (
        <FloatingPanelWindow key={id} id={id} />
      ))}
    </>
  );
}

function FloatingPanelWindow({ id }: { id: string }) {
  const initialPos = useRef(calculateCascadePosition(nextCascadeStep()));
  const allPanels = listPanels();
  const entry = allPanels.find((p) => p.panel.id === id);

  if (!entry) return null;

  const PanelComponent = entry.panel.component;
  const distanceFromTop = getWindowDistanceFromTop(windowFocusOrder.value, `panel:${id}`);
  const zIndex = calculateWindowZIndex(distanceFromTop);

  const headerActions = (
    <div class="flex items-center gap-1">
      <button
        type="button"
        onClick={() => dockFloating(id, "left")}
        title="Acoplar a la barra izquierda"
        class="rounded p-1 text-[11px] text-muted hover:bg-white/10 hover:text-white transition-colors"
      >
        ⮌
      </button>
      <button
        type="button"
        onClick={() => dockFloating(id, "right")}
        title="Acoplar a la barra derecha"
        class="rounded p-1 text-[11px] text-muted hover:bg-white/10 hover:text-white transition-colors"
      >
        ⮎
      </button>
    </div>
  );

  return (
    <WindowFrame
      title={entry.panel.title}
      icon={entry.panel.icon}
      backdrop="none"
      initialX={initialPos.current.x}
      initialY={initialPos.current.y}
      initialWidth={360}
      zIndex={zIndex}
      closeOnEscape={false}
      headerActions={headerActions}
      onFocus={() => focusWindow(`panel:${id}`)}
      onClose={() => closeFloatingPanel(id)}
    >
      <div class="h-[60vh] max-h-[600px] flex flex-col overflow-hidden">
        <PanelComponent
          api={entry.api}
          entries={panelEntries(entry.panel)}
        />
      </div>
    </WindowFrame>
  );
}
