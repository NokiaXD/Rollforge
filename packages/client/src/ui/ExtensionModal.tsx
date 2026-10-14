import { useRef } from "preact/hooks";

import { closeModal, openModals } from "../extensions/clientModals";
import { focusWindow, windowFocusOrder } from "../state/ui";
import { WindowFrame } from "./WindowFrame";
import {
  calculateCascadePosition,
  calculateWindowZIndex,
  getWindowDistanceFromTop,
  nextCascadeStep,
} from "./windowFrameUtils";

/**
 * Extension windows. Same frame as a document sheet (DocumentWindow):
 * draggable, resizable, maximizable, cascaded, stacked in the focus order.
 * An extension that renders its own `fixed` overlay inside a sidebar gets the
 * sidebar as its containing block and a clipped, translucent box.
 */
export function ExtensionModals() {
  const entries = openModals();
  if (entries.length === 0) return null;

  return (
    <>
      {entries.map((entry) => (
        <ExtensionWindow key={entry.id} id={entry.id} />
      ))}
    </>
  );
}

function ExtensionWindow({ id }: { id: string }) {
  const initialPos = useRef(calculateCascadePosition(nextCascadeStep()));
  const key = `extmodal:${id}`;
  const distanceFromTop = getWindowDistanceFromTop(windowFocusOrder.value, key);
  const zIndex = calculateWindowZIndex(distanceFromTop);

  const entry = openModals().find((m) => m.id === id);
  if (!entry) return null;

  const Body = entry.modal.component;
  const close = () => closeModal(id);

  return (
    <WindowFrame
      title={entry.modal.title}
      backdrop="none"
      initialX={initialPos.current.x}
      initialY={initialPos.current.y}
      initialWidth={entry.modal.initialWidth ?? 440}
      zIndex={zIndex}
      closeOnEscape={true}
      onFocus={() => focusWindow(key)}
      onClose={close}
    >
      <Body api={entry.api} close={close} {...(entry.modal.props ?? {})} />
    </WindowFrame>
  );
}