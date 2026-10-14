import { useRef } from "preact/hooks";
import {
  renderedFloatingPanelIds,
  collapsedPanels,
  closeFloatingPanel,
  toggleCollapse,
} from "../state/layout";
import { startPanelDrag } from "../state/panelDrag";
import { focusWindow, windowFocusOrder } from "../state/ui";
import { listPanels, panelEntries } from "../extensions/clientPanels";
import { WindowFrame } from "./WindowFrame";
import { Icon } from "./layout/ActivityBar";
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

  return (
    <WindowFrame
      title={entry.panel.title}
      icon={<Icon icon={entry.panel.icon ?? "nf-cod-window"} class="text-base" />}
      backdrop="none"
      initialX={initialPos.current.x}
      initialY={initialPos.current.y}
      initialWidth={360}
      zIndex={zIndex}
      closeOnEscape={false}
      collapsed={collapsedPanels.value.includes(id)}
      onToggleCollapse={() => toggleCollapse(id)}
      onHeaderPointerDown={(e) => startPanelDrag(id, e)}
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
