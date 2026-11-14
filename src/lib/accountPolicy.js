// A built app always requires an account. Tests select their policy explicitly.
export function developmentAccess() {
  return import.meta.env.DEV && import.meta.env.MODE !== "test";
}
