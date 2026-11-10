// Shared lock for the page scroll behind an overlay (dialog, popup, mobile menu).
// Overlays can open on top of each other and close in any order, so each one used to save and restore
// document.body.style.overflow on its own and the last one to close could leave the page locked.
// The lock is counted: the page scrolls again only when the last overlay has released it.

let activeLocks = 0;
let overflowBeforeLock = "";

/** Locks the page scroll and returns the function that releases this lock (safe to call more than once). */
export function lockBodyScroll(): () => void {
  if (typeof document === "undefined") return () => {};

  if (activeLocks === 0) {
    overflowBeforeLock = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  activeLocks += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeLocks -= 1;
    if (activeLocks === 0) document.body.style.overflow = overflowBeforeLock;
  };
}
