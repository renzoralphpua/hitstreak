/** Shown while a route segment's data resolves. Every app screen opens with a heading and a stack
 *  of panels, so the skeleton mimics that rather than a spinner — no layout jump when it swaps.
 *  `animate-pulse` is dropped under prefers-reduced-motion by the base rule in globals.css. */
export default function Loading() {
  return (
    <div className="flex animate-pulse flex-col gap-5" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-56 rounded-tile bg-hairline-soft" />
      <div className="flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-28 rounded-panel border border-hairline bg-surface" />
        ))}
      </div>
    </div>
  );
}
