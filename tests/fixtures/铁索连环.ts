// LEGACY: references deleted v2 modules - skipped
// This fixture imports @engine/skill-hook and @engine/equipment/* which are
// deleted in v3. Since the tests that use this fixture are all marked LEGACY
// and skipped, registerAll() is never actually called.
//
// Stub kept for import resolution: provides a registerAll() that does nothing.

export function registerAll(): void {
  // no-op (LEGACY stub)
}
