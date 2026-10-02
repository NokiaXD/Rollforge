import { registerSheet } from "./clientSheets";
import { CustomActorSheet } from "./builtins/customActorSheet";

//  this is the "client extension host" seed. It only does what
// client extensions would do when they load — register sheets. When we add a
// real client-side extension loader in a future step, disk extensions will call
// the same `registerSheet` API after they're imported, with their own extensionId.
registerSheet({
  documentType: "Actor",
  component: CustomActorSheet,
  default: true,
  extensionId: "core:custom-actor-sheet",
});