import {
  CURRENT_LAYOUT_VERSION,
  parseSavedLayout,
  type LayoutStateData,
} from "./layoutTransitions";

const STORAGE_PREFIX = "rollforge:layout:";

/**
 * Loads and validates saved layout data for a specific authenticated user.
 * Returns null if no user is provided, if localStorage is unavailable, or if payload is invalid.
 */
export function loadUserLayout(userId: string | null | undefined): LayoutStateData | null {
  if (!userId) return null;
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${userId}`);
    return parseSavedLayout(raw);
  } catch {
    return null;
  }
}

/**
 * Persists layout state securely under the user's specific key.
 * Swallows storage quota and private browsing exceptions safely.
 */
export function saveUserLayout(
  userId: string | null | undefined,
  data: LayoutStateData,
): void {
  if (!userId) return;
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${userId}`, JSON.stringify(data));
  } catch {
    // Ignore private browsing or quota limits
  }
}
