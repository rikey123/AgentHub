type SkeletonProps = {
  readonly width?: string | number;
  readonly height?: string | number;
  readonly borderRadius?: string | number;
  readonly className?: string;
  readonly style?: React.CSSProperties;
};

export function Skeleton({ width = "100%", height = 16, borderRadius = "var(--ah-radius-md)", className = "", style }: SkeletonProps) {
  return (
    <div
      className={`ah-skeleton ${className}`}
      style={{
        width: typeof width === "number" ? `${width}px` : width,
        height: typeof height === "number" ? `${height}px` : height,
        borderRadius: typeof borderRadius === "number" ? `${borderRadius}px` : borderRadius,
        ...style
      }}
      aria-hidden="true"
    />
  );
}

export function MessageSkeleton() {
  return (
    <div style={{ marginTop: "var(--ah-space-4)", display: "flex", flexDirection: "column", gap: "var(--ah-space-2)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--ah-space-2)" }}>
        <Skeleton width={80} height={14} borderRadius="var(--ah-radius-sm)" />
        <Skeleton width={60} height={12} borderRadius="var(--ah-radius-sm)" />
      </div>
      <Skeleton width="70%" height={60} borderRadius="var(--ah-radius-xl)" />
    </div>
  );
}

export function ChatStreamSkeleton({ count = 5 }: { readonly count?: number }) {
  return (
    <div style={{ padding: "0 var(--ah-space-4)" }}>
      {Array.from({ length: count }).map((_, i) => (
        <MessageSkeleton key={i} />
      ))}
    </div>
  );
}

export function RunDetailSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "var(--ah-space-4)" }}>
      <Skeleton width={120} height={20} borderRadius="var(--ah-radius-md)" />
      <div style={{ marginTop: "var(--ah-space-3)", display: "flex", gap: "var(--ah-space-2)" }}>
        <Skeleton width={80} height={32} borderRadius="var(--ah-radius-md)" />
        <Skeleton width={80} height={32} borderRadius="var(--ah-radius-md)" />
        <Skeleton width={80} height={32} borderRadius="var(--ah-radius-md)" />
      </div>
      <div style={{ marginTop: "var(--ah-space-4)", display: "flex", flexDirection: "column", gap: "var(--ah-space-3)" }}>
        <Skeleton width="100%" height={80} borderRadius="var(--ah-radius-lg)" />
        <Skeleton width="100%" height={80} borderRadius="var(--ah-radius-lg)" />
        <Skeleton width="100%" height={80} borderRadius="var(--ah-radius-lg)" />
      </div>
    </div>
  );
}

export function CostPanelSkeleton() {
  return (
    <div style={{ padding: "var(--ah-space-3)" }}>
      <Skeleton width={80} height={12} borderRadius="var(--ah-radius-sm)" />
      <div style={{ marginTop: "var(--ah-space-2)", display: "flex", gap: "var(--ah-space-1)" }}>
        <Skeleton width={60} height={28} borderRadius="var(--ah-radius-sm)" />
        <Skeleton width={60} height={28} borderRadius="var(--ah-radius-sm)" />
        <Skeleton width={60} height={28} borderRadius="var(--ah-radius-sm)" />
      </div>
      <Skeleton width={80} height={12} borderRadius="var(--ah-radius-sm)" style={{ marginTop: "var(--ah-space-3)" }} />
      <div style={{ marginTop: "var(--ah-space-2)", display: "flex", gap: "var(--ah-space-1)" }}>
        <Skeleton width={60} height={28} borderRadius="var(--ah-radius-sm)" />
        <Skeleton width={60} height={28} borderRadius="var(--ah-radius-sm)" />
        <Skeleton width={60} height={28} borderRadius="var(--ah-radius-sm)" />
      </div>
      <div style={{ marginTop: "var(--ah-space-4)", display: "flex", flexDirection: "column", gap: "var(--ah-space-2)" }}>
        <Skeleton width="100%" height={60} borderRadius="var(--ah-radius-md)" />
        <Skeleton width="100%" height={60} borderRadius="var(--ah-radius-md)" />
        <Skeleton width="100%" height={60} borderRadius="var(--ah-radius-md)" />
      </div>
    </div>
  );
}
