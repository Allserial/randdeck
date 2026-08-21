import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import clsx from "clsx";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "quiet" | "danger";
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", icon, className, children, ...props },
  ref
) {
  return (
    <button ref={ref} className={clsx("ui-button", `ui-button--${variant}`, className)} {...props}>
      {icon}
      <span className="ui-button__content">{children}</span>
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, children, className, ...props },
  ref
) {
  return (
    <button ref={ref} type="button" className={clsx("icon-button", className)} aria-label={label} title={label} {...props}>
      {children}
    </button>
  );
});
