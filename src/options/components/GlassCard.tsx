import type { CSSProperties, ReactNode } from "react";

interface GlassCardProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  style?: CSSProperties;
}

export function GlassCard({ children, className = "", onClick, style }: GlassCardProps) {
  return (
    <div className={`glass ${className}`} onClick={onClick} style={style}>
      {children}
    </div>
  );
}
