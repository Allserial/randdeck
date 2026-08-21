import type { ImgHTMLAttributes } from "react";

export default function BrandMark({ size = 24, title = "掷数台", className, ...props }: ImgHTMLAttributes<HTMLImageElement> & { size?: number; title?: string }) {
  return (
    <img
      src="/favicon.svg"
      width={size}
      height={size}
      alt={title}
      className={["brand-mark", className].filter(Boolean).join(" ")}
      {...props}
    />
  );
}
