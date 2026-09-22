const SIZE = "sm:w-12 sm:h-12";

export function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" width="40" height="40" shapeRendering="crispEdges" aria-hidden="true" className={SIZE}>
      <rect x="4" y="2" width="8" height="2" fill="#000" />
      <rect x="4" y="2" width="2" height="6" fill="#000" />
      <rect x="10" y="2" width="2" height="6" fill="#000" />
      <rect x="3" y="7" width="10" height="7" fill="#000" />
      <rect x="7" y="9" width="2" height="3" fill="#fffaf7" />
    </svg>
  );
}

export function BoltIcon() {
  return (
    <svg viewBox="0 0 16 16" width="40" height="40" shapeRendering="crispEdges" aria-hidden="true" className={SIZE}>
      <rect x="8" y="1" width="3" height="2" fill="#000" />
      <rect x="7" y="3" width="3" height="2" fill="#000" />
      <rect x="6" y="5" width="3" height="2" fill="#000" />
      <rect x="4" y="7" width="8" height="2" fill="#000" />
      <rect x="7" y="9" width="3" height="2" fill="#000" />
      <rect x="6" y="11" width="3" height="2" fill="#000" />
      <rect x="5" y="13" width="3" height="2" fill="#000" />
    </svg>
  );
}
