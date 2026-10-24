import { useLayoutEffect, useRef } from "react";
import clsx from "clsx";

export function ResultNumber({ value, className }: { value: number | string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    const parent = element?.parentElement;
    if (!element || !parent) return;
    const fit = () => {
      const maximum = Number.parseFloat(getComputedStyle(element).getPropertyValue("--number-size")) || 48;
      element.style.setProperty("--fitted-size", `${maximum}px`);
      const availableW = Math.max(1, parent.clientWidth - 14);
      const availableH = Math.max(1, parent.clientHeight - 6);
      const rect = element.getBoundingClientRect();
      const scaleW = availableW / Math.max(1, rect.width);
      const scaleH = availableH / Math.max(1, rect.height);
      element.style.setProperty("--fitted-size", `${Math.max(15, Math.min(maximum, maximum * Math.min(scaleW, scaleH)))}px`);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [value]);
  return <span ref={ref} className={clsx("fit-number", className)}>{value}</span>;
}
