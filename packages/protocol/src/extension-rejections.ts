//  structured rejection for extension-host decisions. Lives in protocol
// (the neutral package) so both clientSheets and SheetRegistry can throw the
// same class with the same fields. Wire-level socket rejections stay in
// messages.ts — these are extension-registry-internal.

// `owner` and `attemptedBy` are extensionIds; empty string means anonymous
// (no extensionId was provided at registration time).
export class SheetOwnerConflict extends Error {
  readonly kind = "SheetOwnerConflict" as const;
  readonly documentType: string;
  readonly owner: string;
  readonly attemptedBy: string;

  constructor(documentType: string, owner: string, attemptedBy: string) {
    super(
      `sheet for documentType "${documentType}" is owned by "${owner || "<unnamed>"}"; "${attemptedBy || "<unnamed>"}" cannot override`,
    );
    this.name = "SheetOwnerConflict";
    this.documentType = documentType;
    this.owner = owner;
    this.attemptedBy = attemptedBy;
  }
}

export function isSheetOwnerConflict(err: unknown): err is SheetOwnerConflict {
  return err instanceof SheetOwnerConflict;
}